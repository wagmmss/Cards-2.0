import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnglishMedicalSearchQueries,
  isSpamOrLogoImageUrl,
  normalizeImageCanonicalKey,
  scoreImageRelevance,
} from './mediaSearch';
import { sanitizeDeckKey } from '../src/utils/apiClient';
import {
  buildPdfImagesCatalog,
  extractMarkdownTextImages,
  matchMaterialImagesForCard,
  mergeMaterialAndWebImages,
} from '../src/utils/materialImageMatcher';
import {
  attachVisualSuggestionToCard,
  extractUnresolvedLocalImages,
} from '../src/utils/wozniakLinter';
import type { CanonicalCard, PdfExtractedImage, UploadedPdfFile } from '../src/types/deck';

test('isSpamOrLogoImageUrl filters logos, icons, portraits, and non-image extensions', () => {
  assert.equal(isSpamOrLogoImageUrl('https://example.com/site-logo.png'), true);
  assert.equal(isSpamOrLogoImageUrl('https://upload.wikimedia.org/commons/flag_of_brazil.svg'), true);
  assert.equal(isSpamOrLogoImageUrl('https://upload.wikimedia.org/commons/Willem_Einthoven_portrait.jpg'), true);
  assert.equal(isSpamOrLogoImageUrl('https://example.com/scan.pdf'), true);
  assert.equal(
    isSpamOrLogoImageUrl('https://litfl.com/wp-content/uploads/2020/01/anterior-stemi-ecg.jpg', 'Anterior STEMI ECG'),
    false
  );
});

test('normalizeImageCanonicalKey collapses Wikimedia thumbnails of different sizes and full image to same key', () => {
  const thumb800 =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tension_pneumothorax.jpg/800px-Tension_pneumothorax.jpg';
  const thumb900 =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tension_pneumothorax.jpg/900px-Tension_pneumothorax.jpg';
  const original =
    'https://upload.wikimedia.org/wikipedia/commons/a/ab/Tension_pneumothorax.jpg';

  const key800 = normalizeImageCanonicalKey(thumb800);
  const key900 = normalizeImageCanonicalKey(thumb900);
  const keyOrig = normalizeImageCanonicalKey(original);

  assert.equal(key800, 'wikimedia:tension_pneumothorax.jpg');
  assert.equal(key900, key800);
  assert.equal(keyOrig, key800);
});

test('buildEnglishMedicalSearchQueries maps PT-BR clinical pathology & modality to targeted English queries', () => {
  const ecgQueries = buildEnglishMedicalSearchQueries('Supra de ST em parede anterior', 'IAMCSST', '');
  assert.ok(ecgQueries.some((q) => /myocardial infarction.*ECG/i.test(q)));

  const rxQueries = buildEnglishMedicalSearchQueries('Pneumotórax hipertensivo', 'Trauma torácico', '');
  assert.ok(rxQueries.some((q) => /pneumothorax.*chest x-ray/i.test(q)));
});

test('scoreImageRelevance ranks matching clinical raster modality above mismatch, biography, or schematic SVG', () => {
  const ecgRaster = {
    title: 'Anterior STEMI 12-lead ECG',
    description: 'LITFL electrocardiogram showing ST elevation in V1-V4',
    source: 'litfl.com (via Google Search)',
    thumbUrl: 'https://litfl.com/ecg/anterior_stemi.jpg',
    fullUrl: 'https://litfl.com/ecg/anterior_stemi.jpg',
    isSvg: false,
  };

  const schematicSvg = {
    title: 'Heart diagram schematic',
    description: 'Cartoon vector diagram of coronary artery',
    source: 'Wikimedia Commons Medical',
    thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/heart_diagram.svg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/heart_diagram.svg',
    isSvg: true,
  };

  const biographyPhoto = {
    title: 'Physician portrait Nobel biography',
    description: 'Scientist portrait in hospital university campus',
    source: 'Wikipedia Medical (EN)',
    thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/doctor_portrait.jpg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/doctor_portrait.jpg',
    isSvg: false,
  };

  const ctx = {
    query: 'ECG supra de ST IAMCSST',
    topic: 'Cardiologia - ECG',
    question: 'Qual o achado eletrocardiográfico esperado?',
    answer: 'Supradesnivelamento de ST anterior.',
    enQueries: ['ST elevation myocardial infarction ECG LITFL'],
  };

  const ecgScore = scoreImageRelevance(ecgRaster, ctx);
  const svgScore = scoreImageRelevance(schematicSvg, ctx);
  const bioScore = scoreImageRelevance(biographyPhoto, ctx);
  assert.ok(ecgScore > svgScore + 40, `Expected ECG raster (${ecgScore}) >> SVG (${svgScore})`);
  assert.ok(bioScore < 0, `Expected biography portrait score (${bioScore}) < 0`);
});

test('sanitizeDeckKey normalizes accents, spaces, and punctuation deterministically', () => {
  assert.equal(sanitizeDeckKey('Abdome Agudo Perfuração! '), 'abdome_agudo_perfuracao');
  assert.equal(sanitizeDeckKey('  '), 'internato_deck');
});

