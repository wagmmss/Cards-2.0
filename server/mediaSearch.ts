import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  extractJsonBlock,
  FALLBACK_GEMINI_MODEL,
  generateContentWithRetry,
  parseGeminiApiKeys,
} from './geminiClient';
import { searchLocalMediaArchive } from './localMediaIndex';

export interface MedicalImageCandidate {
  id: string;
  title: string;
  thumbUrl: string;
  fullUrl: string;
  description: string;
  suggestedFilename: string;
  defaultLegend: string;
  source: string;
  fromMaterial?: boolean;
  isSvg?: boolean;
  relevanceScore?: number;
}

export interface SearchMedicalImagesContext {
  query: string;
  topic?: string;
  question?: string;
  answer?: string;
  hint?: string;
  deckKey?: string;
  preferGoogleGrounding?: boolean;
  signal?: AbortSignal;
}

export const PT_TO_EN_MEDICAL_TERMS: Array<[RegExp, string]> = [
  [/\bbloqueio\s+de\s+ramo\s+direito|\bbrd\b/gi, 'right bundle branch block ECG'],
  [/\bbloqueio\s+de\s+ramo\s+esquerdo|\bbre\b/gi, 'left bundle branch block ECG'],
  [/\bwolff[-\s]?parkinson[-\s]?white|\bwpw\b|\bonda\s+delta\b|\bpr[eé][-\s]?excita[cç][aã]o\b/gi, 'Wolff-Parkinson-White syndrome delta wave ECG'],
  [/\bbrugada\b/gi, 'Brugada syndrome ECG'],
  [/\bapendicite(?:\s+aguda)?\b/gi, 'acute appendicitis CT ultrasound'],
  [/\bdiverticulite(?:\s+aguda)?\b/gi, 'acute diverticulitis abdominal CT'],
  [/\bcolecistite(?:\s+aguda)?\b/gi, 'acute cholecystitis gallbladder ultrasound'],
  [/\bpancreatite(?:\s+aguda)?\b/gi, 'acute pancreatitis abdominal CT'],
  [/\bpneumot[oó]rax(?:\s+hipertensivo)?\b/gi, 'tension pneumothorax chest x-ray'],
  [/\bhemot[oó]rax\b/gi, 'hemothorax chest x-ray'],
  [/\bpneumoperit[oô]nio\b/gi, 'pneumoperitoneum upright chest x-ray'],
  [/\bedema\s+agudo\s+de\s+pulm[aã]o\b/gi, 'acute pulmonary edema bat wing chest x-ray'],
  [/\binsufici[eê]ncia\s+card[ií]aca\b/gi, 'congestive heart failure cardiomegaly chest x-ray'],
  [/\binfarto|iam|supradesnivelamento|supra\s+de\s+st\b/gi, 'ST elevation myocardial infarction ECG LITFL'],
  [/\binfradesnivelamento|infra\s+de\s+st|isquemia\s+subendoc[aá]rdica\b/gi, 'ST depression myocardial ischemia ECG'],
  [/\bfibrila[cç][aã]o\s+atrial\b/gi, 'atrial fibrillation ECG rhythm strip'],
  [/\btaquicardia\s+ventricular|torsades\b/gi, 'ventricular tachycardia torsades de pointes ECG'],
  [/\btaquicardia\s+supraventricular|tpsv\b/gi, 'supraventricular tachycardia narrow complex ECG'],
  [/\bflutter\s+atrial\b/gi, 'atrial flutter sawtooth ECG'],
  [/\bbloqueio\s+atrioventricular|bav\s+total|bavt|mobitz\b/gi, 'third degree AV block complete heart block ECG'],
  [/\bpericardite\b/gi, 'acute pericarditis diffuse ST elevation ECG'],
  [/\bhipercalemia\b/gi, 'hyperkalemia peaked T waves ECG'],
  [/\bcardiotocografia|dip\s+ii|desacelera[cç][aã]o|sofrimento\s+fetal|taquissistolia|hiperestimula[cç][aã]o\s+uterina\b/gi, 'cardiotocography fetal heart rate late deceleration CTG'],
  [/\b[íi]ndice\s+de\s+bishop|\bescore\s+de\s+bishop|\bamadurecimento\s+cervical|\bcolo\s+(?:favor[áa]vel|desfavor[áa]vel)\b/gi, 'Bishop score cervical ripening obstetrics'],
  [/\bindu[cç][aã]o\s+do\s+parto|misoprostol|ocitocina\b/gi, 'labor induction cervical ripening obstetrics'],
  [/\bpr[eé][-\s]?ecl[aâ]mpsia|ecl[aâ]mpsia|s[ií]ndrome\s+hellp\b/gi, 'HELLP syndrome schistocytes peripheral blood smear'],
  [/\bhemorragia\s+p[oó]s[-\s]?parto|bal[aã]o\s+de\s+bakri|atonia\s+uterina\b/gi, 'postpartum hemorrhage Bakri balloon tamponade'],
  [/\bgravidez\s+ect[oó]pica\b/gi, 'ectopic pregnancy transvaginal ultrasound'],
  [/\bdescolamento\s+prematuro\s+de\s+placenta|placenta\s+pr[eé]via\b/gi, 'placental abruption placenta previa ultrasound'],
  [/\bpartograma|\bparada\s+secund[aá]ria|\bdist[oó]cia\s+funcional\b/gi, 'partogram labor dystocia cervical dilation curve'],
  [/\bmanobras?\s+de\s+leopold\b/gi, "Leopold's maneuvers abdominal palpation obstetrics"],
  [/\bdist[oó]cia\s+de\s+ombro|\bmcroberts|\brubin|\bwoods|\bjacquemier|\bsinal\s+da\s+tartaruga\b/gi, 'shoulder dystocia McRoberts maneuver obstetrics'],
  [/\bf[oó]rcipe|\bsimpson|\bkielland|\bpiper|\bv[aá]cuo[-\s]?extrator\b/gi, 'obstetric forceps operative vaginal delivery'],
  [/\bplanos?\s+de\s+de\s?lee|\bpelvimetria|\bbacia\s+obst[eé]trica|\bestreito\s+(?:superior|m[eé]dio|inferior)\b/gi, 'fetal station De Lee planes pelvimetry pelvis'],
  [/\bepisiotomia|\blacera[cç][aã]o\s+perineal\b/gi, 'episiotomy perineal laceration obstetrics'],
  [/\bpneumonia\b/gi, 'lobar pneumonia consolidation chest x-ray'],
  [/\btuberculose\b/gi, 'pulmonary tuberculosis cavitation chest x-ray'],
  [/\bderrame\s+pleural\b/gi, 'pleural effusion chest x-ray meniscus sign'],
  [/\btromboembolismo\s+pulmonar|\btep\b/gi, 'pulmonary embolism CT pulmonary angiography'],
  [/\bavc\s+isqu[eê]mico\b/gi, 'ischemic stroke brain CT'],
  [/\bavc\s+hemorr[aá]gico|hemorragia\s+subaracn[oó]idea\b/gi, 'subarachnoid hemorrhage head CT'],
  [/\bhematoma\s+epidural\b/gi, 'epidural hematoma biconvex lens head CT'],
  [/\bhematoma\s+subdural\b/gi, 'subdural hematoma crescent head CT'],
  [/\bobstru[cç][aã]o\s+intestinal|volvo\b/gi, 'bowel obstruction sigmoid volvulus coffee bean x-ray'],
  [/\bintussuscep[cç][aã]o\b/gi, 'intussusception target sign pediatric ultrasound'],
  [/\bestenose\s+hipertr[oó]fica\s+de\s+piloro\b/gi, 'hypertrophic pyloric stenosis ultrasound'],
  [/\bepigloti(?:te|tis)|crupe|laringotraque[ií]te\b/gi, 'croup steeple sign epiglottitis thumbprint neck x-ray'],
  [/\bbronquiolite\b/gi, 'bronchiolitis chest x-ray hyperinflation pediatric'],
  [/\bdoen[cç]a\s+da\s+membrana\s+hialina|s[ií]ndrome\s+do\s+desconforto\b/gi, 'neonatal respiratory distress syndrome ground glass chest x-ray'],
  [/\bretinopatia\s+hipertensiva|retinopatia\s+diab[eé]tica|fundoscopia\b/gi, 'hypertensive diabetic retinopathy fundus photography'],
  [/\bpapiledema\b/gi, 'papilledema optic disc fundoscopy'],
  [/\bmelanoma|carcinoma\s+basocelular|dermatoscopia\b/gi, 'melanoma basal cell carcinoma dermoscopy'],
  [/\bherpes\s+zoster|varicela|impetigo|celulite|erisipela|psor[ií]ase|escabiose\b/gi, 'dermatology skin lesion rash clinical photograph'],
  [/\bs[ií]filis|cancro|linfogranuloma\b/gi, 'secondary syphilis palmar plantar rash clinical photo'],
  [/\bcirrose|ascite|varizes\s+esof[aá]gicas\b/gi, 'esophageal varices endoscopy liver cirrhosis'],
  [/\bfratura|luxa[cç][aã]o|osteomielite|colles|monteggia\b/gi, 'bone fracture dislocation radiograph x-ray'],
  [/\bleucemia|esfrega[cç]o|anemia\s+falciforme|drepan[oó]cito|bastonete\s+de\s+auer\b/gi, 'peripheral blood smear microscopy hematology'],
];

