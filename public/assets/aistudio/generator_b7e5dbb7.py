"""Pipeline Unificado End-to-End para Criação Automatizada de Flashcards Médicos.

Doutrina Internato-First:
1. Ingestão de PDF médico e inferência automática de metadados.
2. Auto-scaffold em decks.toml, pasta de mídias e JSON de notas.
3. Extração automática e contextual de imagens/tabelas relevantes do PDF.
4. Geração cognitiva de cards via Gemini 4 Argon (`argon -b high`).
5. Síntese opcional de micro-áudio neural PT-BR (edge-tts).
6. Auto-reparo defensivo e validação estrita (linter com 0 erros/avisos).
7. Compilação do pacote .apkg e sincronização direta no Anki Desktop via AnkiConnect.
8. Notificação de status no Telegram.

Exemplos de uso:
  uv run cards-auto "02_Capítulos_PDF/.../Meu_Capitulo.pdf"
  uv run cards-auto "02_Capítulos_PDF/.../Meu_Capitulo.pdf" --title "5º Ano::Clínica::Gastro::DRGE" --anki-sync
  uv run cards-auto "02_Capítulos_PDF/.../Meu_Capitulo.pdf" --deck drge --tts
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.request
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import pymupdf
from PIL import Image

from criador_cards import anki, audio, build, deck_review, lint, pdf_images

ROOT = Path(__file__).resolve().parents[2]
DECKS_TOML = ROOT / "decks.toml"
DATA_DECKS_DIR = ROOT / "data" / "decks"
MEDIA_ROOT = ROOT / "04_Mídias"
OUTPUT_APKG_DIR = ROOT / "01_Decks_Anki"
SYSTEM_PROMPT_PATH = ROOT / "03_Geradores_e_Scripts" / "SYSTEM_PROMPT_CRIADOR.md"

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

MIN_IMG_WIDTH = 220
MIN_IMG_HEIGHT = 180
MIN_IMG_BYTES = 8 * 1024
MAX_ASPECT_RATIO = 4.5
MAX_COMMENT_CHARS = 320
MAX_CLOZE_WORDS = 5

DANGLING_STOPWORDS = {
    "a", "ao", "aos", "as", "com", "contra", "da", "das", "de", "do", "dos",
    "e", "em", "entre", "na", "nas", "no", "nos", "o", "os", "ou", "para",
    "pela", "pelas", "pelo", "pelos", "por", "que", "se", "sem", "sob", "sobre", "um", "uma",
}

MEDICAL_ABBREVIATIONS: tuple[tuple[str, str], ...] = (
    (r"\bdiagnóstico\b", "dx"),
    (r"\bDiagnóstico\b", "Dx"),
    (r"\btratamento\b", "tto"),
    (r"\bTratamento\b", "Tto"),
    (r"\bpaciente\b", "pcte"),
    (r"\bpacientes\b", "pctes"),
    (r"\bPaciente\b", "Pcte"),
    (r"\bantibioticoterapia\b", "ATB"),
    (r"\binsuficiência cardíaca\b", "IC"),
    (r"\binsuficiência renal\b", "IR"),
    (r"\bfrequência cardíaca\b", "FC"),
    (r"\bpressão arterial\b", "PA"),
    (r"\bultrassonografia\b", "USG"),
    (r"\btomografia computadorizada\b", "TC"),
    (r"\bressonância magnética\b", "RM"),
    (r"\bversus\b", "vs."),
    (r"\bpor exemplo\b", "ex."),
    (r"\bmaior ou igual a\b", ">="),
    (r"\bmenor ou igual a\b", "<="),
)


class GenerationMode(str, Enum):
    HYBRID = "hybrid"
    ARGON = "argon"
    FLASH = "flash"


@dataclass
class ExtractedFigure:
    filename: str
    page: int
    width: int
    height: int
    context_snippet: str
    filepath: Path


@dataclass
class GenerationReport:
    deck_key: str
    deck_title: str
    pdf_paths: list[Path] = field(default_factory=list)
    pdf_path: Path | None = None
    mode: str = "flash"
    total_notes: int = 0
    cloze_count: int = 0
    basic_count: int = 0
    extracted_images: int = 0
    linked_images: int = 0
    generated_audios: int = 0
    auto_repairs: int = 0
    apkg_path: Path | None = None
    anki_synced: bool = False
    telegram_sent: bool = False

    def __post_init__(self) -> None:
        if self.pdf_path and not self.pdf_paths:
            self.pdf_paths = [self.pdf_path]
        elif self.pdf_paths and not self.pdf_path:
            self.pdf_path = self.pdf_paths[0]


# ============================================================================
# 0. BUSCA SEMÂNTICA E RECUPERAÇÃO DE DOCUMENTOS (ACERVO)
# ============================================================================

SYNONYMS: dict[str, list[str]] = {
    "tep": ["tromboembolismo pulmonar", "embolia pulmonar"],
    "iam": ["infarto agudo do miocardio", "sindrome coronariana", "scacest", "scassst"],
    "sca": ["sindrome coronariana aguda"],
    "scacest": ["sindrome coronariana aguda com supra", "scacsst"],
    "scassst": ["sindrome coronariana aguda sem supra"],
    "dpoc": ["doenca pulmonar obstrutiva cronica"],
    "ira": ["injuria renal aguda", "lesao renal aguda"],
    "lra": ["injuria renal aguda", "lesao renal aguda"],
    "drc": ["doenca renal cronica"],
    "has": ["hipertensao arterial sistemica"],
    "dm": ["diabetes mellitus"],
    "dm1": ["diabetes mellitus tipo 1"],
    "dm2": ["diabetes mellitus tipo 2"],
    "dmg": ["diabetes mellitus na gravidez", "diabetes gestacional"],
    "gestacional": ["gravidez", "gestacao"],
    "gestacao": ["gravidez", "gestacional"],
    "gravidez": ["gestacao", "gestacional"],
    "itu": ["infeccao do trato urinario", "infeccao urinaria"],
    "hda": ["hemorragia digestiva alta"],
    "hdb": ["hemorragia digestiva baixa"],
    "hsa": ["hemorragia subaracnoidea"],
    "avc": ["acidente vascular cerebral", "avci", "avch"],
    "avci": ["avc isquemico"],
    "avch": ["avc hemorragico"],
    "pcr": ["parada cardiorrespiratoria"],
    "fa": ["fibrilacao atrial"],
    "tce": ["trauma cranioencefalico"],
    "dip": ["doenca inflamatoria pelvica"],
    "atls": ["trauma"],
    "preeclampsia": ["pre eclampsia", "eclampsia"],
    "prenatal": ["pre natal", "acompanhamento gestacional"],
    "parto": ["mecanismo e assistencia ao parto", "assistencia ao parto"],
}


def normalize_search_text(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def pt_stem(word: str) -> str:
    w = word.lower()
    if w.endswith("coes"):
        return w[:-4] + "cao"
    if w.endswith("soes"):
        return w[:-4] + "sao"
    if w.endswith("s") and len(w) > 3:
        if w.endswith("es") and len(w) > 4:
            return w[:-2]
        return w[:-1]
    return w


def stems_match(s1: str, s2: str) -> bool:
    if s1 == s2:
        return True
    if len(s1) >= 4 and len(s2) >= 4:
        return s1.startswith(s2) or s2.startswith(s1)
    return False


STOP_WORDS: set[str] = {
    "a",
    "ao",
    "aos",
    "as",
    "com",
    "da",
    "das",
    "de",
    "do",
    "dos",
    "e",
    "em",
    "na",
    "nas",
    "no",
    "nos",
    "o",
    "os",
    "ou",
    "para",
    "por",
    "que",
    "se",
    "sem",
    "sob",
    "sobre",
    "nao",
    "um",
    "uma",
    "umas",
    "uns",
}


def search_pdf_documents(
    query: str,
    sources_dir: Path | None = None,
    top_k: int = 5,
) -> list[tuple[int, Path]]:
    sources = sources_dir or (ROOT / "02_Capítulos_PDF")
    if not sources.is_dir():
        return []

    q_norm = normalize_search_text(query)
    q_tokens = [t for t in q_norm.split() if len(t) > 1 and t not in STOP_WORDS]
    if not q_tokens:
        return []

    # Expande tokens e grupos conceituais de sinônimos
    concept_groups: list[set[str]] = []
    phrase_candidates: list[str] = [q_norm]
    for t in q_tokens:
        t_stem = pt_stem(t)
        group = {t, t_stem}
        if t in SYNONYMS:
            for syn in SYNONYMS[t]:
                syn_norm = normalize_search_text(syn)
                phrase_candidates.append(syn_norm)
                for st in syn_norm.split():
                    if len(st) > 2:
                        group.add(st)
                        group.add(pt_stem(st))
        concept_groups.append(group)

    pdfs = list(sources.rglob("*.pdf"))
    results: list[tuple[int, Path]] = []

    for p in pdfs:
        name_norm = normalize_search_text(p.stem)
        name_tokens = name_norm.split()
        name_stems = [pt_stem(w) for w in name_tokens]

        try:
            rel = str(p.relative_to(sources))
        except ValueError:
            rel = p.name
        rel_norm = normalize_search_text(rel)
        rel_tokens = rel_norm.split()
        rel_stems = [pt_stem(w) for w in rel_tokens]

        score = 0

        # 1. Correspondência de frase completa
        for phrase in phrase_candidates:
            if phrase in name_norm:
                score += 150
                break
            elif phrase in rel_norm:
                score += 60
                break

        # 2. Cobertura de conceitos da busca
        concepts_matched_in_name = 0
        concepts_matched_in_rel = 0
        for group in concept_groups:
            matched_name = False
            matched_rel = False
            for cand in group:
                if any(stems_match(cand, ns) for ns in name_stems):
                    matched_name = True
                    break
                if any(stems_match(cand, rs) for rs in rel_stems):
                    matched_rel = True

            if matched_name:
                score += 100
                concepts_matched_in_name += 1
            elif matched_rel:
                score += 35
                concepts_matched_in_rel += 1

        total_concepts = concepts_matched_in_name + concepts_matched_in_rel
        if total_concepts == len(concept_groups) and len(concept_groups) > 1:
            score += 250
            if concepts_matched_in_name == len(concept_groups):
                score += 100  # Todos os conceitos no próprio nome do arquivo

        # 3. Correspondência exata de siglas ou termos literais
        for t in q_tokens:
            if re.search(r"" + re.escape(t) + r"", name_norm):
                score += 50

        # 4. Priorização pedagógica: Ficha Resumo tem preferência se houver match com a busca
        if score > 0:
            if "ficha resumo" in name_norm and len(name_norm) > 15:
                score += 30
            elif "apostila" in name_norm:
                score += 10
            results.append((score, p))

    results.sort(key=lambda x: -x[0])
    return results[:top_k]


def parse_selection_indices(raw_input: str, max_count: int) -> list[int]:
    """Interpreta seleções como: '1', '1,2', '1, 3', '1-3', 't', 'todos', 'all', '*'."""
    cleaned = raw_input.strip().lower()
    if not cleaned:
        return [0]
    if cleaned in ("t", "todos", "all", "*", "todas"):
        return list(range(max_count))

    indices: set[int] = set()
    parts = re.split(r"[,;\s]+", cleaned)
    for part in parts:
        if not part:
            continue
        if "-" in part:
            m = re.match(r"^(\d+)-(\d+)$", part)
            if m:
                start, end = int(m.group(1)), int(m.group(2))
                for i in range(min(start, end), max(start, end) + 1):
                    if 1 <= i <= max_count:
                        indices.add(i - 1)
        elif part.isdigit():
            i = int(part)
            if 1 <= i <= max_count:
                indices.add(i - 1)

    return sorted(indices) if indices else [0]


def select_pdf_interactively(
    matches: list[tuple[int, Path]],
    query: str,
    sources_dir: Path,
    auto_yes: bool = False,
    all_docs: bool = False,
) -> list[Path]:
    if not matches:
        return []
    if all_docs:
        return [m[1] for m in matches]
    if auto_yes or not sys.stdin.isatty():
        return [matches[0][1]]

    print(f'\n🔍 Documentos encontrados para "{query}":')
    for idx, (score, path) in enumerate(matches, start=1):
        try:
            rel = str(path.relative_to(sources_dir))
        except ValueError:
            rel = path.name
        badge = " ⭐ (recomendado)" if idx == 1 else ""
        print(f"   [{idx}] {rel}{badge}")

    if len(matches) > 1:
        print(
            f"   [T] Todas as {len(matches)} Fichas Resumo acima (Mesclar em um baralho único)"
        )

    print("\nOpções de seleção:")
    print("   • Digite 't' ou 'todos' para mesclar todas as Fichas Resumo")
    print(
        "   • Digite números separados por vírgula ou intervalo (ex.: '1,2' ou '1-3')"
    )
    print("   • Pressione Enter para [1] (ou 'q' para cancelar)")

    try:
        choice = input("\nSelecione o(s) documento(s) > ").strip()
        if choice.lower() == "q":
            return []
        selected_indices = parse_selection_indices(choice, len(matches))
        return [matches[i][1] for i in selected_indices]
    except (ValueError, EOFError, KeyboardInterrupt):
        return [matches[0][1]]


# ============================================================================
# 1. INFERÊNCIA DE METADADOS & AUTO-SCAFFOLD
# ============================================================================


def slugify(raw: str) -> str:
    normalized = (
        unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    )
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", normalized.lower()).strip("_")
    slug = re.sub(r"_+", "_", slug)
    return slug or "novo_deck"


def infer_metadata(
    pdf_path: Path, deck_arg: str | None, title_arg: str | None
) -> tuple[str, str]:
    stem = pdf_path.stem
    clean_stem = re.sub(r"^[\d_\-\.\s]+", "", stem) or stem
    # Remove prefixos editoriais comuns (Ficha Resumo, Apostila, Medcof, etc.)
    clean_stem = (
        re.sub(
            r"^(?:ficha\s+resumo|apostila|atlas\s+multimidia|atlas|radio\s+explica|como\s+cai\s+na\s+\w+)\s*[-_–—:]*\s*(?:medcof\s*[-_–—:]*)?",
            "",
            clean_stem,
            flags=re.IGNORECASE,
        ).strip(" -_–—")
        or clean_stem
    )

    deck_key = slugify(deck_arg) if deck_arg else slugify(clean_stem)

    if title_arg:
        deck_title = title_arg
    else:
        # Tenta inferir da estrutura de pastas de 02_Capítulos_PDF se aplicável
        parts = pdf_path.parts
        if "02_Capítulos_PDF" in parts:
            idx = parts.index("02_Capítulos_PDF")
            subparts = [p for p in parts[idx + 1 : -1] if not p.startswith("Extensivo")]
            # Remove pastas duplicadas consecutivas (ex.: Pediatria/Pediatria -> Pediatria)
            dedup_subparts: list[str] = []
            for sp in subparts:
                if not dedup_subparts or dedup_subparts[-1] != sp:
                    dedup_subparts.append(sp)
            if dedup_subparts:
                human_title = (
                    clean_stem.replace("_", " ").replace("-", " ").strip().title()
                )
                deck_title = f"5º Ano::{'::'.join(dedup_subparts)}::{human_title}"
            else:
                human_title = (
                    clean_stem.replace("_", " ").replace("-", " ").strip().title()
                )
                deck_title = f"5º Ano::Clínica Médica::{human_title}"
        else:
            human_title = clean_stem.replace("_", " ").replace("-", " ").strip().title()
            deck_title = f"5º Ano::Clínica Médica::{human_title}"

    return deck_key, deck_title


def ensure_scaffold(
    project: build.Project, deck_key: str, deck_title: str
) -> dict[str, Any]:
    decks = project.load_decks()
    if deck_key not in decks:
        build.create_deck(project, deck_key, deck_title)
        decks = project.load_decks()
    return decks[deck_key]


# ============================================================================
# 2. EXTRAÇÃO INTELIGENTE DE FIGURAS COM CONTEXTO
# ============================================================================


def extract_pdf_figures(
    pdf_paths: list[Path] | Path,
    media_dir: Path,
    deck_key: str,
    max_images: int = 15,
) -> list[ExtractedFigure]:
    if isinstance(pdf_paths, Path):
        pdf_paths = [pdf_paths]
    media_dir.mkdir(parents=True, exist_ok=True)
    candidates: list[tuple[float, ExtractedFigure, bytes]] = []
    seen_hashes: set[str] = set()

    caption_pattern = re.compile(
        r"^\s*(Figura|Fig\.|Tabela|Quadro)\s*(\d+[a-zA-Z]?)\s*[:\.\-]\s*(.*)",
        re.IGNORECASE,
    )

    for pdf_path in pdf_paths:
        if not pdf_path.is_file():
            continue
        try:
            doc = pymupdf.open(pdf_path)
        except Exception:
            continue
        pdf_slug = slugify(pdf_path.stem)[:14]
        is_ficha_resumo = "ficha resumo" in pdf_path.name.lower()

        for page_idx in range(len(doc)):
            page = doc[page_idx]
            page_num = page_idx + 1
            page_w, page_h = page.rect.width, page.rect.height
            blocks = page.get_text("blocks", sort=True)
            visual_clusters = pdf_images.get_visual_clusters(page, merge_margin=14.0)

            # Mapeia todas as imagens embutidas e seus retângulos reais na página
            page_images = page.get_images(full=True)
            image_rects: list[tuple[int, pymupdf.Rect]] = []
            claimed_xrefs: set[int] = set()

            for img_info in page_images:
                xref = img_info[0]
                rects = page.get_image_rects(xref)
                for r in rects:
                    if r.width >= 50 and r.height >= 40:
                        image_rects.append((xref, r))

            # -------------------------------------------------------------
            # 1. DETECÇÃO SEMÂNTICA: Procura legendas clínicas (Figura / Tabela)
            # -------------------------------------------------------------
            for b_idx, b in enumerate(blocks):
                text = b[4].strip()
                m = caption_pattern.match(text)
                if not m:
                    continue

                fig_kind = m.group(1).title()
                fig_tag = m.group(2)
                cap_rect = pymupdf.Rect(b[:4])
                is_table = any(k in fig_kind.lower() for k in ("tabela", "quadro"))

                full_caption = text.replace("\n", " ").strip()
                # Verifica continuação multilinhas da legenda na linha seguinte
                if b_idx + 1 < len(blocks):
                    next_b = blocks[b_idx + 1]
                    next_rect = pymupdf.Rect(next_b[:4])
                    if 0 <= next_rect.y0 - cap_rect.y1 <= 16 and (
                        abs(next_rect.x0 - cap_rect.x0) < 60
                        or abs(next_rect.x1 - cap_rect.x1) < 60
                    ):
                        cap_rect |= next_rect
                        full_caption += " " + next_b[4].strip().replace("\n", " ")

                # Procura cluster visual correspondente (vetorial ou bitmap)
                associated_cluster: pymupdf.Rect | None = None
                for c in visual_clusters:
                    dy_above = cap_rect.y0 - c.y1
                    dy_below = c.y0 - cap_rect.y1
                    overlap_x = min(cap_rect.x1, c.x1) - max(cap_rect.x0, c.x0)
                    has_x_align = (
                        overlap_x > 20
                        or abs(c.x0 - cap_rect.x0) < 60
                        or abs(c.x1 - cap_rect.x1) < 60
                    )
                    if not has_x_align:
                        continue

                    if is_table:
                        # Tabelas/Quadros costumam ter legenda ACIMA ou ABAIXO
                        if (-10 <= dy_below <= 45) or (-10 <= dy_above <= 45):
                            associated_cluster = c if associated_cluster is None else (associated_cluster | c)
                    else:
                        # Figuras clínicas costumam ficar ACIMA ou logo abaixo
                        if (-10 <= dy_above <= 45) or (-10 <= dy_below <= 45):
                            associated_cluster = c if associated_cluster is None else (associated_cluster | c)

                # Procura imagens embutidas adjacentes
                associated_imgs: list[tuple[int, pymupdf.Rect]] = []
                for xref, r in image_rects:
                    dy_above = cap_rect.y0 - r.y1
                    dy_below = r.y0 - cap_rect.y1
                    overlap_x = min(cap_rect.x1, r.x1) - max(cap_rect.x0, r.x0)
                    is_nearby = (
                        overlap_x > 20
                        or abs(r.x0 - cap_rect.x0) < 50
                        or abs(r.x1 - cap_rect.x1) < 50
                    ) and ((-10 <= dy_above <= 45) or (is_table and -10 <= dy_below <= 45))
                    if is_nearby:
                        associated_imgs.append((xref, r))

                if associated_cluster or associated_imgs:
                    for xref, _ in associated_imgs:
                        claimed_xrefs.add(xref)

                    visual_content: pymupdf.Rect | None = None
                    for _, r in associated_imgs:
                        visual_content = r if visual_content is None else (visual_content | r)
                    if associated_cluster:
                        visual_content = (
                            pymupdf.Rect(associated_cluster)
                            if visual_content is None
                            else (visual_content | associated_cluster)
                        )

                    if visual_content is None:
                        continue

                    union_rect = pymupdf.Rect(visual_content)

                    search_halo = pymupdf.Rect(
                        union_rect.x0 - 16.0,
                        union_rect.y0 - 14.0,
                        union_rect.x1 + 16.0,
                        union_rect.y1 + 14.0,
                    )
                    for tb in blocks:
                        tb_rect = pymupdf.Rect(tb[:4])
                        tb_text = tb[4].strip()
                        if not tb_text or tb_rect.intersects(cap_rect):
                            continue
                        if tb_rect.y0 < page_h * 0.055 or tb_rect.y1 > page_h * 0.945:
                            continue
                        if tb_rect.intersects(search_halo) and len(tb_text) <= 95 and tb_rect.width < page_w * 0.65:
                            union_rect |= tb_rect

                    if is_table:
                        union_rect |= cap_rect
                    elif union_rect.intersects(cap_rect):
                        if cap_rect.y0 >= union_rect.y1 - (union_rect.height * 0.22):
                            union_rect.y1 = min(union_rect.y1, cap_rect.y0 - 2.0)
                        elif cap_rect.y1 <= union_rect.y0 + (union_rect.height * 0.22):
                            union_rect.y0 = max(union_rect.y0, cap_rect.y1 + 2.0)

                    if union_rect.is_empty or union_rect.width < 50 or union_rect.height < 40:
                        continue

                    pad = 4.0
                    crop_rect = pymupdf.Rect(
                        max(0.0, union_rect.x0 - pad),
                        max(0.0, union_rect.y0 - pad),
                        min(page_w, union_rect.x1 + pad),
                        min(page_h, union_rect.y1 + pad),
                    )

                    pix = page.get_pixmap(clip=crop_rect, dpi=300)
                    # Aplica autocrop para remover bordas brancas excedentes antes de salvar
                    cropped_pil = pdf_images.autocrop(pdf_images.pixmap_to_image(pix), padding=8)
                    buf = io.BytesIO()
                    cropped_pil.save(buf, format="PNG", optimize=True)
                    img_bytes = buf.getvalue()
                    img_hash = hashlib.md5(img_bytes).hexdigest()
                    if img_hash in seen_hashes:
                        continue
                    seen_hashes.add(img_hash)

                    clean_kind = "tab" if is_table else "fig"
                    filename = f"{deck_key}_{pdf_slug}_{clean_kind}{fig_tag}_p{page_num:02d}.png"
                    filepath = media_dir / filename

                    # Prioridade: Figuras clínicas reais > Tabelas; Ficha Resumo > Outros
                    base_score = 10000.0 if clean_kind == "fig" else 3000.0
                    if is_ficha_resumo:
                        base_score += 5000.0
                    score = base_score + (crop_rect.width * crop_rect.height) / 100.0

                    fig = ExtractedFigure(
                        filename=filename,
                        page=page_num,
                        width=pix.width,
                        height=pix.height,
                        context_snippet=f"{fig_kind} {fig_tag}: {full_caption}",
                        filepath=filepath,
                    )
                    candidates.append((score, fig, img_bytes))

            # -------------------------------------------------------------
            # 2. FALLBACK: Imagens embutidas avulsas sem legenda padrão
            # -------------------------------------------------------------
            for xref, r in image_rects:
                if xref in claimed_xrefs:
                    continue

                # Ignora imagens que cobrem mais de 55% da página 1 (capas editoriais da apostila)
                if page_num == 1 and (r.width * r.height) / (page_w * page_h) > 0.55:
                    continue

                try:
                    base_image = doc.extract_image(xref)
                except Exception:
                    continue
                if not base_image:
                    continue

                raw_bytes: bytes = base_image["image"]
                width: int = base_image.get("width", 0)
                height: int = base_image.get("height", 0)

                if width < MIN_IMG_WIDTH or height < MIN_IMG_HEIGHT:
                    continue
                if len(raw_bytes) < MIN_IMG_BYTES:
                    continue

                aspect = max(width / max(height, 1), height / max(width, 1))
                if aspect > MAX_ASPECT_RATIO:
                    continue

                # Garante conversão de CMYK para RGB em PNG/JPEG
                try:
                    pil_img = Image.open(io.BytesIO(raw_bytes))
                    if not pdf_images.is_clinically_informative_image(pil_img):
                        continue
                    if pil_img.mode in ("CMYK", "P", "RGBA"):
                        pil_img = pil_img.convert("RGB")
                    out_buf = io.BytesIO()
                    pil_img.save(out_buf, format="PNG")
                    final_bytes = out_buf.getvalue()
                    ext = "png"
                except Exception:
                    continue

                img_hash = hashlib.md5(final_bytes).hexdigest()
                if img_hash in seen_hashes:
                    continue
                seen_hashes.add(img_hash)

                score = (width * height) / 10_000.0
                if is_ficha_resumo:
                    score += 50.0

                filename = f"{deck_key}_{pdf_slug}_p{page_num:02d}_xref{xref}.{ext}"
                filepath = media_dir / filename

                context_snippet = f"[{pdf_path.name}] Imagem da página {page_num}"
                fig = ExtractedFigure(
                    filename=filename,
                    page=page_num,
                    width=width,
                    height=height,
                    context_snippet=context_snippet,
                    filepath=filepath,
                )
                candidates.append((score, fig, final_bytes))

        doc.close()

    candidates.sort(key=lambda x: -x[0])
    selected = sorted(candidates[:max_images], key=lambda x: x[1].page)

    extracted: list[ExtractedFigure] = []
    for _, fig, raw_bytes in selected:
        fig.filepath.write_bytes(raw_bytes)
        extracted.append(fig)

    return extracted


# ============================================================================
# 3. GERAÇÃO COGNITIVA (FLASH 3.8 & ARGON 4 - ARQUITETURA HÍBRIDA)
# ============================================================================


def build_argon_prompt(
    deck_key: str,
    deck_title: str,
    figures: list[ExtractedFigure],
    pdf_paths: list[Path] | None = None,
) -> str:
    system_text = (
        SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
        if SYSTEM_PROMPT_PATH.exists()
        else ""
    )

    figures_block = ""
    if figures:
        manifest = [
            f'- Imagem: `<img src="{f.filename}">` (Página {f.page}, {f.width}x{f.height}px): "{f.context_snippet}"'
            for f in figures
        ]
        figures_block = (
            "\n### MÍDIAS EXTRAÍDAS DISPONÍVEIS NA PASTA DO DECK:\n"
            "Vincule estas imagens nos cards pertinentes (no campo 'hint' com legenda em <i>...</i> "
            "ou no campo 'question' se for reconhecimento semiológico/radiológico):\n"
            + "\n".join(manifest)
            + "\n"
        )
    else:
        figures_block = "\nNenhuma imagem extraída deste(s) PDF(s). Não invente nomes de imagens inexistentes.\n"

    docs_block = ""
    if pdf_paths:
        lines = [f"\n### DOCUMENTOS INTEGRADOS ({len(pdf_paths)} arquivo(s)):"]
        for p in pdf_paths:
            lines.append(f"- `{p.name}`")
        lines.append(
            "\n**Diretriz de Integração**: Você deve cruzar e consolidar todos os PDFs anexados acima em um único baralho de alta retenção clínica, "
            "cobrindo tanto conceitos iniciais quanto avançados (ex.: Parte 1 e Parte 2, ou Fichas Complementares) sem duplicar pontos triviais."
        )
        docs_block = "\n".join(lines) + "\n"

    prompt = f"""{system_text}

