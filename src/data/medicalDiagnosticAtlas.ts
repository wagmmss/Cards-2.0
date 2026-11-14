import { MedicalImageResult } from '../types/deck';

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

// 1. ECG — Parede Anterior (Sem rótulo diagnóstico de spoiler na imagem)
const SVG_ECG_STEMI = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 240" width="720" height="240">
  <rect width="720" height="240" fill="#120d14"/>
  <defs>
    <pattern id="minorGrid" width="12" height="12" patternUnits="userSpaceOnUse">
      <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#3b1d2e" stroke-width="0.6"/>
    </pattern>
    <pattern id="majorGrid" width="60" height="60" patternUnits="userSpaceOnUse">
      <rect width="60" height="60" fill="url(#minorGrid)"/>
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#642947" stroke-width="1.2"/>
    </pattern>
  </defs>
  <rect width="720" height="240" fill="url(#majorGrid)"/>
  <text x="18" y="28" fill="#cbd5e1" font-family="monospace" font-size="12" font-weight="bold">Derivações Precordiais V2 - V4 · 25 mm/s · 10 mm/mV</text>
  <path d="M 20 150 L 55 150 Q 65 136 75 150 L 90 150 L 96 158 L 106 62 L 114 102 Q 145 72 175 96 Q 192 115 205 150 L 250 150 Q 260 136 270 150 L 285 150 L 291 158 L 301 60 L 309 100 Q 340 70 370 95 Q 387 115 400 150 L 445 150 Q 455 136 465 150 L 480 150 L 486 158 L 496 62 L 504 102 Q 535 72 565 96 Q 582 115 595 150 L 680 150" fill="none" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// 2. ECG — DII Longo (Sem rótulo diagnóstico de spoiler na imagem)
const SVG_ECG_AFIB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 240" width="720" height="240">
  <rect width="720" height="240" fill="#120d14"/>
  <defs>
    <pattern id="minorAfib" width="12" height="12" patternUnits="userSpaceOnUse">
      <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#3b1d2e" stroke-width="0.6"/>
    </pattern>
    <pattern id="majorAfib" width="60" height="60" patternUnits="userSpaceOnUse">
      <rect width="60" height="60" fill="url(#minorAfib)"/>
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#642947" stroke-width="1.2"/>
    </pattern>
  </defs>
  <rect width="720" height="240" fill="url(#majorAfib)"/>
  <text x="18" y="28" fill="#cbd5e1" font-family="monospace" font-size="12" font-weight="bold">Derivação DII Longo · 25 mm/s · 10 mm/mV</text>
  <path d="M 15 150 Q 25 144 33 153 Q 42 145 50 152 L 56 158 L 62 68 L 68 164 L 74 150 Q 88 135 102 152 Q 112 145 120 154 Q 130 144 139 152 L 145 158 L 151 70 L 157 162 L 163 150 Q 177 136 190 151 Q 202 143 212 154 Q 223 145 234 153 Q 245 144 256 152 Q 266 146 276 153 Q 287 144 296 151 L 302 158 L 308 66 L 314 162 L 320 150 Q 335 135 349 152 Q 359 144 369 153 L 375 158 L 381 70 L 387 162 L 393 150 Q 408 135 422 151 Q 434 144 445 153 Q 456 145 467 152 Q 478 144 490 154 Q 502 145 514 152 Q 525 144 536 151 L 542 158 L 548 68 L 554 162 L 560 150 Q 574 135 588 152 Q 599 144 610 153 L 616 158 L 622 70 L 628 162 L 634 150 Q 648 136 662 152 Q 675 144 690 152" fill="none" stroke="#34d399" stroke-width="2.4" stroke-linejoin="round"/>
</svg>`;

// 3. Cardiotocografia (CTG) — Sem rótulo diagnóstico de spoiler na imagem
const SVG_CTG_DIP2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 260" width="720" height="260">
  <rect width="720" height="260" fill="#0f172a"/>
  <line x1="0" y1="60" x2="720" y2="60" stroke="#1e293b" stroke-width="1"/>
  <line x1="0" y1="110" x2="720" y2="110" stroke="#1e293b" stroke-width="1"/>
  <line x1="0" y1="150" x2="720" y2="150" stroke="#334155" stroke-width="1.5"/>
  <text x="16" y="24" fill="#cbd5e1" font-family="monospace" font-size="12" font-weight="bold">Canal 1: FCF (bpm) · Velocidade 1 cm/min</text>
  <text x="16" y="172" fill="#94a3b8" font-family="monospace" font-size="12" font-weight="bold">Canal 2: Tocometria Externa (mmHg)</text>
  <path d="M 20 65 L 110 64 L 140 66 Q 185 132 225 132 Q 265 132 300 65 L 400 65 L 430 66 Q 475 134 515 134 Q 555 134 590 65 L 700 65" fill="none" stroke="#fb7185" stroke-width="2.8"/>
  <path d="M 20 238 L 90 238 Q 135 175 180 175 Q 225 175 265 238 L 380 238 Q 425 175 470 175 Q 515 175 555 238 L 700 238" fill="none" stroke="#38bdf8" stroke-width="2.6"/>
  <line x1="180" y1="45" x2="180" y2="245" stroke="#64748b" stroke-width="1" stroke-dasharray="4 4"/>
  <line x1="225" y1="45" x2="225" y2="245" stroke="#64748b" stroke-width="1" stroke-dasharray="4 4"/>
</svg>`;