const BLOCKED_IMAGE_URL_PATTERN =
  /(?:logo|icon|favicon|avatar|gravatar|pb-primary|dark-mode|banner|badge|pixel|1x1|sprite|spinner|button|social|share|commons-logo|ambox|edit-clear|question_book|crystal_clear|padlock|symbol_|flag_of_|coat_of_arms|map_of_|blank_map|wikimedia-button|poweredby|boeing|airlines|airport|stamp_of_|coin_|portrait_of_|bust_of_|headshot|scientist|einthoven|nobel|biography|author_photo|pill_bottle|medication_box|tablet_pack|capsule_pack|stethoscope|syringe|clipart|diatom|microfossil|focusstack|brightfield|diatomaceous|galaxy|nebula|volcano|glacier|insect|beetle|butterfly|orchid|consecration|archbishop|cathedral|diocese|clergy|accouchement_vers_1800|kardiotokograf)/i;

const WIKIMEDIA_USER_AGENT =
  'Cards20MedicalApp/2.0 (https://github.com/wagmms/Cards-2.0)';

const MODALITY_KEYWORDS: Array<{
  name: string;
  ptEnTrigger: RegExp;
  candidateMatch: RegExp;
}> = [
  {
    name: 'ecg',
    ptEnTrigger: /\b(ecg|eletrocardiograma|ritmo|st|supra|infra|arritmia|fibrilacao|flutter|bav|taquicardia|qrs|onda)\b/i,
    candidateMatch: /\b(ecg|ekg|electrocardiogram|rhythm|lead|litfl|qrs|st[\s_-]?elevation|arrhythmia|flutter|fibrillation|block)\b/i,
  },
  {
    name: 'xray',
    ptEnTrigger: /\b(rx|radiografia|raio[\s-]?x|torax|pneumotorax|pneumoperitonio|derrame|fratura|volvo|crupe|epiglotite)\b/i,
    candidateMatch: /\b(x[\s_-]?ray|radiograph|radiology|chest|pneumothorax|pneumoperitoneum|fracture|effusion|consolidation|thorax|rx)\b/i,
  },
  {
    name: 'ct',
    ptEnTrigger: /\b(tc|tomografia|angiotc|hematoma|avc|hemorragia|pancreatite|diverticulite|apendicite|tep)\b/i,
    candidateMatch: /\b(ct|computed\s+tomography|scan|angiography|hematoma|subarachnoid|stroke|radiopaedia|axial)\b/i,
  },
  {
    name: 'usg',
    ptEnTrigger: /\b(usg|ultrassom|ultrassonografia|ecografia|fast|e[\s-]?fast|colecistite|ectopica|intussuscepcao|piloro)\b/i,
    candidateMatch: /\b(ultrasound|sonography|ultrasonography|sonogram|doppler|transvaginal|gallbladder|fast)\b/i,
  },
  {
    name: 'ctg',
    ptEnTrigger:
      /\b(ctg|cardiotocografia|desaceleracao|desaceleracoes|dip\s*[i123]?|taquissistolia|variabilidade\s+(?:ausente|minima|moderada)|sofrimento\s+fetal|monitorizacao\s+fetal|frequencia\s+cardiaca\s+fetal|linha\s+de\s+base\s+fetal)\b/i,
    candidateMatch: /\b(ctg|cardiotocography|fetal|deceleration|tachysystole|contraction|trace)\b/i,
  },
  {
    name: 'partograma',
    ptEnTrigger: /\b(partograma|dilatacao\s+cervical|linha\s+de\s+alerta|linha\s+de\s+acao|curva\s+de\s+friedman|parada\s+secundaria)\b/i,
    candidateMatch: /\b(partogra\w*|cervical\s+dilation|friedman|alert\s+line|action\s+line|labor\s+curve|who)\b/i,
  },
  {
    name: 'shoulder_dystocia',
    ptEnTrigger: /\b(distocia\s+de\s+ombro|mcroberts|rubin|woods|jacquemier|zavanelli|sinal\s+da\s+tartaruga)\b/i,
    candidateMatch: /\b(shoulder\s+dystocia|mcroberts|rubin|woods|suprapubic|clavicle\s+fracture|dystocia)\b/i,
  },
  {
    name: 'leopold_maneuver',
    ptEnTrigger: /\b(manobras?\s+de\s+leopold|leopold|handgriff)\b/i,
    candidateMatch: /\b(leopold|handgriff|abdominal\s+palpation)\b/i,
  },
  {
    name: 'operative_delivery',
    ptEnTrigger: /\b(forcipe|forceps|simpson|kielland|piper|vacuo[-\s]?extrator|parto\s+instrumental)\b/i,
    candidateMatch: /\b(forceps|vacuum\s+extractor|ventouse|operative\s+vaginal\s+delivery)\b/i,
  },
  {
    name: 'episiotomy_perineal',
    ptEnTrigger: /\b(episiotomia|episiotomy|laceracao\s+perineal)\b/i,
    candidateMatch: /\b(episiotomy|perineal\s+laceration|mediolateral)\b/i,
  },
  {
    name: 'breech_presentation',
    ptEnTrigger: /\b(apresentacao\s+pelvica|parto\s+pelvico|breech|brach|mauriceau)\b/i,
    candidateMatch: /\b(breech|brach|mauriceau)\b/i,
  },
  {
    name: 'pelvimetry',
    ptEnTrigger: /\b(pelvimetria|bacia\s+obstetrica|sinclitismo|assinclitismo|estreito\s+(?:superior|medio|inferior)|planos?\s+de\s+de\s?lee)\b/i,
    candidateMatch: /\b(pelvimetry|pelvic\s+inlet|conjugate|synclitism|asynclitism|fetal\s+station|de\s+lee)\b/i,
  },
  {
    name: 'derm',
    ptEnTrigger: /\b(dermatoscopia|melanoma|lesao|pele|rash|exantema|herpes|zoster|sifilis|basocelular|eritema)\b/i,
    candidateMatch: /\b(derm|dermoscopy|skin|lesion|rash|melanoma|carcinoma|zoster|syphilis|maculopapular|erythema|dermnet)\b/i,
  },
  {
    name: 'fundus',
    ptEnTrigger: /\b(fundoscopia|fundo\s+de\s+olho|retinopatia|papiledema|retina|disco\s+optico)\b/i,
    candidateMatch: /\b(fundus|fundoscopy|retina|retinopathy|papilledema|optic[\s_-]?disc|ophthalm)\b/i,
  },
  {
    name: 'smear',
    ptEnTrigger: /\b(esfregaco|hematoscopia|lamina|esquizocito|falciforme|auer|leucemia|hellp)\b/i,
    candidateMatch: /\b(smear|microscopy|schistocyte|sickle|histology|hematology|auer|cell|blood)\b/i,
  },
];

export function isSvgImageUrl(url: string, mime = ''): boolean {
  const cleanPath = (url || '').split('?')[0].split('#')[0].toLowerCase();
  if (/\.(?:png|jpe?g|webp|gif|avif)$/.test(cleanPath)) {
    return false;
  }
  return mime.toLowerCase().includes('svg') || /\.svg(?:\/|$)/.test(cleanPath);
}