---

## MISSÃO DE GERAÇÃO: {deck_title} (`{deck_key}`)

Você deve ler atentamente o(s) PDF(s) anexado(s) e produzir o conjunto de flashcards de alto rendimento clínico para o baralho.
{docs_block}
### DIRETRIZES MANDATÓRIAS (DOUTRINA INTERNATO-FIRST):
1. **Protocolo de Inversão de Prioridade (Fim do Viés de Primazia):**
   - Apostilas médicas deixam o tratamento para as últimas páginas. Para evitar viés de primazia e attention decay:
   - Antes de abrir o bloco ```json, gere obrigatoriamente a tag `<mapa_clinico>` listando 100% dos pontos do PDF na seguinte ordem estrita de prioridade:
     * **P1 (Sala Vermelha / Minuto Zero):** Estabilização, 1ª droga (dose, via, diluição), antídotos, manobras salvadoras e contraindicações fatais.
     * **P2 (Decisão Diagnóstica):** Exame inicial de beira de leito vs. Padrão-ouro confirmatório; pontos de corte numéricos exatos.
     * **P3 (Prescrição Ambulatorial / UBS):** Tratamento de 1ª linha, gestantes/alérgicos, critérios de internação e controle de cura.
     * **P4 (Fisiopatologia Aplicada e Diferenciais Paulistas):** Apenas mecanismos que explicam sinais clínicos ou condutas (USP-SP, USP-RP, Unicamp).
   - Converta 100% dos itens P1 e P3 preferencialmente em casos clínicos situacionais (`type: "basic"`) e os itens P2/P4 em pontos de corte atômicos (`type: "cloze"`).

2. **Cobertura por Exaustão Clínica Sem Gordura (Zero-Redundância):**
   - Não use limites artificiais fixos. Gere exatamente a quantidade necessária de cards para cobrir 100% dos objetivos de decisão clínica, diagnóstico, estratificação e prescrição do médico generalista.
   - **1 Conceito = 1 Card:** É PROIBIDO criar múltiplos cards testando a mesma regra ou fatiar listas usando a mesma frase-base ("Card 1/3, 2/3, 3/3").
   - **Filtro Negativo Estrito:** É TERMINANTEMENTE PROIBIDO criar cards sobre genes/mutações de bancada (ex.: mutação KRAS na adenomiose), curiosidades históricas ou industriais (ex.: estrogênio de urina de éguas prenhas), epidemiologia numérica estéril, anatomia descritiva pura sem aplicação semiológica/cirúrgica, ou quimioterapia/estadiamento de subespecialista.

3. **Equilíbrio Cognitivo Anti-Decoreba (50% basic / 50% cloze):**
   - **45% a 55% `basic` (Matriz de Redação de Casos Clínicos com Tripla Ancoragem):**
     Toda vinheta clínica DEVE conter 3 elementos no enunciado e 1 comando temporal fechado:
     * **[CENÁRIO + IDADE/IG]:** Ex.: "Na Sala Vermelha...", "Na UBS...", "No Centro Obstétrico, gestante de 32 semanas..."
     * **[CLÍNICA + SINAIS VITAIS/EXAME]:** Dados objetivos que permitam inferir o diagnóstico e a gravidade (NUNCA dê o nome da doença entre parênteses ou no texto se a pergunta for sobre conduta — *Regra do Duplo Salto Cognitivo*).
     * **[COMANDO TEMPORAL INEQUÍVOCO]:** Escolha apenas UM dos 4 comandos abaixo:
       - *Minuto Zero (Estabilização/1ª Ação):* "Qual é a conduta imediata de minuto zero à beira do leito antes de exames complementares?"
       - *Propedêutica Inicial vs. Padrão-Ouro:* "Qual é o primeiro exame a ser solicitado na sala de emergência?" (ou "...o exame padrão-ouro confirmatório?")
       - *Prescrição de 1ª Linha:* "Qual é a prescrição farmacológica imediata de primeira escolha (fármaco, dose e via)?"
       - *Conduta Definitiva:* "Após estabilização hemodinâmica inicial, qual é o tratamento definitivo indicado?"
   - **Resposta (`answer`):** Concisa, direta, finalizada em ponto final `.`. NÃO coloque tags `<b>` ou `<strong>` no answer (o template Basic do Anki já aplica negrito).
   - **45% a 55% `cloze` (Critérios, Cortes Numéricos, Doses e Contraindicações):**
     * **Apenas UMA lacuna `{{{{c1::...}}}}` por nota** (máximo 5 palavras). É expressamente proibido colocar dois `{{{{c1::...}}}}` na mesma nota.
     * **Proibição de `::dica` genérica ou binária:** NUNCA use `::quantidade`, `::número`, `::fármaco`, `::conduta`, `::aumento ou diminuição`.
     * **Proibição de muletas pós-lacuna:** Nunca coloque unidades ou substantivos entre parênteses após o cloze, como `{{{{c1::3 maiores e 1 menor}}}} (critérios)`.

4. **Regra do "Duplo Salto Cognitivo" (Proibição de Spoiler Diagnóstico):**
   - Quando o objetivo for testar a conduta de um quadro clínico, NÃO entregue o nome da doença no enunciado. Obrigue o aluno a reconhecer o diagnóstico pelos sinais clínicos (perguntas compostas são proibidas; pergunte apenas a conduta, deixando o diagnóstico como salto cognitivo implícito).
   - Nunca dê spoiler da resposta entre parênteses no enunciado.

5. **Política de Doses e Radar Paulista:**
   - Doses de emergências (Adrenalina na anafilaxia, Sulfato de Magnésio, Insulina/KCl na CAD, Ocitocina/Ácido Tranexâmico na HPP, ACLS) e da atenção primária (Penicilina benzatina na sífilis, esquemas de DIP/ISTs, profilaxias de pré-natal) devem ser cobradas na frente do card.
   - Destaque no comentário divergências clássicas das bancas paulistas (USP-SP, USP-RP, Unicamp).

6. **Cabeçalho (`topic`) e Comentário (`hint`):**
   - `topic`: `"Tema - Subtema"`. Nunca repita o tópico em negrito no início do enunciado.
   - `hint`: Comece com `<b>Comentário:</b> `, em 1 a 2 frases concisas (teto: ≤ 320 caracteres visíveis) com **termos em negrito** e **contraste diferencial obrigatório** ("Diferente de X, em que Y..."). Proibido marcadores legados [ALVO DE BANCA] ou [BEIRA-LEITO].

{figures_block}

### FORMATO DE SAÍDA:
Gere primeiro o `<mapa_clinico>` de priorização invertida e em seguida abra o bloco ```json com o array de flashcards:
<mapa_clinico>
P1 (Sala Vermelha / Minuto Zero):
- [Item de emergência/estabilização]
P2 (Decisão Diagnóstica):
- [Padrão-ouro vs. inicial e pontos de corte]
P3 (Prescrição Ambulatorial / UBS):
- [1ª linha e condutas ambulatoriais]
P4 (Fisiopatologia Aplicada e Diferenciais):
- [Mecanismos com correlação clínica direta]
</mapa_clinico>