test('matchMaterialImagesForCard matches extracted PDF images by exact ID or clinical context and merges with web results', () => {
  const matImages: PdfExtractedImage[] = [
    {
      id: 'pdfimg_aula_p4_1',
      pdfName: 'aula_ecg.pdf',
      pageNumber: 4,
      width: 640,
      height: 360,
      dataUrl: 'data:image/jpeg;base64,AAA',
      pageTextSnippet: 'Bloqueio de ramo direito com morfologia rSR em V1 e onda S empastada em V6',
      captionHint: 'Traçado de ECG típico de BRD em V1',
      suggestedFilename: 'aula_ecg_p4_fig1.jpg',
      kind: 'embedded',
    },
    {
      id: 'pdfimg_aula_p9_1',
      pdfName: 'aula_ecg.pdf',
      pageNumber: 9,
      width: 640,
      height: 360,
      dataUrl: 'data:image/jpeg;base64,BBB',
      pageTextSnippet: 'Pneumotórax hipertensivo com desvio do mediastino na radiografia de tórax',
      suggestedFilename: 'aula_ecg_p9_fig1.jpg',
      kind: 'page_crop',
    },
  ];

  const byId = matchMaterialImagesForCard(matImages, {
    query: 'ECG',
    preferredPdfImageId: 'pdfimg_aula_p9_1',
  });
  assert.equal(byId[0]?.id, 'mat-pdfimg_aula_p9_1');
  assert.equal(byId[0]?.fromMaterial, true);

  const byContext = matchMaterialImagesForCard(matImages, {
    topic: 'Cardiologia - Distúrbios de Condução',
    question: 'Qual o achado no ECG com rSR em V1?',
    answer: 'Bloqueio de ramo direito.',
  });
  assert.equal(byContext[0]?.id, 'mat-pdfimg_aula_p4_1');
  assert.ok((byContext[0]?.materialScore ?? 0) >= 26);

  const merged = mergeMaterialAndWebImages(
    byContext,
    [
      {
        id: 'web-1',
        title: 'RBBB ECG LITFL',
        thumbUrl: 'https://litfl.com/rbbb.jpg',
        fullUrl: 'https://litfl.com/rbbb.jpg',
        description: 'Right bundle branch block ECG',
        suggestedFilename: 'rbbb.jpg',
        defaultLegend: 'ECG demonstrando BRD.',
        source: 'litfl.com',
      },
    ],
    6
  );
  assert.equal(merged[0]?.fromMaterial, true);
  assert.equal(merged.some((m) => m.id === 'web-1'), true);
});

test('extractMarkdownTextImages and buildPdfImagesCatalog index uploaded material references', () => {
  const md = `
# Cardiologia
![ECG Brugada](https://example.org/brugada_ecg.png)
Texto clínico sobre síndrome de Brugada tipo 1 em V1-V2.
  `;
  const imgs = extractMarkdownTextImages(md, 'resumo_brugada.md');
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].captionHint, 'ECG Brugada');

  const pdf: UploadedPdfFile = {
    name: 'resumo_brugada.md',
    size: md.length,
    mimeType: 'text/markdown',
    base64Data: '',
    textContent: md,
    extractedImages: imgs,
  };
  const catalog = buildPdfImagesCatalog([pdf]);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].pdfName, 'resumo_brugada.md');
});

test('extractUnresolvedLocalImages parses pdfimg: and buscar_imagem: placeholders and attachVisualSuggestionToCard embeds cleanly', () => {
  const cardPdf: CanonicalCard = {
    id: 101,
    type: 'basic',
    deck_key: 'cardio',
    topic: 'Cardiologia - Condução',
    question: 'Analise o traçado abaixo:<br><img src="pdfimg:pdfimg_aula_p4_1">',
    answer: 'Bloqueio de ramo direito.',
    hint: '<b>Comentário:</b> Morfologia rSR\' em V1.',
  };
  const unresolvedPdf = extractUnresolvedLocalImages(cardPdf);
  assert.equal(unresolvedPdf.length, 1);
  assert.equal(unresolvedPdf[0].pdfImageId, 'pdfimg_aula_p4_1');

  const cardWeb: CanonicalCard = {
    id: 102,
    type: 'basic',
    deck_key: 'trauma',
    topic: 'Cirurgia - Tórax',
    question: 'Qual o achado no exame?<br><img src="buscar_imagem: pneumotorax hipertensivo radiografia">',
    answer: 'Pneumotórax hipertensivo.',
    hint: '<b>Comentário:</b> Hipertransparência sem trama vascular.',
  };
  const unresolvedWeb = extractUnresolvedLocalImages(cardWeb);
  assert.equal(unresolvedWeb.length, 1);
  assert.equal(unresolvedWeb[0].searchQuery, 'pneumotorax hipertensivo radiografia');

  const baseCard: CanonicalCard = {
    id: 103,
    type: 'basic',
    deck_key: 'cardio',
    topic: 'Cardiologia - Isquemia',
    question: 'Qual a alteração esperada na parede anterior?',
    answer: 'Supradesnivelamento de ST em V1-V4.',
    hint: '<b>Comentário:</b> Oclusão da descendente anterior exige reperfusão imediata.',
  };
  const attached = attachVisualSuggestionToCard(
    baseCard,
    {
      id: 'mat-1',
      title: 'IAM Anterior',
      thumbUrl: 'data:image/jpeg;base64,XYZ',
      fullUrl: 'data:image/jpeg;base64,XYZ',
      description: 'ECG IAM anterior',
      suggestedFilename: 'iam_anterior.jpg',
      defaultLegend: 'ECG mostrando supra de ST em V1-V4.',
      source: 'Material PDF (Pág. 2)',
      fromMaterial: true,
    },
    'Traçado de 12 derivações com supra de ST anterior.',
    'feedback',
    []
  );
  assert.equal(attached.image_mode, 'feedback');
  assert.ok(attached.hint.startsWith('<img src="data:image/jpeg;base64,XYZ" data-anki-file="iam_anterior.jpg"><br><b>Comentário:</b>'));
});