export function isSpamOrLogoImageUrl(url: string, title = ''): boolean {
  const combined = `${url} ${title}`;
  if (!url || BLOCKED_IMAGE_URL_PATTERN.test(combined)) return true;
  if (/\.(?:tif|tiff|pdf|djvu|ogg|ogv|webm|mp4|mp3|wav)$/i.test(url.split('?')[0])) {
    return true;
  }
  return false;
}

/**
 * Normalizes URLs so identical Wikimedia Commons files at different thumbnail resolutions
 * (/800px-Foo.jpg vs /900px-Foo.jpg vs original Foo.jpg) collapse to the exact same canonical key.
 */
export function normalizeImageCanonicalKey(url: string, fallbackTitle = ''): string {
  const cleanUrl = (url || '').trim().split('#')[0].split('?')[0].toLowerCase();
  if (!cleanUrl) return fallbackTitle.trim().toLowerCase();

  try {
    const parsed = new URL(cleanUrl);
    const pathname = decodeURIComponent(parsed.pathname);

    // Wikimedia Commons / Wikipedia thumbnails:
    // .../commons/thumb/a/ab/FileName.jpg/900px-FileName.jpg -> wikimedia:filename.jpg
    if (
      parsed.hostname.includes('wikimedia.org') ||
      parsed.hostname.includes('wikipedia.org')
    ) {
      const thumbMatch = pathname.match(/\/thumb\/[^/]+\/[^/]+\/([^/]+)\/\d+px-[^/]+$/i);
      if (thumbMatch && thumbMatch[1]) {
        return `wikimedia:${thumbMatch[1].replace(/\s+/g, '_')}`;
      }
      const lastSeg = pathname.split('/').pop() || pathname;
      const strippedPx = lastSeg.replace(/^\d+px-/i, '');
      return `wikimedia:${strippedPx.replace(/\s+/g, '_')}`;
    }

    return `${parsed.hostname.replace(/^www\./, '')}${pathname}`;
  } catch {
    return cleanUrl.replace(/^http:\/\//i, 'https://');
  }
}

function tokenizeNormalized(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

/**
 * Pontua relevância clínica de uma imagem retornada (modalidade médica, correspondência lexical
 * PT/EN, confiabilidade da fonte e penalização para ilustrações/esquemas SVG ou ruído não-clínico).
 */
export function scoreImageRelevance(
  candidate: Pick<
    MedicalImageCandidate,
    'title' | 'description' | 'source' | 'thumbUrl' | 'fullUrl' | 'isSvg'
  >,
  context: {
    query: string;
    topic?: string;
    question?: string;
    answer?: string;
    enQueries?: string[];
  }
): number {
  let score = 0;

  const queryContextText = [
    context.answer || '',
    context.query,
    context.topic || '',
    context.question || '',
    ...(context.enQueries || []),
  ]
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const candidateText = [
    candidate.title,
    candidate.description,
    candidate.source,
    candidate.thumbUrl,
    candidate.fullUrl,
  ]
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 1) Clinical modality matching (huge bonus when image matches requested modality)
  let expectedModalityMatched = false;
  for (const mod of MODALITY_KEYWORDS) {
    if (mod.ptEnTrigger.test(queryContextText)) {
      if (mod.candidateMatch.test(candidateText)) {
        score += 36;
        expectedModalityMatched = true;
      } else {
        score -= 10;
      }
    }
  }
  if (!expectedModalityMatched) {
    for (const mod of MODALITY_KEYWORDS) {
      if (mod.candidateMatch.test(candidateText)) {
        score += 8;
        break;
      }
    }
  }

  // 2) Lexical overlap with answer diagnosis, English expanded queries and original Portuguese terms
  const answerTokens = new Set(tokenizeNormalized(context.answer || ''));
  const enTokens = new Set(tokenizeNormalized((context.enQueries || []).join(' ')));
  const ptTokens = new Set(
    tokenizeNormalized(`${context.query} ${context.topic || ''}`)
  );
  const candTokenList = tokenizeNormalized(candidateText);
  const candTokens = new Set(candTokenList);
  const hasTokenHit = (tok: string): boolean => {
    if (candTokens.has(tok)) return true;
    if (tok.length < 6) return false;
    return candTokenList.some(
      (ctok) => ctok.length >= 6 && (ctok.startsWith(tok) || tok.startsWith(ctok))
    );
  };

  let answerHits = 0;
  for (const tok of answerTokens) {
    if (hasTokenHit(tok)) answerHits++;
  }
  let enHits = 0;
  for (const tok of enTokens) {
    if (hasTokenHit(tok)) enHits++;
  }
  let ptHits = 0;
  for (const tok of ptTokens) {
    if (hasTokenHit(tok)) ptHits++;
  }
  score += Math.min(44, answerHits * 11 + enHits * 9 + ptHits * 6);
  if (!expectedModalityMatched && answerHits + enHits + ptHits === 0) {
    score -= 28;
  }

  // 3) Source authority & clinical repository quality
  const srcLower = `${candidate.source} ${candidate.fullUrl}`.toLowerCase();
  if (/litfl|lifeinthefastlane/.test(srcLower)) score += 24;
  else if (/radiopaedia/.test(srcLower)) score += 24;
  else if (/dermnet/.test(srcLower)) score += 22;
  else if (/pmc\.ncbi|ncbi\.nlm\.nih|scielo|nejm|bmj|openi/.test(srcLower)) score += 18;
  else if (/wikipedia/.test(srcLower)) score += 12;
  else if (/wikimedia/.test(srcLower)) score += 10;
  else if (/google/.test(srcLower)) score += 8;

  // 3b) Critical contradiction penalties (laterality & ST polarity mismatches)
  const qLower = queryContextText.toLowerCase();
  const cLower = candidateText.toLowerCase();
  const qRight = /\b(direita|direito|right|brd|rbbb|dextro)\b/.test(qLower);
  const qLeft = /\b(esquerda|esquerdo|left|bre|lbbb|sinistro)\b/.test(qLower);
  const cRight = /\b(direita|direito|right|brd|rbbb|dextro)\b/.test(cLower);
  const cLeft = /\b(esquerda|esquerdo|left|bre|lbbb|sinistro)\b/.test(cLower);
  if ((qRight && !qLeft && cLeft && !cRight) || (qLeft && !qRight && cRight && !cLeft)) {
    score -= 75;
  }

  const qSupra = /\b(supra|supradesnivelamento|st[\s_-]?elevation|stemi|iamcsst)\b/.test(qLower);
  const qInfra = /\b(infra|infradesnivelamento|st[\s_-]?depression|iamssst|subendocardic)\b/.test(qLower);
  const cSupra = /\b(supra|supradesnivelamento|st[\s_-]?elevation|stemi)\b/.test(cLower);
  const cInfra = /\b(infra|infradesnivelamento|st[\s_-]?depression|nstemi)\b/.test(cLower);
  if ((qSupra && !qInfra && cInfra && !cSupra) || (qInfra && !qSupra && cSupra && !cInfra)) {
    score -= 75;
  }

  // 4) Raster vs SVG & non-clinical artifacts
  const expectsSchematicOrDiagram =
    /\b(?:manobra|leopold|mcroberts|rubin|woods|jacquemier|partograma|partogram|pelve|pelvimetria|de\s?lee|plano\s+de\s+de\s?lee|mecanismo\s+de\s+parto|forcipe|fluxograma|algoritmo|esquema|curva)\b/i.test(
      queryContextText
    );
  const isThumbRawSvg = Boolean(candidate.isSvg) || isSvgImageUrl(candidate.thumbUrl);
  const isSourceSvgOnly = !isThumbRawSvg && isSvgImageUrl(candidate.fullUrl);
  if (isThumbRawSvg || (!expectsSchematicOrDiagram && isSourceSvgOnly)) {
    score -= 22;
  }
  if (
    !expectsSchematicOrDiagram &&
    /\b(diagram|schematic|flowchart|cartoon|illustration|map|chart|graph)\b/i.test(candidateText)
  ) {
    score -= 14;
  }
  if (/\b(hospital|building|doctor|physician|university|campus|portrait|statue|island|bridge|forest|lake|garden|flower|plant|botany|landscape|biography|scientist|inventor|nobel|pill|tablet|capsule|bottle|packaging|stethoscope|syringe|stock[\s_-]?photo|consecration|archbishop|cathedral|diocese|clergy|ordained|catholic|anglican)\b/i.test(candidateText)) {
    score -= 80;
  }
  if (
    /\b(?:ecg|ekg|electrocardiogram|eletrocardiograma|x-ray|radiograph|tomography|tomografia|ultrasound|ultrassom|ultrassonografia|e-?fast)\b/i.test(queryContextText) &&
    /(?:fluorescence|confocal|islet|pancrea|immunofluorescence|histolog|microscop|diatom|microfossil|brightfield)/i.test(candidateText)
  ) {
    score -= 90;
  }

  // 4b) Penalize Echocardiogram / M-mode / Doppler when card expects ECG tracing
  const expectsEcgQuery =
    /\b(?:ecg|ekg|electrocardiogra\w*|eletrocardiogra\w*|stemi|flutter|fibrillation|brugada|wpw|delta\s+wave|bundle\s+branch|peaked\s+t\s+wave|av\s+block|torsades)\b/i.test(
      queryContextText
    ) &&
    !/\b(?:echocardiogra\w*|ecocardiogra\w*|doppler|m[-\s]?mode)\b/i.test(queryContextText);
  if (
    expectsEcgQuery &&
    /\b(?:echocardiogra\w*|ecocardiogra\w*|echopedia|m[-\s]?mode|doppler|ultrasound|sonogram|sonography)\b/i.test(
      candidateText
    )
  ) {
    score -= 85;
  }

  // 4c) Penalize normal sinus/healthy ECGs when query asks for a specific arrhythmia or ischemia pathology
  const expectsPathology =
    /\b(?:stemi|infarction|ischemia|flutter|fibrillation|block|wpw|brugada|hyperkalemia|vt|svt|torsades|supradesnivelamento|infradesnivelamento|arritmia|bloqueio|taquicardia)\b/i.test(
      queryContextText
    ) && !/\b(?:normal\s+sinus|ritmo\s+sinusal\s+normal)\b/i.test(queryContextText);
  const normalEcgRegex =
    /\b(?:normal\s+(?:sinus|ecg|ekg|12[-\s]?lead|rhythm)|sinus\s+rhythm\s+normal|healthy\s+control)\b/i;
  if (expectsPathology && normalEcgRegex.test(candidate.title || '')) {
    score -= 45;
  } else if (
    expectsPathology &&
    normalEcgRegex.test(candidateText) &&
    answerHits + enHits < 2
  ) {
    score -= 32;
  }

  // 4d) Penalize animated GIFs (usually flashing schematics/loops unsuitable for static clinical Anki prompts)
  const cleanThumbLower = (candidate.thumbUrl || '').split('?')[0].toLowerCase();
  const cleanFullLower = (candidate.fullUrl || '').split('?')[0].toLowerCase();
  if (/\.gif$/i.test(cleanThumbLower) || /\.gif$/i.test(cleanFullLower)) {
    score -= 45;
  }

  return score;
}

export function buildEnglishMedicalSearchQueries(
  rawQuery: string,
  topic = '',
  question = '',
  answer = ''
): string[] {
  const queries: string[] = [];
  const primaryText = `${answer} ${rawQuery} ${topic}`.trim();
  const isEcgContext = /\b(?:ecg|ekg|eletrocardiograma|tra[cç]ado|qrs|onda\s+[prqt]|onda\s+delta|v1|v6|derivac|arritmia|bloqueio\s+de\s+ramo)\b/i.test(
    `${primaryText} ${question}`
  );

  for (const [regex, enTerm] of PT_TO_EN_MEDICAL_TERMS) {
    regex.lastIndex = 0;
    if (regex.test(primaryText) && !queries.includes(enTerm)) {
      queries.push(enTerm);
      if (queries.length >= 2) break;
    }
  }

  if (queries.length === 0 && question) {
    for (const [regex, enTerm] of PT_TO_EN_MEDICAL_TERMS) {
      regex.lastIndex = 0;
      if (isEcgContext && /chest x-ray/i.test(enTerm)) continue;
      if (regex.test(question) && !queries.includes(enTerm)) {
        queries.push(enTerm);
        if (queries.length >= 2) break;
      }
    }
  }

  const stripped = (answer || rawQuery || topic)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(
      /\b(?:na|no|nos|nas|em|de|do|da|dos|das|para|com|sem|qual|quais|conduta|imediata|primeira|escolha|linha|tratamento|manejo|paciente|gestante|evolui|apresenta|reacao|adversa|exame|achado|orelha|coelho|torre|padrao)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped && !queries.includes(stripped)) {
    queries.push(isEcgContext && !/\becg\b/i.test(stripped) ? `${stripped} ECG` : stripped);
  }
  if (queries.length === 0) {
    queries.push(isEcgContext ? 'electrocardiogram arrhythmia ECG' : 'clinical medical imaging diagnosis');
  }
  return queries.slice(0, 3);
}

function combineSignals(parentSignal?: AbortSignal, timeoutMs = 4000): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!parentSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([parentSignal, timeoutSignal]);
  }
  return timeoutSignal;
}