```json
[
  {{
    "id": 1,
    "type": "basic",
    "topic": "Tema - Subtema",
    "question": "Na Sala Vermelha, paciente de 28 anos com... Qual é a conduta imediata de minuto zero à beira do leito antes de exames complementares?",
    "answer": "Conduta objetiva terminada com ponto final.",
    "hint": "<b>Comentário:</b> Explicação sucinta com <b>termos-chave</b> e contraste diferencial.",
    "tags": ["{deck_key}"]
  }},
  {{
    "id": 2,
    "type": "cloze",
    "topic": "Tema - Subtema",
    "question": "Na emergência X, a dose de ataque recomendada é de {{{{c1::valor numérico}}}} mg/kg EV.",
    "answer": "",
    "hint": "<b>Comentário:</b> Explicação sucinta com <b>termos-chave</b> e contraste diferencial.",
    "tags": ["{deck_key}"]
  }}
]
```
"""
    return prompt.strip()


def build_draft_prompt(
    deck_key: str,
    deck_title: str,
    figures: list[ExtractedFigure],
    pdf_paths: list[Path] | None = None,
) -> str:
    system_text = (
        SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
        if SYSTEM_PROMPT_PATH.exists()
        else ""
    )

    figures_block = ""
    if figures:
        manifest = [
            f'- Imagem: `<img src="{f.filename}">` (Página {f.page}, {f.width}x{f.height}px): "{f.context_snippet}"'
            for f in figures
        ]
        figures_block = (
            "\n### MÍDIAS EXTRAÍDAS DISPONÍVEIS NA PASTA DO DECK:\n"
            "Vincule estas imagens nos cards pertinentes (no campo 'hint' com legenda em <i>...</i> "
            "ou no campo 'question' se for reconhecimento semiológico/radiológico):\n"
            + "\n".join(manifest)
            + "\n"
        )
    else:
        figures_block = "\nNenhuma imagem extraída deste(s) PDF(s). Não invente nomes de imagens inexistentes.\n"

    docs_block = ""
    if pdf_paths:
        lines = [f"\n### DOCUMENTOS INTEGRADOS ({len(pdf_paths)} arquivo(s)):"]
        for p in pdf_paths:
            lines.append(f"- `{p.name}`")
        lines.append(
            "\n**Diretriz de Integração**: Você deve cruzar e consolidar todos os PDFs anexados acima em um único baralho de alta retenção clínica, "
            "cobrindo tanto conceitos iniciais quanto avançados sem duplicar pontos triviais."
        )
        docs_block = "\n".join(lines) + "\n"

    prompt = f"""{system_text}

