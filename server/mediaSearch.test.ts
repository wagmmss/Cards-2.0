import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnglishMedicalSearchQueries,
  isSpamOrLogoImageUrl,
  normalizeImageCanonicalKey,
  scoreImageRelevance,
} from './mediaSearch';
import { sanitizeDeckKey } from '../src/utils/apiClient';

test('isSpamOrLogoImageUrl filters logos, icons, and non-image extensions', () => {
  assert.equal(isSpamOrLogoImageUrl('https://example.com/site-logo.png'), true);
  assert.equal(isSpamOrLogoImageUrl('https://upload.wikimedia.org/commons/flag_of_brazil.svg'), true);
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

test('scoreImageRelevance ranks matching clinical raster modality above mismatch or schematic SVG', () => {
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

  const ctx = {
    query: 'ECG supra de ST IAMCSST',
    topic: 'Cardiologia - ECG',
    question: 'Qual o achado eletrocardiográfico esperado?',
    enQueries: ['ST elevation myocardial infarction ECG LITFL'],
  };

  const ecgScore = scoreImageRelevance(ecgRaster, ctx);
  const svgScore = scoreImageRelevance(schematicSvg, ctx);
  assert.ok(ecgScore > svgScore + 40, `Expected ECG raster (${ecgScore}) >> SVG (${svgScore})`);
});

test('sanitizeDeckKey normalizes accents, spaces, and punctuation deterministically', () => {
  assert.equal(sanitizeDeckKey('Abdome Agudo Perfuração! '), 'abdome_agudo_perfuracao');
  assert.equal(sanitizeDeckKey('  '), 'internato_deck');
});