async function expandMedicalQueriesWithGemini(
  ai: GoogleGenAI | null,
  rawQuery: string,
  topic = '',
  question = '',
  hint = '',
  signal?: AbortSignal,
  answer = ''
): Promise<string[]> {
  const fallbackQueries = buildEnglishMedicalSearchQueries(rawQuery, topic, question, answer);
  if (!ai) return fallbackQueries;

  try {
    const res = await generateContentWithRetry(
      ai,
      {
        model: FALLBACK_GEMINI_MODEL,
        contents: `Traduza e expanda esta busca clínica para encontrar IMAGENS MÉDICAS REAIS na internet (Wikimedia Commons, Wikipedia, Radiopaedia, LITFL, DermNet, PubMed).
REGRAS: Foque no diagnóstico principal e modalidade de exame (ex: se for ECG, inclua "ECG"). Ignore comorbidades secundárias da vinheta e nunca traduza metáforas ao pé da letra ("orelha de coelho", "em torre").
Retorne EXCLUSIVAMENTE um JSON array com 2 a 3 termos curtos em INGLÊS (2 a 5 palavras cada):
- Diagnóstico/Resposta: "${answer.slice(0, 120)}"
- Busca: "${rawQuery.slice(0, 120)}"
- Tópico: "${topic}"
- Pergunta: "${question.slice(0, 180)}"
- Comentário: "${hint.slice(0, 160)}"
Exemplo de saída: ["right bundle branch block ECG", "RBBB V1 ECG LITFL"]`,
        config: {
          responseMimeType: 'application/json',
          maxOutputTokens: 200,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      },
      { signal, timeoutMs: 4500, enableModelFallback: false }
    );

    const parsed = JSON.parse(extractJsonBlock(res.text || '[]'));
    if (Array.isArray(parsed)) {
      const llmQueries = parsed
        .map((q) => String(q || '').trim())
        .filter((q) => q.length >= 3 && q.length <= 70);
      if (llmQueries.length > 0) {
        return Array.from(new Set([...llmQueries, ...fallbackQueries])).slice(0, 3);
      }
    }
  } catch {
    // Silent fallback to deterministic PT->EN medical dictionary
  }
  return fallbackQueries;
}

function buildSuggestedMediaFilename(
  rawBaseName: string,
  targetUrl: string,
  mime = '',
  fallbackSlug = 'med_image'
): string {
  const urlPath = (targetUrl || '').split('?')[0].split('#')[0];
  const extMatch = urlPath.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i);
  const mimeLower = (mime || '').toLowerCase();
  const resolvedExt = extMatch
    ? `.${extMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : extMatch[1].toLowerCase()}`
    : mimeLower.includes('png')
      ? '.png'
      : mimeLower.includes('webp')
        ? '.webp'
        : mimeLower.includes('gif')
          ? '.gif'
          : mimeLower.includes('svg')
            ? '.svg'
            : '.jpg';
  const cleanStem = (rawBaseName || fallbackSlug)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return `${cleanStem || fallbackSlug}${resolvedExt}`;
}