---

## ESTÁGIO 1: EXTRAÇÃO FACTUAL HIGH-YIELD & RASCUNHO ({deck_title} - `{deck_key}`)

Você atua como Residente Chefe estruturando o material inicial de alto rendimento clínico.
Analise detalhadamente o(s) PDF(s) anexado(s), ignore introduções históricas ou epidemiologia genérica, e extraia o conjunto de flashcards de alto rendimento cobrindo por exaustão clínica:
- Fisiopatologia-chave e cronologia essencial
- Quadro clínico típico e sinais semiológicos
- Critérios diagnósticos e exames padrão-ouro / primeira linha
- Conduta imediata, estratificação de gravidade e prescrição de emergência (droga, dose, via)
- Sinais de alarme (Red Flags) e contraindicações formais
- Peculiaridades das bancas paulistas (USP-SP, USP-RP, Unicamp)

{docs_block}
{figures_block}

### PROTOCOLO DE INVERSÃO DE PRIORIDADE (LEITURA DE TRÁS PARA FRENTE):
Apostilas médicas deixam o tratamento para as últimas páginas. Para evitar viés de primazia e attention decay:
1. Antes de abrir o bloco ```json, gere uma tag `<mapa_clinico>` listando 100% dos pontos do PDF na seguinte ordem estrita de prioridade:
   - **P1 (Sala Vermelha / Minuto Zero):** Estabilização, 1ª droga (dose, via, diluição), antídotos, manobras salvadoras e contraindicações fatais.
   - **P2 (Decisão Diagnóstica):** Exame inicial de beira de leito vs. Padrão-ouro confirmatório; pontos de corte numéricos exatos.
   - **P3 (Prescrição Ambulatorial / UBS):** Tratamento de 1ª linha, gestantes/alérgicos, critérios de internação e controle de cura.
   - **P4 (Fisiopatologia Aplicada e Diferenciais Paulistas):** Apenas mecanismos que explicam sinais clínicos ou condutas (USP-SP, USP-RP, Unicamp).
2. Converta 100% dos itens P1 e P3 preferencialmente em casos clínicos situacionais (`type: "basic"`) e os itens P2/P4 em pontos de corte atômicos (`type: "cloze"`).

### MATRIZ DE REDAÇÃO DE CASOS CLÍNICOS (`type: "basic"`):
Toda vinheta clínica DEVE conter 3 elementos no enunciado e 1 comando temporal fechado:
1. **[CENÁRIO + IDADE/IG]:** Ex.: "Na Sala Vermelha...", "Na UBS...", "No Centro Obstétrico, gestante de 32 semanas..."
2. **[CLÍNICA + SINAIS VITAIS/EXAME]:** Dados objetivos que permitam inferir o diagnóstico e a gravidade (NUNCA dê o nome da doença entre parênteses ou no texto se a pergunta for sobre conduta — *Regra do Duplo Salto Cognitivo*).
3. **[COMANDO TEMPORAL INEQUÍVOCO]:** Escolha apenas UM dos 4 comandos abaixo:
   - *Minuto Zero (Estabilização/1ª Ação):* "Qual é a conduta imediata de minuto zero à beira do leito antes de exames complementares?"
   - *Propedêutica Inicial vs. Padrão-Ouro:* "Qual é o primeiro exame a ser solicitado na sala de emergência?" (ou "...o exame padrão-ouro confirmatório?")
   - *Prescrição de 1ª Linha:* "Qual é a prescrição farmacológica imediata de primeira escolha (fármaco, dose e via)?"
   - *Conduta Definitiva:* "Após estabilização hemodinâmica inicial, qual é o tratamento definitivo indicado?"

### REGRAS MANDATÓRIAS DO RASCUNHO:
1. **Sem Cotas Fixas:** Gere exatamente a quantidade necessária para cobrir todos os objetivos essenciais do tema para o internato/generalista.
2. **Equilíbrio Cognitivo (50% basic / 50% cloze):**
   - **`basic`**: vinhetas formuladas estritamente com a Matriz de Redação acima. Resposta concisa sem tags `<b>` e com ponto final.
   - **`cloze`**: apenas UMA lacuna `{{{{c1::...}}}}` por nota (máx 5 palavras). Sem `::dica` genérica e sem muletas entre parênteses.
3. **Duplo Salto Cognitivo:** Não entregue o diagnóstico na pergunta quando testar conduta.
4. **Filtro Negativo:** Proibido KRAS/genes de bancada, urina de éguas prenhas, curiosidades farmacêuticas ou anatomia descritiva pura.
5. **Cabeçalho (`topic`)**: `"Tema - Subtema"` (não repita o tópico em negrito no enunciado).
6. **Comentário (`hint`)**: comece com `<b>Comentário:</b> `, explicando em 1 a 2 frases com **termos-chave em negrito** e contraste diferencial obrigatório.
7. **Imagens**: vincule as imagens reais extraídas onde pertinente.

### FORMATO DE SAÍDA:
Gere primeiro o `<mapa_clinico>` invertido e em seguida o array JSON com os flashcards:
<mapa_clinico>
P1 (Sala Vermelha / Minuto Zero):
- [Item de emergência/estabilização]
P2 (Decisão Diagnóstica):
- [Padrão-ouro vs. inicial e pontos de corte]
P3 (Prescrição Ambulatorial / UBS):
- [1ª linha e condutas ambulatoriais]
P4 (Fisiopatologia Aplicada e Diferenciais):
- [Mecanismos com correlação clínica direta]
</mapa_clinico>

```json
[
  {{
    "id": 1,
    "type": "basic",
    "topic": "Tema - Subtema",
    "question": "Na Sala Vermelha, paciente de 35 anos com... Qual é a conduta imediata de minuto zero à beira do leito antes de exames complementares?",
    "answer": "Conduta concisa com ponto final.",
    "hint": "<b>Comentário:</b> Explicação sucinta com <b>termos-chave</b>.",
    "tags": ["{deck_key}"]
  }},
  {{
    "id": 2,
    "type": "cloze",
    "topic": "Tema - Subtema",
    "question": "Enunciado com {{{{c1::lacuna decisória}}}}...",
    "answer": "",
    "hint": "<b>Comentário:</b> Explicação sucinta com <b>termos-chave</b>.",
    "tags": ["{deck_key}"]
  }}
]
```
"""
    return prompt.strip()


def build_refinement_prompt(
    deck_key: str,
    deck_title: str,
    draft_notes: list[dict[str, Any]],
    figures: list[ExtractedFigure] | None = None,
    mapa_clinico: str = "",
) -> str:
    system_text = (
        SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
        if SYSTEM_PROMPT_PATH.exists()
        else ""
    )

    figures_manifest = ""
    if figures:
        manifest = [
            f'- `<img src="{f.filename}">`: "{f.context_snippet}"' for f in figures
        ]
        figures_manifest = (
            "\n### MÍDIAS EXTRAÍDAS DISPONÍVEIS:\n"
            'Preserve ou insira onde clinicamente relevante no formato `<br><img src="..."><i>Legenda</i>`:\n'
            + "\n".join(manifest)
            + "\n"
        )

    mapa_block = ""
    if mapa_clinico.strip():
        mapa_block = (
            "\n### MAPA CLÍNICO DE REFERÊNCIA (AUDITORIA DE COBERTURA P1-P4):\n"
            f"<mapa_clinico>\n{mapa_clinico.strip()}\n</mapa_clinico>\n\n"
            "**Instruções Mandatórias de Auditoria contra o Mapa Clínico e Concisão:**\n"
            "- Auditar se 100% dos pontos P1, P2, P3 e P4 do `<mapa_clinico>` foram cobertos;\n"
            "- Reescrever qualquer `answer` de card basic que tenha mais de 12 palavras ou ponto-e-vírgula (;), aplicando o Duplo Salto Cognitivo Implícito;\n"
            "- Neutralizar qualquer topic que dê spoiler da resposta.\n"
        )

    draft_json_str = json.dumps(draft_notes, ensure_ascii=False, indent=2)

    prompt = f"""{system_text}

---

## ESTÁGIO 2: PRECEPTORIA CLÍNICA, CONTRASTE DIFERENCIAL & PODA INTERNATO-FIRST

Você é o Preceptor Clínico Sênior (USP-SP / Unicamp) responsável por auditar o PDF original contra o rascunho de flashcards abaixo para o baralho **{deck_title}** (`{deck_key}`).

### AUDITORIA CONTRA O PDF E DOUTRINA INTERNATO-FIRST (MANDATÓRIA):
1. **Auditoria Clínica contra o PDF:**
   - Adicione condutas, doses de emergência ou estratificações de gravidade que foram omitidas no rascunho.
   - Elimine impiedosamente qualquer ruído acadêmico, genes de bancada (ex.: KRAS), curiosidades históricas ou detalhes de subespecialidade.
   - Converta clozes conceituais passivos em casos clínicos `basic` de tomada de decisão prática quando aplicável, equilibrando o deck em ~50% basic e ~50% cloze.
2. **Equilíbrio Cognitivo & Anti-Vício:**
   - Garanta **apenas UMA lacuna `{{{{c1::...}}}}` por nota cloze**. Se o rascunho contiver duas lacunas, mantenha apenas a mais crítica e converta a secundária em texto aberto/negrito.
   - Remova dicas genéricas dentro de `{{{{c1::...}}}}` (`::quantidade`, `::número`, `::fármaco`, etc.) e muletas como `(critérios)`.
   - No `basic`, garanta **precisão temporal estrita** (Conduta Imediata de Admissão vs. Conduta Definitiva / Padrão-Ouro; proíba perguntas vagas como 'Qual a conduta?'), sem tags `<b>` externas e terminando em ponto final.
   - Reescreva qualquer `answer` de card basic que tenha mais de 12 palavras ou ponto-e-vírgula (;), aplicando o Duplo Salto Cognitivo Implícito.
3. **Regra do "Duplo Salto Cognitivo" & Neutralização de Spoiler:**
   - Se o card testar a conduta, garanta que a pergunta não dê spoiler do diagnóstico no enunciado.
   - Neutralize qualquer `topic` que dê spoiler da resposta.
4. **Contraste Diferencial Obrigatório:**
   - No campo `hint` (`<b>Comentário:</b>`), inclua OBRIGATORIAMENTE o contraste diferencial contra diagnósticos gêmeos ou condutas confundíveis ("Diferente de X, em que ocorre Y...").
5. **Poda Estrita de Concisão (Quality Gate):**
   - Limite estrito de no máximo 5 palavras dentro de `{{{{c1::...}}}}`.
   - Limite estrito de no máximo 320 caracteres de texto visível no `hint`.
   - Termos-chave fundamentais em negrito (`<b>...</b>`).
   - Remova blocos obsoletos [ALVO DE BANCA] ou [BEIRA-LEITO].
6. **Mídias e Imagens Reais:**
   - Mantenha ou vincule as imagens reais extraídas com legenda descritiva `<i>...</i>`.
   - Em cards de reconhecimento (`recognition`), a imagem deve estar apenas na `question` (nunca duplicada no `hint`).
{mapa_block}
{figures_manifest}

### RASCUNHO DE ENTRADA A SER AUDITADO E LAPIDADO:
```json
{draft_json_str}
```

### FORMATO DE SAÍDA:
Retorne ESTRITAMENTE o array JSON lapidado com as correções aplicadas, sem nenhum texto explicativo fora do JSON:
```json
[
  {{
    "id": 1,
    "type": "basic",
    "topic": "Tema - Subtema",
    "question": "Caso clínico situacional... Qual a conduta imediata?",
    "answer": "Conduta concisa com ponto final.",
    "hint": "<b>Comentário:</b> 1 a 2 frases com <b>termos em negrito</b> e contraste diferencial obrigatório.",
    "tags": ["{deck_key}"]
  }}
]
```
"""
    return prompt.strip()


def run_gemini_model_with_map(
    model: str,
    prompt_text: str,
    pdf_paths: list[Path] | Path | None = None,
    budget: str = "high",
    timeout: int = 900,
) -> tuple[str, list[dict[str, Any]]]:
    argon_bin = shutil.which("argon")
    if not argon_bin:
        raise RuntimeError(
            "Binário 'argon' não encontrado no PATH. Verifique a instalação do Gemini CLI."
        )

    paths: list[Path] = []
    if pdf_paths:
        if isinstance(pdf_paths, Path):
            paths = [pdf_paths]
        else:
            paths = list(pdf_paths)

    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", suffix=".txt", delete=False
    ) as f:
        f.write(prompt_text)
        prompt_file = Path(f.name)

    try:
        cmd = [argon_bin, "-m", model, "-b", budget]
        for p in paths:
            cmd.extend(["-f", str(p.resolve())])
        cmd.extend(["-p", str(prompt_file.resolve())])

        proc = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"Falha ao executar modelo '{model}' (código {proc.returncode}): {proc.stderr}"
            )

        output = proc.stdout.strip()

        # Extrai mapa clínico se presente
        map_match = re.search(
            r"<mapa_clinico>(.*?)</mapa_clinico>", output, flags=re.DOTALL
        )
        mapa_clinico_str = map_match.group(1).strip() if map_match else ""

        match = re.search(
            r"```(?:json)?\s*(\[\s*\{.*?\}\s*\])\s*```", output, flags=re.DOTALL
        )
        if match:
            raw_json = match.group(1)
        else:
            # Remove eventual bloco <mapa_clinico>...</mapa_clinico> antes do array JSON
            clean_output = re.sub(
                r"<mapa_clinico>.*?</mapa_clinico>", "", output, flags=re.DOTALL
            )
            s = clean_output.find("[")
            e = clean_output.rfind("]")
            if s != -1 and e != -1 and e > s:
                raw_json = clean_output[s : e + 1]
            else:
                raise ValueError(
                    f"Saída do modelo '{model}' não contém array JSON válido: {output[:300]}"
                )

        notes = json.loads(raw_json)
        if not isinstance(notes, list):
            raise ValueError(
                f"O conteúdo extraído pelo modelo '{model}' não é uma lista de notas."
            )
        return mapa_clinico_str, notes
    finally:
        prompt_file.unlink(missing_ok=True)


def run_gemini_model(
    model: str,
    prompt_text: str,
    pdf_paths: list[Path] | Path | None = None,
    budget: str = "high",
    timeout: int = 900,
) -> list[dict[str, Any]]:
    _, notes = run_gemini_model_with_map(
        model=model,
        prompt_text=prompt_text,
        pdf_paths=pdf_paths,
        budget=budget,
        timeout=timeout,
    )
    return notes


def run_argon(
    pdf_paths: list[Path] | Path, prompt_text: str, budget: str = "high"
) -> list[dict[str, Any]]:
    raise RuntimeError(
        "Chamada ao Argon bloqueada: créditos da Google Cloud Vertex AI esgotados. Utilize o modelo Gemini Flash."
    )


def bind_real_sources(
    notes: list[dict[str, Any]],
    pdf_paths: list[Path],
    root_dir: Path,
) -> None:
    """Vincula página, trecho literal (sem cortar palavras) e sha256 ponderando termos raros (IDF) e números."""
    if not pdf_paths:
        return

    pages_index: list[tuple[str, str, int, str, set[str], set[str]]] = []
    doc_freq: dict[str, int] = {}

    for pdf in pdf_paths:
        if not pdf.is_file():
            continue
        file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        try:
            rel_path = pdf.resolve().relative_to((root_dir / "02_Capítulos_PDF").resolve()).as_posix()
        except ValueError:
            try:
                rel_path = pdf.resolve().relative_to(root_dir.resolve()).as_posix()
            except ValueError:
                rel_path = pdf.name

        try:
            with pymupdf.open(pdf) as doc:
                for p_idx, page in enumerate(doc, start=1):
                    raw_text = re.sub(r"\s+", " ", page.get_text("text")).strip()
                    if not raw_text:
                        continue
                    norm_words = set(lint._extract_core_keywords(lint._normalize_text_for_spoiler(raw_text)))
                    numbers = set(re.findall(r"\b(?:\d{2,}|\d+[.,]\d+)\b", raw_text))
                    for w in norm_words:
                        doc_freq[w] = doc_freq.get(w, 0) + 1
                    pages_index.append((rel_path, file_sha, p_idx, raw_text, norm_words, numbers))
        except Exception:
            continue

    if not pages_index:
        return

    total_pages = len(pages_index)

    for note in notes:
        card_text = f"{note.get('topic', '')} {note.get('question', '')} {note.get('answer', '')}"
        card_kws = set(lint._extract_core_keywords(lint._normalize_text_for_spoiler(card_text)))
        card_nums = set(re.findall(r"\b(?:\d{2,}|\d+[.,]\d+)\b", lint.visible_text(card_text)))
        if not card_kws:
            continue

        def score_page(item: tuple[str, str, int, str, set[str], set[str]]) -> float:
            common_w = card_kws & item[4]
            common_n = card_nums & item[5]
            idf_sum = sum(math.log(1.0 + total_pages / max(1, doc_freq.get(w, 1))) for w in common_w)
            return idf_sum + (len(common_n) * 3.5)

        best_match = max(pages_index, key=score_page)
        rel_file, file_sha, best_page, full_text, page_kws, _ = best_match
        common_kws = sorted(
            card_kws & page_kws,
            key=lambda w: doc_freq.get(w, total_pages),
        )
        if not common_kws:
            continue

        # Ancora no termo mais específico (menor frequência global no PDF)
        anchor_kw = common_kws[0]
        pos = full_text.lower().find(anchor_kw[:6])
        start = max(0, pos - 45) if pos != -1 else 0
        end = min(len(full_text), start + 125)
        # Ajusta para limites de palavras inteiras
        if start > 0 and " " in full_text[start:start + 15]:
            start += full_text[start:start + 15].index(" ") + 1
        if end < len(full_text) and " " in full_text[end - 15:end]:
            end = end - 15 + full_text[end - 15:end].rindex(" ")
        excerpt = full_text[start:end].strip()

        kind = "ficha_resumo" if "ficha" in rel_file.lower() else "apostila"
        note["sources"] = [
            {
                "kind": kind,
                "file": rel_file,
                "page": best_page,
                "excerpt": excerpt,
                "sha256": file_sha,
            }
        ]


# ============================================================================
# 4. AUTO-REPARO DEFENSIVO & LINTER ESTREITO
# ============================================================================


def auto_heal_note(
    note: dict[str, Any],
    deck_key: str,
    note_id: int,
) -> int:
    """Aplica correções determinísticas para conformidade estrita com o linter."""
    repairs = 0
    note["id"] = note_id
    note.setdefault("tags", [deck_key])
    if deck_key not in note["tags"]:
        note["tags"].insert(0, deck_key)

    # 1. Topic
    topic = str(note.get("topic", "")).strip()
    if " - " not in topic:
        topic = f"{deck_key.replace('_', ' ').title()} - {topic or 'Geral'}"
        note["topic"] = topic
        repairs += 1

    # 2. Cloze vs Basic
    ntype = note.get("type", "cloze")
    if ntype not in ("cloze", "basic"):
        ntype = "cloze" if "{{c1::" in note.get("question", "") else "basic"
        note["type"] = ntype
        repairs += 1

    # 3. Question & Cloze Words / Topic Duplication
    q = str(note.get("question", "")).strip()
    m_pfx = re.match(r"^\s*(?:\*\*|<b>)(.*?)(?:\*\*|</b>)[:\.]?\s*(.*)", q, re.DOTALL)
    if m_pfx:
        p_clean = m_pfx.group(1).strip().lower()
        t_clean = topic.lower()
        subt = topic.split(" - ")[-1].strip().lower() if " - " in topic else t_clean
        if p_clean in t_clean or t_clean in p_clean or p_clean in subt or subt in p_clean or " - " in m_pfx.group(1):
            rest_q = m_pfx.group(2).strip()
            if rest_q and re.findall(r"\{\{c\d+::.*?\}\}", q) == re.findall(r"\{\{c\d+::.*?\}\}", rest_q):
                q = rest_q
                note["question"] = q
                repairs += 1

    if ntype == "cloze":
        note["answer"] = ""
        matches = list(lint.CLOZE.finditer(q))
        if matches:
            new_q_parts: list[str] = []
            last_end = 0
            for idx, m in enumerate(matches):
                new_q_parts.append(q[last_end : m.start()])
                inner = m.group(2)
                parts = inner.split("::")
                target = parts[0].strip()
                hint_cloze = f"::{parts[1].strip()}" if len(parts) > 1 else ""

                # Remove dicas genéricas proibidas
                if len(parts) > 1:
                    dica_clean = parts[1].strip().lower()
                    if (
                        any(
                            p in dica_clean
                            for p in [
                                "quantidade",
                                "número",
                                "numero",
                                "fármaco",
                                "farmaco",
                                "droga",
                                "conduta",
                                "valor",
                                "aumento",
                                "diminuição",
                                "diminuicao",
                            ]
                        )
                        or " ou " in dica_clean
                    ):
                        hint_cloze = ""
                        repairs += 1

                words = target.split()
                overflow = ""
                if len(words) > MAX_CLOZE_WORDS:
                    repairs += 1
                    cut = MAX_CLOZE_WORDS
                    while cut > 1 and words[cut - 1].lower().strip(",;:") in DANGLING_STOPWORDS:
                        cut -= 1
                    target = " ".join(words[:cut])
                    overflow = " " + " ".join(words[cut:])

                if idx >= 1:
                    # Apenas 1 lacuna {{c1::...}} por nota: a partir da 2ª converte em negrito <b>...</b>
                    new_q_parts.append(f"<b>{target}</b>{overflow}")
                    repairs += 1
                else:
                    new_q_parts.append(f"{{{{c1::{target}{hint_cloze}}}}}{overflow}")
                last_end = m.end()
            new_q_parts.append(q[last_end:])
            q = "".join(new_q_parts)

            # Remove muletas pós-lacuna tipo {{c1::3 maiores e 1 menor}} (critérios)
            q = re.sub(
                r"(\{\{c1::.*?\}\})\s*\((?:critérios|critério|pontos|ponto|dias|anos|itens|sinais)\)",
                r"\1",
                q,
                flags=re.IGNORECASE,
            )
            note["question"] = q
    else:
        # Basic answer
        ans = str(note.get("answer", "")).strip()
        ans = re.sub(r"^(?:Resposta|R):\s*", "", ans, flags=re.IGNORECASE)
        # Remove tags <b> e <strong> externas
        ans = re.sub(r"^</?(?:b|strong)>\s*|\s*</?(?:b|strong)>$", "", ans, flags=re.IGNORECASE)
        ans = re.sub(
            r"^<(?:b|strong)>(.*?)</(?:b|strong)>\.?$", r"\1.", ans, flags=re.IGNORECASE | re.DOTALL
        ).strip()
        if ans and not ans.endswith("."):
            ans += "."
            repairs += 1
        note["answer"] = ans

    # 4. Hint
    hint = str(note.get("hint", "")).strip()
    # Converte [sound:arquivo.mp3] para tag <audio> HTML5
    hint = re.sub(
        r"\[sound:([^\]]+)\]",
        r'<audio controls preload="none" class="med-audio"><source src="\1" type="audio/mpeg"></audio>',
        hint,
    )
    # Remove blocos obsoletos e marcadores legados
    hint = re.sub(r"<b>🩺\s*Preceptoria[^<]*:?</b>\s*", "", hint)
    hint = re.sub(r"<b>⚠️\s*Armadilha[^<]*:?</b>\s*", "", hint)
    hint = re.sub(r"🎯\s*\[ALVO DE BANCA\]\s*", "", hint)
    hint = re.sub(r"🚨\s*\[BEIRA-LEITO\]\s*", "", hint)

    # Encurtamento defensivo de comentários longos (> 320 chars)
    # Isola tags de mídia antes de contar caracteres visíveis
    img_block_re = re.compile(
        r"^\s*(<img\s+[^>]+>(?:\s*<br\s*/?>\s*<i>.*?</i>)?(?:\s*<br\s*/?>)*)",
        re.IGNORECASE | re.DOTALL,
    )
    audio_block_re = re.compile(
        r"((?:<br\s*/?>\s*)*<audio\b[^>]*>.*?</audio>\s*)",
        re.IGNORECASE | re.DOTALL,
    )

    audio_blocks = audio_block_re.findall(hint)
    text_hint = audio_block_re.sub("", hint).strip()

    img_prefix = ""
    m_img = img_block_re.match(text_hint)
    if m_img:
        img_prefix = re.sub(r"(<br\s*/?>\s*)+$", "", m_img.group(1).strip()) + "<br><br>"
        text_hint = text_hint[m_img.end():].strip()
    else:
        # Se a imagem estiver em qualquer outro ponto do hint, resgata e reposiciona no topo (canônico)
        m_any_img = re.search(
            r"(?:<br\s*/?>\s*)*(<img\s+[^>]+>(?:\s*<br\s*/?>\s*<i>.*?</i>)?)(?:\s*<br\s*/?>)*",
            text_hint,
            re.IGNORECASE | re.DOTALL,
        )
        if m_any_img:
            img_prefix = re.sub(r"(<br\s*/?>\s*)+$", "", m_any_img.group(1).strip()) + "<br><br>"
            text_hint = (text_hint[:m_any_img.start()] + " " + text_hint[m_any_img.end():]).strip()
            repairs += 1

    if not text_hint.startswith("<b>Comentário:</b>"):
        text_hint = f"<b>Comentário:</b> {text_hint}".strip()
        repairs += 1

    comment_only = text_hint.replace("<b>Comentário:</b>", "", 1).strip()
    if len(lint.visible_text(comment_only)) > MAX_COMMENT_CHARS:
        for pattern, repl in MEDICAL_ABBREVIATIONS:
            text_hint = re.sub(pattern, repl, text_hint)

    comment_only = text_hint.replace("<b>Comentário:</b>", "", 1).strip()
    if len(lint.visible_text(comment_only)) > MAX_COMMENT_CHARS:
        sentences = re.split(r"(?<=[.!?])\s+", text_hint)
        built = ""
        for s in sentences:
            candidate = f"{built} {s}".strip() if built else s
            cand_body = candidate.replace("<b>Comentário:</b>", "", 1).strip()
            if len(lint.visible_text(cand_body)) <= MAX_COMMENT_CHARS:
                built = candidate
            else:
                break
        text_hint = built or (text_hint[:MAX_COMMENT_CHARS].rsplit(" ", 1)[0] + ".")
        repairs += 1

    audio_suffix = f"<br>{audio_blocks[0].strip()}" if audio_blocks else ""
    note["hint"] = f"{img_prefix}{text_hint}{audio_suffix}".strip()

    return repairs


# ============================================================================
# 5. SÍNTESE DE MICRO-ÁUDIO NEURAL (OPCIONAL)
# ============================================================================


async def generate_neural_audio(
    text: str, output_path: Path, voice: str = "pt-BR-AntonioNeural"
) -> bool:
    try:
        await audio.synthesize_speech(text, output_path, voice=voice, rate="+5%")
        return True
    except Exception as exc:
        print(
            f"[warn] Falha ao sintetizar áudio ({exc}); prosseguindo sem áudio.",
            file=sys.stderr,
        )
        return False


# ============================================================================
# 6. PIPELINE PRINCIPAL UNIFICADO
# ============================================================================


def run_pipeline(
    pdf_path: Path | list[Path] | None = None,
    deck_key: str | None = None,
    deck_title: str | None = None,
    *,
    pdf_paths: list[Path] | None = None,
    mode: str = "flash",
    tts: bool = False,
    max_images: int = 15,
    no_images: bool = False,
    budget: str = "high",
    anki_sync: bool = True,
    send_telegram: bool = True,
) -> GenerationReport:
    paths: list[Path] = []
    if pdf_paths:
        paths = list(pdf_paths)
    elif isinstance(pdf_path, list):
        paths = list(pdf_path)
    elif isinstance(pdf_path, Path):
        paths = [pdf_path]

    if not paths:
        raise ValueError("Nenhum arquivo PDF fornecido para o pipeline.")

    for p in paths:
        if not p.is_file():
            raise FileNotFoundError(f"Arquivo PDF não encontrado: {p}")

    mode_norm = (mode or "flash").lower().strip()
    if mode_norm not in ("hybrid", "argon", "flash"):
        raise ValueError(
            f"Modo de execução inválido: '{mode}'. Escolha 'flash', 'hybrid' ou 'argon'."
        )

    project = build.Project()
    primary_pdf = paths[0]
    inferred_key, inferred_title = infer_metadata(primary_pdf, deck_key, deck_title)
    doc_names = ", ".join(f"'{p.name}'" for p in paths)
    mode_badges = {
        "hybrid": "HYBRID (Flash 3.8 Draft ➔ Flash 3.8 High Preceptor)",
        "argon": "FLASH HIGH (Redirecionado de Argon)",
        "flash": "PURE FLASH (100% Gemini 3.8 Flash High)",
    }
    print(
        f"\n🚀 [PIPELINE] Iniciando geração de deck: {inferred_title} ({inferred_key})"
    )
    print(f"⚙️  [ARQUITETURA] Modo: {mode_badges.get(mode_norm, 'FLASH')}")
    print(f"📄 [DOCUMENTOS] {len(paths)} arquivo(s) integrado(s): {doc_names}")

    # 1. Destino e proteção do histórico
    media_dir = project.media_dir(inferred_key)
    notes_path = project.notes_path(inferred_key)

    registry = anki.GuidRegistry(project.registry)
    if (
        notes_path.exists()
        and json.loads(notes_path.read_text(encoding="utf-8-sig")) != []
    ) or any(key.startswith(f"{inferred_key}:") for key in registry.entries):
        raise ValueError(
            f"O deck '{inferred_key}' já tem notas ou histórico. Use o refinador ou escolha outra chave."
        )

    report = GenerationReport(
        deck_key=inferred_key,
        deck_title=inferred_title,
        pdf_paths=paths,
        mode=mode_norm,
    )

    source_manifest = "\nCaminhos exatos para sources.file (na ordem dos anexos):\n"
    for path in paths:
        resolved = path.resolve()
        if resolved.is_relative_to(project.sources_dir.resolve()):
            relative = resolved.relative_to(project.sources_dir.resolve())
        elif resolved.is_relative_to(project.root.resolve()):
            relative = resolved.relative_to(project.root.resolve())
        else:
            raise ValueError(f"Coloque o PDF no acervo do projeto antes de gerar: {path}")
        source_manifest += f"- {relative.as_posix()}\n"

    # 2. Extração de Figuras
    figures: list[ExtractedFigure] = []
    if not no_images:
        print(f"📸 [IMAGENS] Extraindo figuras de {len(paths)} PDF(s)...")
        figures = extract_pdf_figures(
            paths, media_dir, inferred_key, max_images=max_images
        )
        report.extracted_images = len(figures)

    # 3. Geração Cognitiva por Estágios
    raw_notes: list[dict[str, Any]] = []
    if mode_norm == "hybrid":
        print(
            f"⚡ [HYBRID: ESTÁGIO 1] Gemini 3.8 Flash extraindo rascunho factual de {len(paths)} PDF(s)..."
        )
        draft_prompt = build_draft_prompt(
            inferred_key, inferred_title, figures, pdf_paths=paths
        )
        mapa_clinico, draft_notes = run_gemini_model_with_map(
            "gemini-3.8-flash", draft_prompt + source_manifest, pdf_paths=paths, budget="high"
        )
        print(
            f"📝 [HYBRID: ESTÁGIO 1] {len(draft_notes)} notas rascunhadas pelo Flash 3.8."
        )

        print(
            f"⚡ [HYBRID: ESTÁGIO 2] Gemini 3.8 Flash High lapidando {len(draft_notes)} notas (Doutrina Internato-First & Contraste)..."
        )
        refine_prompt = build_refinement_prompt(
            inferred_key, inferred_title, draft_notes, figures=figures, mapa_clinico=mapa_clinico
        )
        raw_notes = run_gemini_model(
            "gemini-3.8-flash", refine_prompt + source_manifest, pdf_paths=paths, budget=budget
        )
        print(
            f"✨ [HYBRID: ESTÁGIO 2] {len(raw_notes)} notas refinadas com contraste diferencial."
        )

    elif mode_norm == "argon":
        print(
            f"⚡ [ARGON ➔ FLASH] Modo Argon redirecionado para Gemini 3.8 Flash High (créditos Vertex AI esgotados) sobre {len(paths)} PDF(s)..."
        )
        prompt_text = build_argon_prompt(
            inferred_key, inferred_title, figures, pdf_paths=paths
        )
        raw_notes = run_gemini_model(
            "gemini-3.8-flash", prompt_text + source_manifest, pdf_paths=paths, budget=budget
        )
        print(f"📝 [FLASH] {len(raw_notes)} notas geradas pelo Gemini 3.8 Flash.")

    elif mode_norm == "flash":
        print(
            f"⚡ [FLASH: ESTÁGIO 1] Gemini 3.8 Flash extraindo rascunho factual de {len(paths)} PDF(s)..."
        )
        draft_prompt = build_draft_prompt(
            inferred_key, inferred_title, figures, pdf_paths=paths
        )
        mapa_clinico, draft_notes = run_gemini_model_with_map(
            "gemini-3.8-flash", draft_prompt + source_manifest, pdf_paths=paths, budget="high"
        )
        print(
            f"📝 [FLASH: ESTÁGIO 1] {len(draft_notes)} notas rascunhadas pelo Flash 3.8."
        )

        print(
            f"⚡ [FLASH: ESTÁGIO 2] Gemini 3.8 Flash refinando e podando {len(draft_notes)} notas..."
        )
        refine_prompt = build_refinement_prompt(
            inferred_key, inferred_title, draft_notes, figures=figures, mapa_clinico=mapa_clinico
        )
        raw_notes = run_gemini_model(
            "gemini-3.8-flash", refine_prompt + source_manifest, pdf_paths=paths, budget="high"
        )
        print(f"✨ [FLASH: ESTÁGIO 2] {len(raw_notes)} notas refinadas pelo Flash 3.8.")

    # 4. Auto-Reparo e Atribuição de IDs
    base_id = int(time.time() * 1000)
    repaired_notes: list[dict[str, Any]] = []
    total_repairs = 0

    if not raw_notes:
        raise RuntimeError("O modelo não retornou notas.")

    for idx, raw_note in enumerate(raw_notes):
        note_id = base_id + idx
        repairs = auto_heal_note(
            raw_note, inferred_key, note_id
        )
        total_repairs += repairs
        raw_note.setdefault("sources", [])
        repaired_notes.append(raw_note)

    # Atribuição determinística de fontes e páginas reais do PDF
    bind_real_sources(repaired_notes, paths, project.root)

    report.auto_repairs = total_repairs

    # 5. TTS Neural Opcional
    if tts:
        print("🎙️ [TTS] Gerando micro-áudios neurais para cards estratégicos...")
        for idx, n in enumerate(repaired_notes[:3]):  # Limite de até 3 áudios por deck
            vis_comment = lint.visible_text(n["hint"].replace("<b>Comentário:</b>", ""))
            if len(vis_comment) > 40:
                audio_file = f"{inferred_key}_audio_{n['id']}.mp3"
                audio_path = media_dir / audio_file
                if asyncio.run(generate_neural_audio(vis_comment, audio_path)):
                    audio_tag = f'<audio controls preload="none" class="med-audio"><source src="{audio_file}" type="audio/mp3"></audio><br>'
                    n["hint"] = f"{audio_tag}{n['hint']}"
                    report.generated_audios += 1

    # 6. Validar antes de publicar o JSON.
    issues, referenced_media = lint.lint_deck(
        repaired_notes, media_dir, sources_dir=project.sources_dir
    )

    n_errors = sum(i.severity == "erro" for i in issues)
    n_warnings = len(issues) - n_errors
    if n_errors > 0:
        for err in issues:
            if err.severity == "erro":
                print(
                    f"   ❌ [LINTER] Nota {err.note_id}: {err.message}", file=sys.stderr
                )
        raise RuntimeError(f"O deck gerado possui {n_errors} erro(s) de validação.")

    print(f"✅ [LINTER] Aprovado com 0 erros ({n_warnings} avisos)!")
    print(deck_review.review_fronts(repaired_notes))
    report.total_notes = len(repaired_notes)
    report.cloze_count = sum(1 for n in repaired_notes if n["type"] == "cloze")
    report.basic_count = sum(1 for n in repaired_notes if n["type"] == "basic")
    report.linked_images = len(
        [m for m in referenced_media if m.endswith(tuple(lint.IMAGE_EXT))]
    )

    # 7. Empacotamento .apkg e Sync Anki
    deck_config = ensure_scaffold(project, inferred_key, inferred_title)
    apkg_file = build.publish_deck(
        project, inferred_key, deck_config, repaired_notes, referenced_media, notes_path
    )
    report.apkg_path = apkg_file
    print(f"📦 [BUILD] Pacote .apkg compilado: {apkg_file.relative_to(project.root)}")

    if anki_sync:
        try:
            try:
                total_in_deck = anki.sync_package(
                    apkg_file,
                    deck_config["deck_name"],
                    notes=repaired_notes,
                    deck_key=inferred_key,
                    deck_id=deck_config["deck_id"],
                    media_dir=project.media_dir(inferred_key),
                    media_files=referenced_media,
                    registry=anki.GuidRegistry(project.registry),
                    json_path=notes_path,
                )
            except TypeError:
                total_in_deck = anki.sync_package(
                    apkg_file, deck_config["deck_name"], notes=repaired_notes
                )
            report.anki_synced = True
            print(
                f"🔄 [ANKI] Sincronizado no Anki Desktop ({total_in_deck} notas no deck)!"
            )
        except Exception as exc:
            print(f"⚠️ [ANKI] Falha ao sincronizar com AnkiConnect: {exc}")
            print(f"Para retomar: uv run cards --deck {inferred_key} --sync-only")

    # 8. Notificação Telegram
    if send_telegram and TELEGRAM_TOKEN and TELEGRAM_CHAT_ID:
        doc_summary = ", ".join(p.name for p in paths[:2]) + (
            "..." if len(paths) > 2 else ""
        )
        msg = (
            f"🎉 *Novo Deck Criado com Sucesso via Terminal*:\n\n"
            f"• *Título*: `{inferred_title}`\n"
            f"• *Chave*: `{inferred_key}`\n"
            f"• *Modo de IA*: `{mode_badges.get(mode_norm, mode_norm)}`\n"
            f"• *Documentos*: {len(paths)} PDF(s) integrados (`{doc_summary}`)\n"
            f"• *Notas*: {report.total_notes} ({report.cloze_count} Cloze | {report.basic_count} Basic)\n"
            f"• *Mídias*: {report.linked_images} imagens vinculadas | {report.generated_audios} áudios\n"
            f"• *Auto-Reparos*: {report.auto_repairs}\n"
            f"• *Anki Desktop*: {'✅ Sincronizado' if report.anki_synced else '📁 Arquivado em .apkg'}"
        )
        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
            body = json.dumps(
                {"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "Markdown"}
            ).encode("utf-8")
            req = urllib.request.Request(
                url, data=body, headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=10)
            report.telegram_sent = True
            print("📲 [TELEGRAM] Notificação enviada com sucesso!")
        except Exception:
            pass

    return report


def main(argv: list[str] | None = None) -> int:
    from criador_cards.generator_cli import main as cli_main

    return cli_main(argv)


if __name__ == "__main__":
    sys.exit(main())
