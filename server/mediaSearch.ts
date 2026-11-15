import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  extractJsonBlock,
  FALLBACK_GEMINI_MODEL,
  generateContentWithRetry,
  PRIMARY_GEMINI_MODEL,
} from './geminiClient';

export interface MedicalImageCandidate {
  id: string;
  title: string;
  thumbUrl: string;
  fullUrl: string;
  description: string;
  suggestedFilename: string;
  defaultLegend: string;
  source: string;
  isSvg?: boolean;
  relevanceScore?: number;
}

export interface SearchMedicalImagesContext {
  query: string;
  topic?: string;
  question?: string;
  answer?: string;
  hint?: string;
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
  [/\bcardiotocografia|dip\s+ii|desacelera[cç][aã]o|sofrimento\s+fetal|taquissistolia|uterot[oô]nic/gi, 'cardiotocography fetal heart rate late deceleration CTG'],
  [/\bindu[cç][aã]o\s+do\s+parto|misoprostol|ocitocina\b/gi, 'cardiotocography uterine tachysystole labor induction'],
  [/\bpr[eé][-\s]?ecl[aâ]mpsia|ecl[aâ]mpsia|s[ií]ndrome\s+hellp\b/gi, 'HELLP syndrome schistocytes peripheral blood smear'],
  [/\bhemorragia\s+p[oó]s[-\s]?parto|bal[aã]o\s+de\s+bakri|atonia\s+uterina\b/gi, 'postpartum hemorrhage Bakri balloon tamponade'],
  [/\bgravidez\s+ect[oó]pica\b/gi, 'ectopic pregnancy transvaginal ultrasound'],
  [/\bdescolamento\s+prematuro\s+de\s+placenta|placenta\s+pr[eé]via\b/gi, 'placental abruption placenta previa ultrasound'],
  [/\bpartograma\b/gi, 'partogram labor progression WHO curve'],
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
  /(?:logo|icon|favicon|avatar|gravatar|pb-primary|dark-mode|banner|badge|pixel|1x1|sprite|spinner|button|social|share|commons-logo|ambox|edit-clear|question_book|crystal_clear|padlock|symbol_|flag_of_|coat_of_arms|map_of_|blank_map|wikimedia-button|poweredby|boeing|airlines|airport|stamp_of_|coin_|portrait_of_|bust_of_|headshot)/i;

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
    ptEnTrigger: /\b(ctg|cardiotocografia|desaceleracao|dip|taquissistolia|fetal)\b/i,
    candidateMatch: /\b(ctg|cardiotocography|fetal|deceleration|tachysystole|contraction|trace)\b/i,
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
    enQueries?: string[];
  }
): number {
  let score = 0;

  const queryContextText = [
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
        score -= 8;
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

  // 2) Lexical overlap with English expanded queries and original Portuguese terms
  const enTokens = new Set(tokenizeNormalized((context.enQueries || []).join(' ')));
  const ptTokens = new Set(
    tokenizeNormalized(`${context.query} ${context.topic || ''}`)
  );
  const candTokens = new Set(tokenizeNormalized(candidateText));

  let enHits = 0;
  for (const tok of enTokens) {
    if (candTokens.has(tok)) enHits++;
  }
  let ptHits = 0;
  for (const tok of ptTokens) {
    if (candTokens.has(tok)) ptHits++;
  }
  score += Math.min(35, enHits * 9 + ptHits * 6);

  // 3) Source authority & clinical repository quality
  const srcLower = `${candidate.source} ${candidate.fullUrl}`.toLowerCase();
  if (/litfl|lifeinthefastlane/.test(srcLower)) score += 24;
  else if (/radiopaedia/.test(srcLower)) score += 24;
  else if (/dermnet/.test(srcLower)) score += 22;
  else if (/pmc\.ncbi|ncbi\.nlm\.nih|scielo|nejm|bmj|openi/.test(srcLower)) score += 18;
  else if (/wikipedia/.test(srcLower)) score += 14;
  else if (/wikimedia/.test(srcLower)) score += 10;
  else if (/google/.test(srcLower)) score += 8;

  // 4) Raster vs SVG & non-clinical artifacts
  if (candidate.isSvg || /\.svg(?:\?|$)/i.test(candidate.thumbUrl)) {
    score -= 22;
  }
  if (/\b(diagram|schematic|flowchart|cartoon|illustration|map|chart|graph)\b/i.test(candidateText)) {
    score -= 14;
  }
  if (/\b(hospital|building|doctor|physician|university|campus|portrait|statue|island|bridge|forest|lake|garden|flower|plant|botany|landscape)\b/i.test(candidateText)) {
    score -= 80;
  }
  if (
    /\b(?:ecg|ekg|electrocardiogram|eletrocardiograma|x-ray|radiograph|tomography|ultrasound)\b/i.test(queryContextText) &&
    /\b(?:fluorescence|confocal|islet|pancrea|immunofluorescence|histology|microscop)\b/i.test(candidateText)
  ) {
    score -= 90;
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
      { signal, timeoutMs: 8500, enableModelFallback: false }
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

export async function searchWikipediaMedicalImages(
  enQueries: string[],
  ptQuery: string,
  signal?: AbortSignal
): Promise<MedicalImageCandidate[]> {
  const primaryEn = (enQueries[0] || '').split(/\s+/).slice(0, 4).join(' ');
  const searches: Array<{ lang: 'en' | 'pt'; query: string }> = [
    ...(primaryEn ? [{ lang: 'en' as const, query: primaryEn }] : []),
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
              title?: string;
              images?: Array<{ title?: string }>;
            }
          >;
        };
      };

      const fileTitles = new Set<string>();
      for (const page of Object.values(pData.query?.pages || {})) {
        for (const img of page.images || []) {
          if (img.title && !isSpamOrLogoImageUrl(img.title, img.title)) {
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
        const cleanName = rawTitle
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, '_')
          .replace(/^_|_$/g, '');
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
          suggestedFilename: /\.(jpg|jpeg|png|webp|gif)$/i.test(cleanName)
            ? cleanName.slice(0, 60)
            : `${cleanName.slice(0, 52)}.jpg`,
          defaultLegend: cleanDesc
            ? `Imagem clínica demonstrando ${cleanDesc.slice(0, 130)}.`
            : `Imagem clínica real referente a ${query}.`,
          source: `Wikipedia Medical (${lang.toUpperCase()})`,
          isSvg: mime.includes('svg') || targetUrl.toLowerCase().endsWith('.svg'),
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
  const candidateSearches = Array.from(
    new Set(
      [
        baseWords.slice(0, 3).join(' '),
        baseWords.slice(0, 2).join(' '),
        ...(enQueries[1] ? [enQueries[1].split(/\s+/).slice(0, 3).join(' ')] : []),
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

        const cleanName = rawTitle
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, '_')
          .replace(/^_|_$/g, '');
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
          suggestedFilename: /\.(jpg|jpeg|png|webp|gif)$/i.test(cleanName)
            ? cleanName.slice(0, 60)
            : `${cleanName.slice(0, 52)}.jpg`,
          defaultLegend: cleanDesc
            ? `Exame complementar demonstrando ${cleanDesc.slice(0, 130)}.`
            : `Imagem diagnóstica demonstrando achado clínico real de ${enQuery}.`,
          source: 'Wikimedia Commons Medical',
          isSvg: mime.includes('svg') || targetUrl.toLowerCase().endsWith('.svg'),
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
    const isSvg = contentType.includes('svg');
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

    const metaRegex =
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = metaRegex.exec(html)) !== null) {
      addCandidate(m[1], pageTitle);
    }
    const metaReverseRegex =
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]*>/gi;
    while ((m = metaReverseRegex.exec(html)) !== null) {
      addCandidate(m[1], pageTitle);
    }

    const imgRegex = /<img\b[^>]*>/gi;
    while ((m = imgRegex.exec(html)) !== null && extracted.length < 10) {
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

    return extracted;
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
        model: PRIMARY_GEMINI_MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      },
      { signal, timeoutMs: 14_000, enableModelFallback: true }
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

  const [googleSettled, wikipediaSettled, wikimediaSettled] = await Promise.allSettled([
    preferGoogleGrounding
      ? searchGoogleMedicalImagesViaGrounding(
          ai,
          rawSearch,
          topic,
          question,
          enQueries,
          signal
        )
      : Promise.resolve([]),
    searchWikipediaMedicalImages(enQueries, rawSearch, signal),
    searchWikimediaCommonsMedical(enQueries, signal),
  ]);

  const allCandidates: MedicalImageCandidate[] = [
    ...(googleSettled.status === 'fulfilled' ? googleSettled.value : []),
    ...(wikipediaSettled.status === 'fulfilled' ? wikipediaSettled.value.slice(0, 8) : []),
    ...(wikimediaSettled.status === 'fulfilled' ? wikimediaSettled.value.slice(0, 8) : []),
  ];

  // Canonical deduplication (prevents 800px vs 900px vs original visual duplicates)
  const dedupedMap = new Map<string, MedicalImageCandidate>();
  for (const candidate of allCandidates) {
    if (!candidate) continue;
    const key = normalizeImageCanonicalKey(candidate.thumbUrl || candidate.fullUrl, candidate.title);
    const scored: MedicalImageCandidate = {
      ...candidate,
      relevanceScore: scoreImageRelevance(candidate, {
        query: rawSearch,
        topic,
        question,
        enQueries,
      }),
    };
    const existing = dedupedMap.get(key);
    if (!existing || (scored.relevanceScore ?? 0) > (existing.relevanceScore ?? 0)) {
      dedupedMap.set(key, scored);
    }
  }

  const ranked = Array.from(dedupedMap.values())
    .filter((c) => (c.relevanceScore ?? 0) > 0)
    .sort((a, b) => {
      // Raster always outranks schematic SVG unless score gap is extreme
      const aSvg = Boolean(a.isSvg);
      const bSvg = Boolean(b.isSvg);
      if (aSvg !== bSvg) return aSvg ? 1 : -1;
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