export async function searchWikipediaMedicalImages(
  enQueries: string[],
  ptQuery: string,
  signal?: AbortSignal
): Promise<MedicalImageCandidate[]> {
  const enCandidates = Array.from(
    new Set(
      enQueries
        .map((q) => (q || '').split(/\s+/).slice(0, 4).join(' ').trim())
        .filter(Boolean)
    )
  ).slice(0, 2);
  const searches: Array<{ lang: 'en' | 'pt'; query: string }> = [
    ...enCandidates.map((query) => ({ lang: 'en' as const, query })),
    ...(ptQuery ? [{ lang: 'pt' as const, query: ptQuery }] : []),
  ];

  const results: MedicalImageCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const { lang, query } of searches) {
    if (signal?.aborted || results.length >= 8) break;
    try {
      const searchUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      searchUrl.searchParams.set('action', 'query');
      searchUrl.searchParams.set('list', 'search');
      searchUrl.searchParams.set('srsearch', query);
      searchUrl.searchParams.set('srlimit', '4');
      searchUrl.searchParams.set('format', 'json');
      searchUrl.searchParams.set('origin', '*');

      const sResp = await fetch(searchUrl.toString(), {
        headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
        signal: combineSignals(signal, 3500),
      });
      if (!sResp.ok) continue;
      const sData = (await sResp.json()) as {
        query?: { search?: Array<{ title?: string }> };
      };
      const titles = (sData.query?.search || [])
        .map((item) => item.title)
        .filter((t): t is string => Boolean(t));
      if (titles.length === 0) continue;

      const pagesUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      pagesUrl.searchParams.set('action', 'query');
      pagesUrl.searchParams.set('titles', titles.join('|'));
      pagesUrl.searchParams.set('prop', 'pageimages|images');
      pagesUrl.searchParams.set('piprop', 'original|thumbnail');
      pagesUrl.searchParams.set('pithumbsize', '900');
      pagesUrl.searchParams.set('imlimit', '20');
      pagesUrl.searchParams.set('format', 'json');
      pagesUrl.searchParams.set('origin', '*');

      const pResp = await fetch(pagesUrl.toString(), {
        headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
        signal: combineSignals(signal, 3500),
      });
      if (!pResp.ok) continue;
      const pData = (await pResp.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              pageid?: number;
              title?: string;
              thumbnail?: { source?: string; width?: number; height?: number };
              original?: { source?: string; width?: number; height?: number };
              images?: Array<{ title?: string }>;
            }
          >;
        };
      };

      const expectedTokenSet = new Set(
        tokenizeNormalized([...enQueries, ptQuery].join(' ')).filter(
          (tok) => !['medical', 'clinical', 'exam', 'image', 'photo', 'sign'].includes(tok)
        )
      );

      const fileTitles = new Set<string>();
      for (const page of Object.values(pData.query?.pages || {})) {
        // 1) Prefer the Wikipedia article's primary lead pageimage first
        const leadUrl = page.thumbnail?.source || page.original?.source;
        const leadWidth = page.thumbnail?.width || page.original?.width || 400;
        const leadHeight = page.thumbnail?.height || page.original?.height || 300;
        if (
          leadUrl &&
          leadWidth >= 200 &&
          leadHeight >= 130 &&
          !isSpamOrLogoImageUrl(leadUrl, page.title || '')
        ) {
          const canonicalKey = normalizeImageCanonicalKey(leadUrl, page.title || '');
          if (!seenKeys.has(canonicalKey)) {
            seenKeys.add(canonicalKey);
            results.push({
              id: `wp-${lang}-lead-${page.pageid || results.length}`,
              title: (page.title || query).slice(0, 85),
              thumbUrl: leadUrl,
              fullUrl: page.original?.source || leadUrl,
              description: `Imagem principal do artigo médico "${page.title || query}" (${lang}.wikipedia.org).`,
              suggestedFilename: buildSuggestedMediaFilename(
                page.title || query,
                leadUrl,
                '',
                'wikipedia_med'
              ),
              defaultLegend: `Imagem clínica referente a ${page.title || query}.`,
              source: `Wikipedia Medical (${lang.toUpperCase()})`,
              isSvg: isSvgImageUrl(leadUrl),
            });
          }
        }

        // 2) Only keep secondary embedded article files that lexically or clinically match the query/modality
        for (const img of page.images || []) {
          if (!img.title || isSpamOrLogoImageUrl(img.title, img.title)) continue;
          const fileToks = tokenizeNormalized(img.title);
          const sharesToken =
            expectedTokenSet.size === 0 ||
            fileToks.some((t) => expectedTokenSet.has(t)) ||
            MODALITY_KEYWORDS.some(
              (m) => m.ptEnTrigger.test(`${enQueries.join(' ')} ${ptQuery}`) && m.candidateMatch.test(img.title || '')
            );
          if (sharesToken) {
            fileTitles.add(img.title);
          }
        }
      }

      if (fileTitles.size === 0) continue;
      const fileList = Array.from(fileTitles).slice(0, 12);

      const infoUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      infoUrl.searchParams.set('action', 'query');
      infoUrl.searchParams.set('titles', fileList.join('|'));
      infoUrl.searchParams.set('prop', 'imageinfo');
      infoUrl.searchParams.set('iiprop', 'url|mime|size|extmetadata');
      infoUrl.searchParams.set('iiurlwidth', '900');
      infoUrl.searchParams.set('format', 'json');
      infoUrl.searchParams.set('origin', '*');

      const iResp = await fetch(infoUrl.toString(), {
        headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
        signal: combineSignals(signal, 3500),
      });
      if (!iResp.ok) continue;
      const iData = (await iResp.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              pageid?: number;
              title?: string;
              imageinfo?: Array<{
                thumburl?: string;
                url?: string;
                mime?: string;
                width?: number;
                height?: number;
                extmetadata?: { ImageDescription?: { value?: string } };
              }>;
            }
          >;
        };
      };

      for (const [idx, page] of Object.values(iData.query?.pages || {}).entries()) {
        const info = page.imageinfo?.[0];
        if (!info?.url) continue;
        const mime = (info.mime || '').toLowerCase();
        if (!mime.startsWith('image/')) continue;
        if ((info.width || 0) < 220 || (info.height || 0) < 140) continue;

        const targetUrl = info.thumburl || info.url;
        if (isSpamOrLogoImageUrl(targetUrl, page.title || '')) continue;
        const canonicalKey = normalizeImageCanonicalKey(targetUrl, page.title || '');
        if (seenKeys.has(canonicalKey)) continue;
        seenKeys.add(canonicalKey);

        const rawTitle = (page.title || `Wikipedia Medical ${idx + 1}`).replace(
          /^(?:File|Ficheiro|Arquivo):/i,
          ''
        );
        const descHtml = info.extmetadata?.ImageDescription?.value || rawTitle;
        const cleanDesc = descHtml
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);

        results.push({
          id: `wp-${lang}-${page.pageid || idx}`,
          title: rawTitle.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 85),
          thumbUrl: targetUrl,
          fullUrl: info.url,
          description: cleanDesc || `Imagem médica enciclopédica (${lang}.wikipedia.org).`,
          suggestedFilename: buildSuggestedMediaFilename(
            rawTitle,
            targetUrl,
            mime,
            `wikipedia_${page.pageid || idx}`
          ),
          defaultLegend: cleanDesc
            ? `Imagem clínica demonstrando ${cleanDesc.slice(0, 130)}.`
            : `Imagem clínica real referente a ${query}.`,
          source: `Wikipedia Medical (${lang.toUpperCase()})`,
          isSvg: isSvgImageUrl(targetUrl, mime),
        });
      }
    } catch {
      // Continue to fallback query
    }
  }

  return results;
}