// 4. TC de Crânio — Sem rótulo diagnóstico de spoiler na imagem
const SVG_CT_EPIDURAL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 280" width="420" height="280">
  <rect width="420" height="280" fill="#090d16"/>
  <ellipse cx="210" cy="145" rx="108" ry="116" fill="#1e293b" stroke="#e2e8f0" stroke-width="7"/>
  <line x1="210" y1="32" x2="196" y2="256" stroke="#475569" stroke-width="2" stroke-dasharray="5 3"/>
  <path d="M 284 62 Q 242 135 292 214 Q 322 145 284 62 Z" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
  <path d="M 175 115 Q 192 138 175 165" fill="none" stroke="#090d16" stroke-width="7" stroke-linecap="round"/>
  <path d="M 222 122 Q 214 140 222 158" fill="none" stroke="#090d16" stroke-width="4" stroke-linecap="round"/>
  <text x="16" y="24" fill="#cbd5e1" font-family="monospace" font-size="12" font-weight="bold">TC de Crânio s/ Contraste · Janela Parenquimatosa</text>
</svg>`;

// 5. Radiografia de Tórax — Sem rótulo diagnóstico de spoiler na imagem
const SVG_CXR_PNEUMOTHORAX = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 280" width="420" height="280">
  <rect width="420" height="280" fill="#090d16"/>
  <rect x="70" y="34" width="280" height="216" rx="22" fill="#0f172a" stroke="#334155" stroke-width="2"/>
  <path d="M 95 55 Q 145 48 182 70 L 182 215 Q 130 205 90 222 Z" fill="#05080f" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="5 3"/>
  <ellipse cx="168" cy="145" rx="22" ry="38" fill="#334155"/>
  <path d="M 235 55 Q 285 48 325 75 L 330 220 Q 275 205 232 218 Z" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
  <path d="M 212 38 L 228 118" fill="none" stroke="#cbd5e1" stroke-width="4"/>
  <ellipse cx="235" cy="168" rx="34" ry="42" fill="#cbd5e1" opacity="0.85"/>
  <text x="16" y="22" fill="#cbd5e1" font-family="monospace" font-size="12" font-weight="bold">Radiografia de Tórax AP · Sala de Emergência</text>
</svg>`;

// 6. TC de Abdome — Sem rótulo diagnóstico de spoiler na imagem
const SVG_CT_APPENDICITIS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 280" width="420" height="280">
  <rect width="420" height="280" fill="#090d16"/>
  <ellipse cx="210" cy="148" rx="145" ry="96" fill="#1e293b" stroke="#94a3b8" stroke-width="5"/>
  <ellipse cx="210" cy="205" rx="22" ry="16" fill="#f8fafc"/>
  <circle cx="132" cy="168" r="24" fill="#334155" stroke="#94a3b8" stroke-width="2" stroke-dasharray="3 2"/>
  <circle cx="132" cy="168" r="13" fill="#0f172a" stroke="#f8fafc" stroke-width="4"/>
  <circle cx="132" cy="168" r="4" fill="#f8fafc"/>
  <text x="16" y="24" fill="#cbd5e1" font-family="monospace" font-size="12" font-weight="bold">TC de Abdome c/ Contraste · Corte Axial Pélvico</text>
</svg>`;

// 7. Radiografia em Ortostase — Sem rótulo diagnóstico de spoiler na imagem
const SVG_RX_PNEUMOPERITONEUM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 280" width="420" height="280">
  <rect width="420" height="280" fill="#090d16"/>
  <rect x="65" y="30" width="290" height="220" rx="16" fill="#1e293b" stroke="#475569" stroke-width="2"/>
  <path d="M 90 155 Q 145 122 198 155" fill="none" stroke="#e2e8f0" stroke-width="3"/>
  <path d="M 96 156 Q 145 130 192 156 Q 145 144 96 156 Z" fill="#020617" stroke="#94a3b8" stroke-width="1.5"/>
  <path d="M 222 162 Q 275 132 328 162" fill="none" stroke="#e2e8f0" stroke-width="3"/>
  <text x="16" y="22" fill="#cbd5e1" font-family="monospace" font-size="12" font-weight="bold">Radiografia de Tórax PA em Ortostase</text>
</svg>`;

