export type PriorityLevel = 'P1' | 'P2' | 'P3' | 'P4';
export type DomainProfile =
  | 'emergencia'
  | 'ambulatorio'
  | 'cirurgico'
  | 'preventiva_normativo';
export type GeminiModelOption = 'gemini-4-hydrogen' | 'gemini-3.8-flash';
export type CardType = 'basic' | 'cloze';

export interface ExamReference {
  institution: string;
  year: number;
  question_id: number;
  source?: string;
}

export interface MediaBundleItem {
  filename: string;
  sourceUrl: string;
  cardId: number;
  field: 'question' | 'hint';
  kind?: 'image' | 'audio';
}

export interface LocalMediaAsset {
  filename: string;
  mimeType: string;
  dataUri: string;
  size: number;
}

export interface GuidRegistryData {
  version: number;
  entries: Record<string, string>;
}

export interface PdfExtractedImage {
  id: string;
  pdfName: string;
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
  pageTextSnippet: string;
  suggestedFilename: string;
  captionHint?: string;
  kind?: 'embedded' | 'page_crop';
}

export interface MedicalImageResult {
  id: string;
  title: string;
  thumbUrl: string;
  fullUrl: string;
  description: string;
  suggestedFilename: string;
  defaultLegend: string;
  source: string;
  fromMaterial?: boolean;
  pdfName?: string;
  pageNumber?: number;
  materialScore?: number;
}

export type CardAuditVerdict = 'keep' | 'rebuild' | 'split' | 'prune';

export interface CardAuditItem {
  cardId: number;
  verdict: CardAuditVerdict;
  score: number;
  reason: string;
  clinicalIssue?: string;
  targetConcept: string;
  priority: PriorityLevel;
  suggestedType: CardType;
}

export interface DeckAuditReport {
  deckKey: string;
  overallSummary: string;
  counts: {
    keep: number;
    rebuild: number;
    split: number;
    prune: number;
  };
  items: CardAuditItem[];
}

export interface DeckFinalVerificationReport {
  overallScore: number;
  approved: boolean;
  mapCoveragePct: number;
  summary: string;
  clinicalAccuracyNotes: string[];
  missingConcepts: Array<{
    priority: PriorityLevel;
    subtopic: string;
    concept: string;
    recommendedType: CardType;
  }>;
  weakCardFixes: Array<{
    cardId: number;
    issue: string;
    fixInstruction: string;
  }>;
}

export interface CanonicalCard {
  id: number;
  type: CardType;
  topic: string;
  question: string;
  answer: string;
  hint: string;
  tags?: string[];
  image_mode?: 'recognition' | 'feedback';
  exam_refs?: ExamReference[];
  last_synced_hash?: string;
  // UI-only helper metadata (stripped on canonical JSON export to satisfy lint.py ALLOWED_FIELDS)
  priority?: PriorityLevel;
  deck_key?: string;
  imageVerified?: boolean;
  imageAlternatives?: MedicalImageResult[];
  isResolvingImage?: boolean;
  auditVerdict?: CardAuditVerdict;
  auditReason?: string;
  auditScore?: number;
  auditTargetConcept?: string;
  auditSuggestedType?: CardType;
  needsManualImage?: boolean;
}

export interface ExtractedDeckMetadata {
  existingIds: number[];
  mediaTags: string[];
  detectedDeckKey: string;
  rawCards: CanonicalCard[];
  removedOrphanAudioCount?: number;
}

export interface ClinicalMapItem {
  id: string;
  priority: PriorityLevel;
  subtopic: string;
  concept: string;
  guidelineNote: string;
  targetCardType: CardType;
  checked: boolean;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ClinicalMapResponse {
  themeTitle: string;
  specialty: string;
  deckKey: string;
  profile?: DomainProfile;
  items: ClinicalMapItem[];
  guidelineUpdates: string[];
  groundingSources: GroundingSource[];
  searchQueries?: string[];
  googleSearchUsed?: boolean;
}

export type WarningCode =
  | 'MISSING_MEDIA'
  | 'QUESTION_TOO_LONG'
  | 'VAGUE_TEMPORAL_WINDOW'
  | 'TOPIC_DUPLICATED_IN_QUESTION'
  | 'ANSWER_TOO_LONG'
  | 'ANSWER_HAS_SEMICOLON'
  | 'ANSWER_MISSING_PERIOD'
  | 'ANSWER_OUTER_BOLD'
  | 'CLOZE_NON_EMPTY_ANSWER'
  | 'CLOZE_COUNT_INVALID'
  | 'CLOZE_TOO_LONG'
  | 'CLOZE_DANGLING_PARTICLE'
  | 'CLOZE_HAS_HINT'
  | 'COMPOUND_QUESTION'
  | 'QUESTION_PAREN_SPOILER'
  | 'TOPIC_SPOILER'
  | 'TOPIC_FORMAT'
  | 'COMMENT_TOO_LONG'
  | 'COMMENT_TOO_SHORT'
  | 'COMMENT_MISSING_PREFIX'
  | 'COMMENT_MISSING_BOLD'
  | 'LATEX_PROHIBITED'
  | 'FDA_OBSOLETE_CATEGORY'
  | 'LEGACY_MARKERS'
  | 'RECOGNITION_MISMATCH'
  | 'ORPHAN_VISUAL_REFERENCE'
  | 'TABLE_MALFORMED'
  | 'MATUSCHAK_UNFOCUSED_SET'
  | 'NIELSEN_PASSIVE_OR_BINARY'
  | 'CLOZE_DEFINITIONAL_PASSIVE'
  | 'THEORETICAL_WHY_QUESTION'
  | 'POSSIBLE_R1_NICHE';

export interface LinterWarning {
  code: WarningCode;
  field: 'question' | 'answer' | 'hint' | 'topic' | 'type';
  message: string;
  severity: 'error' | 'warning';
}

export interface CardLintMetrics {
  questionWordCount: number;
  answerWordCount: number;
  answerCharCount: number;
  commentVisibleCharCount: number;
  clozeCount: number;
  maxClozeWords: number;
  hasCompoundQuestion: boolean;
  hasTopicSpoiler: boolean;
  missingMediaFiles: string[];
}

export interface CardLintResult {
  cardId: number;
  isValid: boolean;
  warnings: LinterWarning[];
  metrics: CardLintMetrics;
}

export interface InternatoSelfAuditReport {
  deckKey: string;
  passed: boolean;
  totalCards: number;
  basicCount: number;
  clozeCount: number;
  practicalScenarioCount: number;
  errorCount: number;
  warningCount: number;
  internatoWarnings: Array<{ cardId: number; code: string; message: string }>;
  blockedImagesFound: Array<{ cardId: number; src: string }>;
  multiAudioCardIds: number[];
  imagesUsed: Array<{ cardId: number; src: string; placement: 'question' | 'hint' }>;
}

export interface UploadedPdfFile {
  name: string;
  size: number;
  mimeType: string;
  base64Data: string;
  fileUri?: string;
  fileName?: string;
  fileSha256?: string;
  keyFingerprint?: string;
  textContent?: string;
  docRole?: 'diretriz' | 'resumo' | 'questoes' | 'documento';
  extractedImages?: PdfExtractedImage[];
  rawArrayBuffer?: ArrayBuffer;
}

export interface DeckCurationStats {
  originalCount: number;
  finalCount: number;
  prunedCount: number;
  prunedIds?: number[];
  addedCount: number;
  convertedCount: number;
  preservedIdsCount: number;
  basicPct: number;
  clozePct: number;
}