export async function searchWikimediaCommonsMedical(
  enQueries: string[],
  signal?: AbortSignal
): Promise<MedicalImageCandidate[]> {
  const results: MedicalImageCandidate[] = [];
  const seenKeys = new Set<string>();
  const baseWords = (enQueries[0] || '').split(/\s+/).filter(Boolean);
  const firstClean = (baseWords[0] || '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  const singleSpecificFallback =
    /^(?:partogra\w*|cardiotocograph\w*|episiotomy|mcroberts|pelvimetry|electrocardiogra\w*|pneumothorax|pneumoperitoneum|intussusception|retinopathy|papilledema|cholecystitis|appendicitis|diverticulitis|pancreatitis)$/i.test(
      firstClean
    )
      ? [firstClean]
      : [];
  const candidateSearches = Array.from(
    new Set(
      [
        baseWords.slice(0, 3).join(' '),
        baseWords.slice(0, 2).join(' '),
        ...(enQueries[1] ? [enQueries[1].split(/\s+/).slice(0, 3).join(' ')] : []),
        ...singleSpecificFallback,
      ].filter((q) => q.length >= 3)
    )
  );

  for (const enQuery of candidateSearches) {
    if (signal?.aborted || results.length >= 6) break;
    try {
      const url = new URL('https://commons.wikimedia.org/w/api.php');
      url.searchParams.set('action', 'query');
      url.searchParams.set('generator', 'search');
      url.searchParams.set('gsrsearch', enQuery);
      url.searchParams.set('gsrnamespace', '6');
      url.searchParams.set('gsrlimit', '12');
      url.searchParams.set('prop', 'imageinfo');
      url.searchParams.set('iiprop', 'url|mime|size|extmetadata');
      url.searchParams.set('iiurlwidth', '900');
      url.searchParams.set('format', 'json');
      url.searchParams.set('origin', '*');

      const resp = await fetch(url.toString(), {
        headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
        signal: combineSignals(signal, 3500),
      });
      if (!resp.ok) continue;

      const data = (await resp.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              pageid?: number;
              title?: string;
              imageinfo?: Array<{
                thumburl?: string;
                url?: string;
                mime?: string;
                width?: number;
                height?: number;
                extmetadata?: {
                  ImageDescription?: { value?: string };
                };
              }>;
            }
          >;
        };
      };

      const pages = Object.values(data?.query?.pages || {}).sort((a, b) => {
        const aAnn = /annotation|labeled|arrow/i.test(a.title || '') ? 1 : 0;
        const bAnn = /annotation|labeled|arrow/i.test(b.title || '') ? 1 : 0;
        return aAnn - bAnn;
      });

      for (const [idx, p] of pages.entries()) {
        const info = p.imageinfo?.[0];
        if (!info?.url) continue;
        const mime = (info.mime || '').toLowerCase();
        if (!mime.startsWith('image/')) continue;
        if ((info.width || 0) < 220 || (info.height || 0) < 140) continue;

        const targetUrl = info.thumburl || info.url;
        const rawTitle = (p.title || `Imagem Médica ${idx + 1}`).replace(/^File:/i, '');
        if (isSpamOrLogoImageUrl(targetUrl, rawTitle)) continue;
        const canonicalKey = normalizeImageCanonicalKey(targetUrl, rawTitle);
        if (seenKeys.has(canonicalKey)) continue;
        seenKeys.add(canonicalKey);

        const descHtml = info.extmetadata?.ImageDescription?.value || rawTitle;
        const cleanDesc = descHtml
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);

        results.push({
          id: `wiki-${p.pageid || idx}`,
          title: rawTitle.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 85),
          thumbUrl: targetUrl,
          fullUrl: info.url,
          description: cleanDesc || 'Imagem médica real obtida no Wikimedia Commons.',
          suggestedFilename: buildSuggestedMediaFilename(
            rawTitle,
            targetUrl,
            mime,
            `wikimedia_${p.pageid || idx}`
          ),
          defaultLegend: cleanDesc
            ? `Exame complementar demonstrando ${cleanDesc.slice(0, 130)}.`
            : `Imagem diagnóstica demonstrando achado clínico real de ${enQuery}.`,
          source: 'Wikimedia Commons Medical',
          isSvg: isSvgImageUrl(targetUrl, mime),
        });
      }
    } catch {
      // Continue to shorter query fallback
    }
  }

  return results;
}

async function validateCandidateImageUrl(
  url: string,
  signal?: AbortSignal
): Promise<{
  ok: boolean;
  contentType: string;
  byteLength: number;
  isSvg: boolean;
}> {
  if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
    return { ok: false, contentType: '', byteLength: 0, isSvg: false };
  }
  if (isSpamOrLogoImageUrl(url)) {
    return { ok: false, contentType: '', byteLength: 0, isSvg: false };
  }
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; InternatoFirstCardArchitect/2.0; +https://github.com/wagmms/Cards-2.0)',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: combineSignals(signal, 4000),
    });
    if (!resp.ok) {
      return { ok: false, contentType: '', byteLength: 0, isSvg: false };
    }
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      return { ok: false, contentType, byteLength: 0, isSvg: false };
    }
    const isSvg = isSvgImageUrl(url, contentType);
    const buf = Buffer.from(await resp.arrayBuffer());
    const minBytes = isSvg ? 1500 : 3000;
    if (buf.length < minBytes) {
      return { ok: false, contentType, byteLength: buf.length, isSvg };
    }
    return { ok: true, contentType, byteLength: buf.length, isSvg };
  } catch {
    return { ok: false, contentType: '', byteLength: 0, isSvg: false };
  }
}

export function extractEditorialImageUrlsFromHtml(
  html: string,
  pageUrl: string,
  pageTitle = ''
): Array<{ url: string; alt: string; pageUrl: string; pageTitle: string }> {
  const extracted: Array<{ url: string; alt: string; pageUrl: string; pageTitle: string }> = [];
  const seen = new Set<string>();

  const addCandidate = (rawSrc: string, alt = '') => {
    const trimmed = rawSrc.trim().replace(/&amp;/g, '&');
    if (!trimmed || trimmed.startsWith('data:')) return;
    try {
      const resolved = new URL(trimmed, pageUrl).toString();
      if (!resolved.startsWith('http')) return;
      if (isSpamOrLogoImageUrl(resolved, alt)) return;
      const canonical = normalizeImageCanonicalKey(resolved, alt);
      if (seen.has(canonical)) return;
      seen.add(canonical);
      extracted.push({ url: resolved, alt: alt.trim(), pageUrl, pageTitle });
    } catch {
      // Ignore malformed URLs
    }
  };

  // Prefer editorial content containers (<main>, <article>, <figure>) over navigation/sidebars
  const mainMatch = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/i)?.[0] || '';
  const articleMatches = (html.match(/<article\b[^>]*>[\s\S]*?<\/article>/gi) || []).join(' ');
  const figureMatches = (html.match(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi) || []).join(' ');
  const cleanedBodyFallback = html
    .replace(/<(nav|aside|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const editorialHtml =
    [figureMatches, articleMatches, mainMatch].filter((s) => s.length > 80).join(' ') ||
    cleanedBodyFallback;

  const scanImgTags = (sourceHtml: string) => {
    const imgRegex = /<img\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRegex.exec(sourceHtml)) !== null && extracted.length < 10) {
      const tag = m[0];
      const srcMatch = /\b(?:data-lazy-src|data-src|src)=["']([^"']+)["']/i.exec(tag);
      if (!srcMatch) continue;
      const altMatch = /\balt=["']([^"']*)["']/i.exec(tag);
      const widthMatch = /\bwidth=["']?(\d+)/i.exec(tag);
      if (widthMatch && Number(widthMatch[1]) > 0 && Number(widthMatch[1]) < 150) {
        continue;
      }
      addCandidate(srcMatch[1], altMatch?.[1] || pageTitle);
    }
  };

  scanImgTags(editorialHtml);
  if (extracted.length === 0 && editorialHtml !== cleanedBodyFallback) {
    scanImgTags(cleanedBodyFallback);
  }

  const isLikelySiteCard = (u: string) =>
    /(?:default|site[-_]?image|og[-_]?default|social[-_]?card|share[-_]?img|brand|header|masthead|cropped-)/i.test(
      u
    );
  let m: RegExpExecArray | null;
  const metaRegex =
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  while ((m = metaRegex.exec(html)) !== null) {
    if (!isLikelySiteCard(m[1])) {
      addCandidate(m[1], pageTitle);
    }
  }
  const metaReverseRegex =
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]*>/gi;
  while ((m = metaReverseRegex.exec(html)) !== null) {
    if (!isLikelySiteCard(m[1])) {
      addCandidate(m[1], pageTitle);
    }
  }

  return extracted;
}

async function extractImagesFromMedicalWebPage(
  pageUrl: string,
  pageTitle = '',
  signal?: AbortSignal
): Promise<Array<{ url: string; alt: string; pageUrl: string; pageTitle: string }>> {
  if (!pageUrl || !pageUrl.startsWith('http')) return [];
  try {
    const resp = await fetch(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      signal: combineSignals(signal, 3500),
    });
    if (!resp.ok) return [];
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return [];

    const html = (await resp.text()).slice(0, 220000);
    return extractEditorialImageUrlsFromHtml(html, pageUrl, pageTitle);
  } catch {
    return [];
  }
}