// 8. Ultrassonografia Point-of-Care (e-FAST) — Sem rótulo diagnóstico de spoiler na imagem
const SVG_USG_FAST = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 280" width="420" height="280">
  <rect width="420" height="280" fill="#090d16"/>
  <path d="M 160 35 L 260 35 L 355 235 Q 210 262 65 235 Z" fill="#1e293b" stroke="#475569" stroke-width="2"/>
  <path d="M 110 85 Q 185 75 235 125 L 165 185 Q 115 145 110 85 Z" fill="#475569"/>
  <path d="M 172 182 Q 230 132 252 122 Q 262 138 195 198 Z" fill="#020617" stroke="#64748b" stroke-width="1.5"/>
  <ellipse cx="255" cy="182" rx="46" ry="32" fill="#334155" stroke="#94a3b8" stroke-width="2"/>
  <text x="16" y="22" fill="#cbd5e1" font-family="monospace" font-size="12" font-weight="bold">USG Point-of-Care · Janela Quadrante Superior Direito</text>
</svg>`;

export const HIGH_PRECISION_MEDICAL_ATLAS: MedicalImageResult[] = [
  {
    id: 'atlas-ecg-stemi',
    title: 'ECG 12 Derivações — Supradesnivelamento de ST (IAMCSST)',
    thumbUrl: svgToDataUri(SVG_ECG_STEMI),
    fullUrl: svgToDataUri(SVG_ECG_STEMI),
    description:
      'Traçado eletrocardiográfico evidenciando supradesnivelamento convexo do segmento ST (> 2 mm no ponto J) em parede anterior.',
    suggestedFilename: 'ecg_iam_supradesnivelamento_st.svg',
    defaultLegend:
      'ECG demonstrando supradesnivelamento convexo do segmento ST em derivações precordiais anteriores (V2–V4).',
    source: 'Atlas Diagnóstico Fidedigno (ECG / Cardiologia)',
  },
  {
    id: 'atlas-ecg-afib',
    title: 'ECG — Fibrilação Atrial (RR Irregular e Ausência de Onda P)',
    thumbUrl: svgToDataUri(SVG_ECG_AFIB),
    fullUrl: svgToDataUri(SVG_ECG_AFIB),
    description:
      'DII longo demonstrando intervalos RR irregularmente irregulares, ausência de ondas P sinusais e ondas f fibrilatórias.',
    suggestedFilename: 'ecg_fibrilacao_atrial.svg',
    defaultLegend:
      'ECG em DII longo revelando intervalos RR irregularmente irregulares e ausência de ondas P sinusais.',
    source: 'Atlas Diagnóstico Fidedigno (ECG / Emergência)',
  },
  {
    id: 'atlas-ctg-dip2',
    title: 'Cardiotocografia (CTG) — Desaceleração Tardia (DIP II)',
    thumbUrl: svgToDataUri(SVG_CTG_DIP2),
    fullUrl: svgToDataUri(SVG_CTG_DIP2),
    description:
      'Cardiotocografia intraparto demonstrando desaceleração periódica tardia (nadir da FCF defasado em relação ao ápice da contração uterina).',
    suggestedFilename: 'ctg_desaceleracao_tardia_dip2.svg',
    defaultLegend:
      'Cardiotocografia evidenciando desacelerações tardias recorrentes (DIP II) com nadir da FCF após o pico da contração.',
    source: 'Atlas Diagnóstico Fidedigno (Obstetrícia / GO)',
  },
  {
    id: 'atlas-ct-appendicitis',
    title: 'TC de Abdome c/ Contraste — Apendicite Aguda',
    thumbUrl: svgToDataUri(SVG_CT_APPENDICITIS),
    fullUrl: svgToDataUri(SVG_CT_APPENDICITIS),
    description:
      'Corte axial de TC de abdome em fossa ilíaca direita demonstrando apêndice distendido (> 6 mm), apendicólito e densificação da gordura adjacente.',
    suggestedFilename: 'tc_apendicite_aguda.svg',
    defaultLegend:
      'TC de abdome com contraste demonstrando apêndice cecal distendido (> 6 mm) com apendicólito e borramento da gordura periapendicular.',
    source: 'Atlas Diagnóstico Fidedigno (Radiologia / Cirurgia)',
  },
  {
    id: 'atlas-cxr-pneumothorax',
    title: 'RX de Tórax PA — Pneumotórax Hipertensivo',
    thumbUrl: svgToDataUri(SVG_CXR_PNEUMOTHORAX),
    fullUrl: svgToDataUri(SVG_CXR_PNEUMOTHORAX),
    description:
      'Radiografia de tórax evidenciando hipertransparência periférica sem trama vascular, linha pleural visceral e desvio mediastinal contralateral.',
    suggestedFilename: 'rx_pneumotorax_hipertensivo.svg',
    defaultLegend:
      'Radiografia de tórax evidenciando hipertransparência hemitórax com ausência de trama vascular, colapso pulmonar e desvio contralateral.',
    source: 'Atlas Diagnóstico Fidedigno (Trauma / Emergência)',
  },
  {
    id: 'atlas-ct-epidural',
    title: 'TC de Crânio s/ Contraste — Hematoma Epidural (Lente Biconvexa)',
    thumbUrl: svgToDataUri(SVG_CT_EPIDURAL),
    fullUrl: svgToDataUri(SVG_CT_EPIDURAL),
    description:
      'TC de crânio axial revelando coleção extra-axial hiperdensa em formato de lente biconvexa que não ultrapassa as suturas cranianas.',
    suggestedFilename: 'tc_cranio_hematoma_epidural.svg',
    defaultLegend:
      'TC de crânio sem contraste mostrando coleção hiperdensa extra-axial em lente biconvexa com desvio de linha média.',
    source: 'Atlas Diagnóstico Fidedigno (Neurocirurgia / Trauma)',
  },
  {
    id: 'atlas-rx-pneumoperitoneum',
    title: 'RX Tórax em Ortostase — Pneumoperitônio Subdiafragmático',
    thumbUrl: svgToDataUri(SVG_RX_PNEUMOPERITONEUM),
    fullUrl: svgToDataUri(SVG_RX_PNEUMOPERITONEUM),
    description:
      'Radiografia de tórax em ortostase demonstrando lâmina de ar livre subdiafragmática direita indicativa de perfuração de víscera oca.',
    suggestedFilename: 'rx_pneumoperitonio_ortostase.svg',
    defaultLegend:
      'Radiografia de tórax em ortostase evidenciando lâmina de gás livre subdiafragmático à direita.',
    source: 'Atlas Diagnóstico Fidedigno (Abdome Agudo Perfurativo)',
  },
  {
    id: 'atlas-usg-fast',
    title: 'USG Point-of-Care (e-FAST) — Líquido Livre no Espaço de Morrison',
    thumbUrl: svgToDataUri(SVG_USG_FAST),
    fullUrl: svgToDataUri(SVG_USG_FAST),
    description:
      'Janela hepatorrenal do e-FAST evidenciando faixa anecoica entre o fígado e o córtex renal direito (Espaço de Morrison positivo).',
    suggestedFilename: 'usg_fast_espaco_morrison.svg',
    defaultLegend:
      'Ultrassonografia point-of-care (e-FAST) demonstrando faixa anecoica de líquido livre no recesso hepatorrenal (Espaço de Morrison).',
    source: 'Atlas Diagnóstico Fidedigno (Trauma / Cirurgia)',
  },
];

export function matchMedicalAtlasImages(queryText: string): MedicalImageResult[] {
  const q = (queryText || '').toLowerCase();
  const scored = HIGH_PRECISION_MEDICAL_ATLAS.map((item) => {
    const hay = `${item.title} ${item.description} ${item.source}`.toLowerCase();
    let score = 0;
    for (const token of q.split(/\s+/).filter((t) => t.length > 2)) {
      if (hay.includes(token)) score += 3;
    }
    if (/iam|infarto|supra|ecg|coronari|tor[aá]cica/.test(q) && item.id === 'atlas-ecg-stemi') score += 10;
    if (/fibrila|arritmia|fa\b/.test(q) && item.id === 'atlas-ecg-afib') score += 10;
    if (/gesta|obstetr|ctg|cardiotoco|dip|sofrimento|ecl[aâ]mpsia/.test(q) && item.id === 'atlas-ctg-dip2') score += 10;
    if (/apendic|abdome|fid|blumberg/.test(q) && item.id === 'atlas-ct-appendicitis') score += 10;
    if (/pneumot[oó]rax|t[oó]rax|dispneia|pleural/.test(q) && item.id === 'atlas-cxr-pneumothorax') score += 10;
    if (/cr[aâ]nio|epidural|tce|neuro|avc/.test(q) && item.id === 'atlas-ct-epidural') score += 10;
    if (/pneumoperit|perfura|úlcera|ulcera/.test(q) && item.id === 'atlas-rx-pneumoperitoneum') score += 10;
    if (/fast|trauma|morrison|ultrassom|usg/.test(q) && item.id === 'atlas-usg-fast') score += 10;
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