export async function searchGoogleMedicalImagesViaGrounding(
  ai: GoogleGenAI | null,
  searchQuery: string,
  topic = '',
  question = '',
  enQueries: string[] = [],
  signal?: AbortSignal
): Promise<MedicalImageCandidate[]> {
  if (!ai || signal?.aborted) return [];

  const enLabel = enQueries[0] || searchQuery;
  const prompt = `Pesquise na Web páginas médicas reais (LITFL, Radiopaedia, Wikimedia Commons, Wikipedia, DermNet NZ, SciELO, PubMed Central) com exames de imagem, traçados (ECG/CTG) ou fotos clínicas reais disponíveis publicamente sobre:
- Busca: "${searchQuery}" (${enLabel})
- Tópico: "${topic}"
- Contexto: "${question.slice(0, 180)}"

Retorne EXCLUSIVAMENTE um array JSON válido com até 5 referências encontradas no Google Search:
[
  {
    "title": "Título conciso do achado visual",
    "imageUrl": "URL direta do arquivo de imagem (.jpg/.png/.webp) ou URL da página médica encontrada",
    "description": "Descrição clínica objetiva do exame sem entregar o diagnóstico final",
    "source": "LITFL / Radiopaedia / Wikimedia / Wikipedia / DermNet / SciELO",
    "suggestedFilename": "nome_limpo_exame.jpg",
    "defaultLegend": "Exame complementar evidenciando [descrição morfológica do achado]."
  }
]`;

  try {
    const response = await generateContentWithRetry(
      ai,
      {
        model: FALLBACK_GEMINI_MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      },
      { signal, timeoutMs: 12_000, enableModelFallback: false }
    );

    const directCandidates: Array<{
      url: string;
      title: string;
      description: string;
      source: string;
      suggestedFilename: string;
      defaultLegend: string;
    }> = [];
    const groundedPages: Array<{ url: string; title: string }> = [];

    for (const src of response.groundingSources || []) {
      if (src.uri && src.uri.startsWith('http')) {
        groundedPages.push({ url: src.uri, title: src.title || searchQuery });
      }
    }

    try {
      const parsed = JSON.parse(extractJsonBlock(response.text || '[]'));
      const arr: Array<Record<string, unknown>> = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.images)
        ? parsed.images
        : [];
      for (const item of arr.slice(0, 6)) {
        const rawUrl = String(item.imageUrl || item.url || item.thumbUrl || '').trim();
        if (!rawUrl.startsWith('http')) continue;
        if (/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(rawUrl)) {
          directCandidates.push({
            url: rawUrl,
            title: String(item.title || searchQuery).slice(0, 85),
            description: String(item.description || `Exame referente a ${searchQuery}.`).slice(
              0,
              180
            ),
            source: String(item.source || 'Google Search Grounding'),
            suggestedFilename: String(item.suggestedFilename || 'google_med_img.jpg'),
            defaultLegend: String(
              item.defaultLegend || `Imagem clínica referente a ${searchQuery}.`
            ),
          });
        } else {
          groundedPages.push({ url: rawUrl, title: String(item.title || searchQuery) });
        }
      }
    } catch {
      // Model might not have emitted strict JSON alongside groundingChunks
    }

    const uniquePages = Array.from(
      new Map(groundedPages.map((p) => [p.url, p])).values()
    ).slice(0, 5);

    const pageExtracts = await Promise.all(
      uniquePages.map((page) =>
        extractImagesFromMedicalWebPage(page.url, page.title, signal)
      )
    );

    for (const extractedList of pageExtracts) {
      for (const item of extractedList.slice(0, 3)) {
        let hostLabel = 'Medical Web (Google)';
        try {
          hostLabel = new URL(item.pageUrl).hostname.replace(/^www\./, '');
        } catch {
          // ignore
        }
        directCandidates.push({
          url: item.url,
          title: (item.alt || item.pageTitle || searchQuery).slice(0, 85),
          description: `Imagem real extraída de ${hostLabel}: ${(item.alt || item.pageTitle).slice(0, 140)}`,
          source: `${hostLabel} (via Google Search)`,
          suggestedFilename: (item.alt || item.pageTitle || searchQuery)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 44),
          defaultLegend: `Imagem clínica real (${hostLabel}) demonstrando ${(item.alt || item.pageTitle).slice(0, 110)}.`,
        });
      }
    }

    const uniqueDirect = Array.from(
      new Map(
        directCandidates.map((c) => [normalizeImageCanonicalKey(c.url, c.title), c])
      ).values()
    ).slice(0, 12);

    const validated = await Promise.all(
      uniqueDirect.map(async (item, idx) => {
        const check = await validateCandidateImageUrl(item.url, signal);
        if (!check.ok) return null;

        const ext = check.contentType.includes('png')
          ? '.png'
          : check.contentType.includes('webp')
          ? '.webp'
          : check.contentType.includes('svg')
          ? '.svg'
          : '.jpg';
        const cleanBase = item.suggestedFilename
          .toLowerCase()
          .replace(/\.[a-z0-9]+$/i, '')
          .replace(/[^a-z0-9_]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 48);

        return {
          id: `google-web-${idx}-${Date.now()}`,
          title: item.title,
          thumbUrl: item.url,
          fullUrl: item.url,
          description: item.description,
          suggestedFilename: `${cleanBase || `google_med_${idx + 1}`}${ext}`,
          defaultLegend: item.defaultLegend,
          source: item.source,
          isSvg: check.isSvg,
        } satisfies MedicalImageCandidate;
      })
    );

    return validated.filter((item): item is NonNullable<typeof item> => item !== null);
  } catch {
    return [];
  }
}

/**
 * Busca imagens médicas reais em paralelo (Google Search Grounding + Wikipedia Medical + Wikimedia Commons),
 * aplica deduplicação canônica (inclusive resoluções diferentes do mesmo arquivo Wikimedia) e
 * ordena pelo score clínico de relevância (modalidade, léxico PT/EN, confiabilidade da fonte e raster vs SVG).
 */
async function searchOpeniMedicalImages(
  enQueries: string[],
  rawSearch: string,
  signal?: AbortSignal
): Promise<MedicalImageCandidate[]> {
  if (signal?.aborted) return [];
  const q = (enQueries[0] || rawSearch || '').trim();
  if (!q) return [];

  try {
    const url = new URL('https://openi.nlm.nih.gov/api/search');
    url.searchParams.set('m', '1');
    url.searchParams.set('n', '8');
    url.searchParams.set('query', q);
    if (/\b(x[\s_-]?ray|radiograph|chest)\b/i.test(q)) url.searchParams.set('it', 'x');
    else if (/\b(ct|computed tomography|tomography)\b/i.test(q)) url.searchParams.set('it', 'c');
    else if (/\b(mri|magnetic resonance)\b/i.test(q)) url.searchParams.set('it', 'm');
    else if (/\b(ultrasound|sonography|echocardiogram|doppler)\b/i.test(q)) url.searchParams.set('it', 'u');

    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': WIKIMEDIA_USER_AGENT, Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      list?: Array<{
        uid?: string;
        title?: string;
        imgLarge?: string;
        imgThumb?: string;
        imgGrid150?: string;
        pmcid?: string;
        Problems?: string;
      }>;
    };

    const results: MedicalImageCandidate[] = [];
    for (let idx = 0; idx < (data.list || []).length; idx++) {
      const item = data.list![idx];
      const rawLarge = (item.imgLarge || item.imgThumb || '').trim();
      if (!rawLarge) continue;
      const fullUrl = rawLarge.startsWith('http')
        ? rawLarge
        : `https://openi.nlm.nih.gov${rawLarge.startsWith('/') ? '' : '/'}${rawLarge}`;
      const rawThumb = (item.imgThumb || item.imgGrid150 || rawLarge).trim();
      const thumbUrl = rawThumb.startsWith('http')
        ? rawThumb
        : `https://openi.nlm.nih.gov${rawThumb.startsWith('/') ? '' : '/'}${rawThumb}`;

      if (isSpamOrLogoImageUrl(fullUrl)) continue;
      const title = (item.title || q).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
      const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42);
      results.push({
        id: `openi-${item.uid || idx}-${Date.now()}`,
        title: title || q,
        thumbUrl,
        fullUrl,
        description: (item.Problems || title || `Imagem científica Open-i/NIH referente a ${q}.`).slice(0, 180),
        suggestedFilename: `openi_${baseSlug || `med_${idx + 1}`}.jpg`,
        defaultLegend: `Exame médico indexado (Open-i/NIH) compatível com ${q}.`,
        source: 'Open-i (NLM/NIH)',
        isSvg: false,
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function searchSerperMedicalImages(
  enQueries: string[],
  rawSearch: string,
  signal?: AbortSignal
): Promise<MedicalImageCandidate[]> {
  if (signal?.aborted) return [];
  const apiKey = (process.env.SERPER_API_KEY || '').trim();
  if (!apiKey) return [];

  const q = (enQueries[0] || rawSearch || '').trim();
  if (!q) return [];

  try {
    const resp = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, num: 8 }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      images?: Array<{
        title?: string;
        imageUrl?: string;
        thumbnailUrl?: string;
        domain?: string;
        source?: string;
        imageWidth?: number;
        imageHeight?: number;
      }>;
    };

    const results: MedicalImageCandidate[] = [];
    for (let idx = 0; idx < (data.images || []).length; idx++) {
      const item = data.images![idx];
      const fullUrl = (item.imageUrl || '').trim();
      if (!fullUrl.startsWith('http') || isSpamOrLogoImageUrl(fullUrl)) continue;
      if (item.imageWidth && item.imageWidth < 150) continue;
      const thumbUrl = (item.thumbnailUrl || fullUrl).trim();
      const title = (item.title || q).replace(/\s+/g, ' ').trim().slice(0, 90);
      const extMatch = fullUrl.match(/\.(png|jpe?g|webp)(?:\?|$)/i);
      const ext = extMatch ? `.${extMatch[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
      const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42);
      const sourceDomain = item.domain || item.source || 'Google Images';
      results.push({
        id: `serper-${idx}-${Date.now()}`,
        title,
        thumbUrl,
        fullUrl,
        description: `Imagem encontrada em ${sourceDomain} referente a ${rawSearch}.`.slice(0, 180),
        suggestedFilename: `${baseSlug || `google_med_${idx + 1}`}${ext}`,
        defaultLegend: `Exame ou imagem clínica (${sourceDomain}) referente a ${rawSearch}.`,
        source: `Google Images Serper (${sourceDomain})`,
        isSvg: isSvgImageUrl(fullUrl),
      });
    }
    return results;
  } catch {
    return [];
  }
}

export async function searchMedicalImages(
  ai: GoogleGenAI | null,
  ctx: SearchMedicalImagesContext
): Promise<{
  query: string;
  translatedQueries: string[];
  images: Array<Omit<MedicalImageCandidate, 'isSvg' | 'relevanceScore'>>;
}> {
  const {
    query = '',
    topic = '',
    question = '',
    answer = '',
    hint = '',
    deckKey = '',
    preferGoogleGrounding = true,
    signal,
  } = ctx;

  const rawSearch = (query || answer || topic || question || 'clinical diagnosis').trim();
  const enQueries = await expandMedicalQueriesWithGemini(
    ai,
    rawSearch,
    topic,
    question,
    hint,
    signal,
    answer
  );

  // Camada 1: Acervo Local (04_Mídias/) — instantâneo e custo zero
  const localHits = searchLocalMediaArchive({
    query: rawSearch,
    topic,
    question,
    answer,
    deckKey,
    limit: 6,
  }).map((hit, idx): MedicalImageCandidate => {
    const localUrl = `/api/media/local-file?rel=${encodeURIComponent(hit.entry.relPath)}`;
    return {
      id: `local-${idx}-${hit.entry.filename}`,
      title: hit.entry.captionHint.slice(0, 90),
      thumbUrl: localUrl,
      fullUrl: localUrl,
      description: hit.entry.captionHint.slice(0, 180),
      suggestedFilename: hit.entry.filename,
      defaultLegend: `${hit.entry.captionHint.slice(0, 140)} (acervo local do curso).`,
      source: 'Acervo Local (04_Mídias)',
      fromMaterial: true,
      isSvg: false,
      relevanceScore: 30 + Math.min(25, hit.score),
    };
  });

  // Camada 2: Fontes científicas/abertas gratuitas em paralelo (Open-i/NIH + Wikipedia + Wikimedia)
  const [openiSettled, wikipediaSettled, wikimediaSettled] = await Promise.allSettled([
    searchOpeniMedicalImages(enQueries, rawSearch, signal),
    searchWikipediaMedicalImages(enQueries, rawSearch, signal),
    searchWikimediaCommonsMedical(enQueries, signal),
  ]);

  const tier1And2: MedicalImageCandidate[] = [
    ...localHits,
    ...(openiSettled.status === 'fulfilled' ? openiSettled.value.slice(0, 8) : []),
    ...(wikipediaSettled.status === 'fulfilled' ? wikipediaSettled.value.slice(0, 8) : []),
    ...(wikimediaSettled.status === 'fulfilled' ? wikimediaSettled.value.slice(0, 8) : []),
  ];

  const scoreAndDedupe = (list: MedicalImageCandidate[]) => {
    const deduped = new Map<string, MedicalImageCandidate>();
    for (const candidate of list) {
      if (!candidate) continue;
      const key = candidate.fromMaterial
        ? `local:${candidate.suggestedFilename.toLowerCase()}`
        : normalizeImageCanonicalKey(candidate.thumbUrl || candidate.fullUrl, candidate.title);
      const computedScore = candidate.fromMaterial
        ? candidate.relevanceScore ?? 40
        : scoreImageRelevance(candidate, {
            query: rawSearch,
            topic,
            question,
            answer,
            enQueries,
          });
      const scored: MedicalImageCandidate = { ...candidate, relevanceScore: computedScore };
      const existing = deduped.get(key);
      if (!existing || (scored.relevanceScore ?? 0) > (existing.relevanceScore ?? 0)) {
        deduped.set(key, scored);
      }
    }
    return Array.from(deduped.values());
  };

  let allScored = scoreAndDedupe(tier1And2);
  const strongCount = allScored.filter((c) => !c.isSvg && (c.relevanceScore ?? 0) >= 18).length;

  // Camada 3: Google Imagens via Serper.dev somente se camadas 1+2 tiverem < 3 hits fortes
  if (strongCount < 3) {
    const serperResults = await searchSerperMedicalImages(enQueries, rawSearch, signal);
    if (serperResults.length > 0) {
      allScored = scoreAndDedupe([...allScored, ...serperResults]);
    }
  }

  // Camada 4: Gemini googleSearch grounding somente como último recurso
  const strongAfterCse = allScored.filter((c) => !c.isSvg && (c.relevanceScore ?? 0) >= 18).length;
  if (preferGoogleGrounding && strongAfterCse < 3 && ai) {
    const groundingResults = await searchGoogleMedicalImagesViaGrounding(
      ai,
      rawSearch,
      topic,
      question,
      enQueries,
      signal
    );
    if (groundingResults.length > 0) {
      allScored = scoreAndDedupe([...allScored, ...groundingResults]);
    }
  }

  const maxScore = allScored.reduce((m, c) => Math.max(m, c.relevanceScore ?? 0), 0);
  const minThreshold = maxScore >= 28 ? 18 : 12;

  const ranked = allScored
    .filter((c) => (c.relevanceScore ?? 0) >= minThreshold)
    .sort((a, b) => {
      // Static raster (jpg/png/webp) always outranks animated GIF and schematic SVG
      const aSvg = Boolean(a.isSvg);
      const bSvg = Boolean(b.isSvg);
      if (aSvg !== bSvg) return aSvg ? 1 : -1;
      const aGif = /\.gif(?:\?|$)/i.test(a.thumbUrl || a.fullUrl);
      const bGif = /\.gif(?:\?|$)/i.test(b.thumbUrl || b.fullUrl);
      if (aGif !== bGif) return aGif ? 1 : -1;
      return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
    })
    .slice(0, 12)
    .map(({ isSvg: _omitSvg, relevanceScore: _omitScore, ...rest }) => rest);

  return {
    query: rawSearch,
    translatedQueries: enQueries,
    images: ranked,
  };
}
