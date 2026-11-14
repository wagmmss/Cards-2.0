from __future__ import annotations

import asyncio
import difflib
import html
import json
import logging
import os
import re
import shutil
import time
import tomllib
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

import pymupdf

from criador_cards import anki, audio, build, lint, pdf_images
from criador_cards.terminal import TerminalUI

logger = logging.getLogger(__name__)

ALLOWED_NOTE_FIELDS: frozenset[str] = frozenset(
    {
        "id",
        "type",
        "topic",
        "question",
        "answer",
        "hint",
        "tags",
        "sources",
        "image_mode",
        "exam_refs",
    }
)

REQUIRED_NOTE_FIELDS: frozenset[str] = frozenset(
    {
        "id",
        "type",
        "topic",
        "question",
        "answer",
        "hint",
        "tags",
        "sources",
    }
)

MAX_CLOZE_WORDS: int = 5
MAX_COMMENT_VISIBLE_CHARS: int = 320

CLOZE_PATTERN: re.Pattern[str] = re.compile(
    r"\{\{c(\d+)::([^}:]+?)(?:::([^}]+?))?\}\}", re.DOTALL
)
IMG_TAG_PATTERN: re.Pattern[str] = re.compile(
    r'<img\s+[^>]*src=["\']([^"\']+)["\'][^>]*>', re.IGNORECASE
)
BUSCAR_IMAGEM_PATTERN: re.Pattern[str] = re.compile(
    r"\[BUSCAR\s+IMAGEM(?::\s*([^\]]+))?\]", re.IGNORECASE
)
AUDIO_BLOCK_PATTERN: re.Pattern[str] = re.compile(
    r"<audio\b[^>]*>.*?</audio>", re.IGNORECASE | re.DOTALL
)
AUDIO_SRC_PATTERN: re.Pattern[str] = re.compile(
    r'<source\s+[^>]*src=["\']([^"\']+\.mp3)["\'][^>]*>', re.IGNORECASE
)
HTML_TAG_PATTERN: re.Pattern[str] = re.compile(r"<[^>]+>")
COMMENT_MARKER_PATTERN: re.Pattern[str] = re.compile(
    r"<b>\s*Coment[áa]rio:\s*</b>\s*", re.IGNORECASE
)

CLINICAL_MEDIA_KEYWORDS: tuple[str, ...] = (
    "ecg",
    "eletrocardiograma",
    "radiografia",
    "raio-x",
    "rx ",
    "tomografia",
    "tc de ",
    "tc ",
    "ultrassonografia",
    "usg",
    "ecocardiograma",
    "algoritmo",
    "fluxograma",
    "fundo de olho",
    "lâmina",
    "dermatoscopia",
    "gasometria",
)

HIGH_YIELD_AUDIO_KEYWORDS: tuple[str, ...] = (
    "emergência",
    "choque",
    "parada",
    "intubação",
    "anafilaxia",
    "imediata",
    "primeira linha",
    "conduta imediata",
    "estabilização",
    "plantão",
    "red flag",
    "antídoto",
    "trombólise",
    "desfibrilação",
    "cardioversão",
)

MEDICAL_KEY_ALIASES: dict[str, tuple[str, ...]] = {
    "has": ("hipertensao_arterial_sistemica", "hipertensao_arterial", "hipertensao"),
    "dm": ("diabetes_mellitus", "diabetes"),
    "ist": ("infeccoes_sexualmente_transmissiveis", "dst"),
    "ic": ("insuficiencia_cardiaca",),
    "itu": ("infeccao_do_trato_urinario", "infeccao_urinaria"),
    "drc": ("doenca_renal_cronica",),
    "ira": ("injuria_renal_aguda", "insuficiencia_renal_aguda"),
    "dpoc": ("doenca_pulmonar_obstrutiva_cronica",),
    "tep": ("tromboembolismo_pulmonar",),
    "tvp": ("trombose_venosa_profunda",),
    "avc": ("acidente_vascular_cerebral", "acidente_vascular_encefalico"),
    "ave": ("acidente_vascular_encefalico", "acidente_vascular_cerebral"),
    "sca": ("sindrome_coronariana_aguda",),
    "iam": ("infarto_agudo_do_miocardio",),
    "tb": ("tuberculose",),
    "dheg": ("disturbios_hipertensivos_da_gestacao", "pre_eclampsia"),
}

PASTE_END_MARKERS: frozenset[str] = frozenset({"FIM", "EOF", ":Q", "END", "PRONTO"})
PASTE_CANCEL_MARKERS: frozenset[str] = frozenset({"CANCELAR", "CANCEL", "ABORT"})


def get_project_root() -> Path:
    """Resolve a raiz do projeto Criador de Cards."""
    env_root = os.environ.get("CRIADOR_CARDS_ROOT")
    if env_root:
        return Path(env_root).resolve()
    return Path(__file__).resolve().parents[2]


def _normalize_slug(text: str) -> str:
    """Remove acentos e normaliza texto para comparação insensível a caixa/símbolos."""
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "_", ascii_only.lower()).strip("_")


def strip_html_tags(text: str) -> str:
    """Remove tags HTML e decodifica entidades para contagem exata de texto visível."""
    without_audio = AUDIO_BLOCK_PATTERN.sub("", text)
    with_breaks = re.sub(r"<br\s*/?>", " ", without_audio, flags=re.IGNORECASE)
    raw = HTML_TAG_PATTERN.sub("", with_breaks)
    unescaped = html.unescape(raw)
    return re.sub(r"\s+", " ", unescaped).strip()


def extract_comment_body_html(hint: str) -> str:
    """Extrai o trecho HTML após <b>Comentário:</b> sem blocos de áudio."""
    without_audio = AUDIO_BLOCK_PATTERN.sub("", hint).strip()
    match = COMMENT_MARKER_PATTERN.search(without_audio)
    if not match:
        return without_audio
    return without_audio[match.end() :].strip()


def extract_comment_visible_text(hint: str) -> str:
    """Extrai apenas o texto visível após o marcador <b>Comentário:</b>."""
    body_html = extract_comment_body_html(hint)
    return strip_html_tags(body_html)


def count_words(text: str) -> int:
    """Conta palavras visíveis em um fragmento de texto."""
    clean = strip_html_tags(text)
    if not clean:
        return 0
    return len([tok for tok in re.split(r"\s+", clean) if tok])


def _normalize_pasted_card_dict(
    raw_card: dict[str, Any],
    fallback_id: int,
    default_topic: str = "Clínica Médica",
) -> dict[str, Any]:
    """
    Normaliza um dicionário de card colado pelo usuário (suportando chaves em
    português/inglês ou formatos simplificados de LLMs) para o schema canônico.
    """
    question = str(
        raw_card.get("question")
        or raw_card.get("pergunta")
        or raw_card.get("frente")
        or raw_card.get("front")
        or raw_card.get("enunciado")
        or raw_card.get("text")
        or raw_card.get("texto")
        or ""
    ).strip()

    answer = str(
        raw_card.get("answer")
        or raw_card.get("resposta")
        or raw_card.get("verso")
        or raw_card.get("back")
        or ""
    ).strip()

    hint = str(
        raw_card.get("hint")
        or raw_card.get("comentario")
        or raw_card.get("comentário")
        or raw_card.get("extra")
        or raw_card.get("explicacao")
        or raw_card.get("explicação")
        or raw_card.get("rationale")
        or ""
    ).strip()

    topic = str(
        raw_card.get("topic")
        or raw_card.get("topico")
        or raw_card.get("tópico")
        or raw_card.get("tema")
        or raw_card.get("assunto")
        or default_topic
    ).strip()

    has_cloze_syntax = bool(CLOZE_PATTERN.search(question)) or "{{c" in question
    raw_type = str(raw_card.get("type") or raw_card.get("tipo") or "").strip().lower()
    if raw_type in {"cloze", "omissao", "omissão", "lacuna"} or has_cloze_syntax:
        card_type = "cloze"
    elif raw_type in {"basic", "basico", "básico", "qa"} or answer:
        card_type = "basic"
    else:
        card_type = "cloze" if has_cloze_syntax else "basic"

    # Se for basic sem lacuna e sem resposta, transforma em cloze se houver termo em negrito
    if card_type == "basic" and not answer and not has_cloze_syntax:
        bold_match = re.search(r"<b>([^<]{2,40})</b>", question)
        if bold_match:
            term = bold_match.group(1)
            question = question.replace(bold_match.group(0), f"{{{{c1::{term}}}}}", 1)
            card_type = "cloze"

    raw_tags = raw_card.get("tags")
    if isinstance(raw_tags, list):
        tags = [str(t).strip() for t in raw_tags if str(t).strip()]
    elif isinstance(raw_tags, str) and raw_tags.strip():
        tags = [t.strip() for t in re.split(r"[,;\s]+", raw_tags) if t.strip()]
    else:
        slug_topic = _normalize_slug(topic) or "clinica_medica"
        tags = ["internato", "alto_rendimento", slug_topic]

    raw_sources = raw_card.get("sources") or raw_card.get("fontes")
    if isinstance(raw_sources, list) and raw_sources:
        sources = [
            s if isinstance(s, dict) else {"title": str(s), "type": "reference"}
            for s in raw_sources
        ]
    else:
        sources = []

    raw_id = raw_card.get("id")
    card_id = int(raw_id) if isinstance(raw_id, int) or (isinstance(raw_id, str) and raw_id.isdigit()) else fallback_id

    normalized: dict[str, Any] = {
        "id": card_id,
        "type": card_type,
        "topic": topic,
        "question": question,
        "answer": "" if card_type == "cloze" else answer,
        "hint": hint,
        "tags": tags,
        "sources": sources,
    }

    if "image_mode" in raw_card:
        normalized["image_mode"] = raw_card["image_mode"]
    if "exam_refs" in raw_card:
        normalized["exam_refs"] = raw_card["exam_refs"]

    return normalized


def extract_pasted_payload(
    raw_text: str,
    default_topic: str = "Clínica Médica",
) -> tuple[list[dict[str, Any]], str | None, str | None]:
    """
    Analisa o texto colado no terminal (JSON array, objeto JSON, blocos Markdown
    ```json ... ```, múltiplos objetos JSON soltos ou texto estruturado Q/A/Cloze)
    e retorna `(cards_normalizados, deck_key_inferido, deck_title_inferido)`.
    """
    cleaned = raw_text.strip()
    if not cleaned:
        raise ValueError("Nenhum conteúdo foi colado.")

    inferred_key: str | None = None
    inferred_title: str | None = None
    extracted_raw_cards: list[dict[str, Any]] = []

    # 1. Remove cercas de código Markdown se presentes
    fence_blocks = re.findall(
        r"```(?:json|jsonl|javascript|js|txt|markdown)?\s*(.*?)\s*```",
        cleaned,
        flags=re.DOTALL | re.IGNORECASE,
    )
    candidates_to_parse = fence_blocks if fence_blocks else [cleaned]

    for block in candidates_to_parse:
        block_str = block.strip()
        if not block_str:
            continue

        # Tentativa A: JSON direto
        parsed_obj: Any = None
        try:
            parsed_obj = json.loads(block_str)
        except Exception:
            # Tentativa B: Isolar do primeiro '[' ou '{' até o último ']' ou '}'
            starts = [pos for pos in (block_str.find("["), block_str.find("{")) if pos != -1]
            ends = [pos for pos in (block_str.rfind("]"), block_str.rfind("}")) if pos != -1]
            if starts and ends and min(starts) < max(ends):
                sub = block_str[min(starts) : max(ends) + 1]
                try:
                    parsed_obj = json.loads(sub)
                except Exception:
                    # Tentativa C: Objetos JSON separados por vírgula ou quebra de linha sem '[' externo
                    try:
                        wrapped = "[" + re.sub(r"\}\s*\n+\s*\{", "},{", sub) + "]"
                        parsed_obj = json.loads(wrapped)
                    except Exception:
                        parsed_obj = None

        if parsed_obj is not None:
            if isinstance(parsed_obj, list):
                for item in parsed_obj:
                    if isinstance(item, dict):
                        extracted_raw_cards.append(item)
            elif isinstance(parsed_obj, dict):
                if isinstance(parsed_obj.get("deck_key") or parsed_obj.get("key"), str):
                    inferred_key = str(parsed_obj.get("deck_key") or parsed_obj.get("key")).strip()
                if isinstance(parsed_obj.get("deck_title") or parsed_obj.get("title"), str):
                    inferred_title = str(parsed_obj.get("deck_title") or parsed_obj.get("title")).strip()

                found_nested = False
                for list_key in ("notes", "cards", "items", "fragments", "data"):
                    if isinstance(parsed_obj.get(list_key), list):
                        found_nested = True
                        for item in parsed_obj[list_key]:
                            if isinstance(item, dict):
                                extracted_raw_cards.append(item)
                        break
                if not found_nested:
                    extracted_raw_cards.append(parsed_obj)

    # 2. Se não for JSON, analisa formato textual estruturado (Q:/A:, Pergunta:/Resposta:, ou Cloze)
    if not extracted_raw_cards:
        extracted_raw_cards = _parse_structured_text_cards(cleaned, default_topic=default_topic)

    if not extracted_raw_cards:
        raise ValueError(
            "Não foi possível identificar cards válidos no conteúdo colado. "
            "Forneça um JSON ([...] ou {...}) ou texto com 'Pergunta: ... / Resposta: ...' ou '{{c1::...}}'."
        )

    base_ts = int(time.time() * 1000)
    normalized_cards: list[dict[str, Any]] = []
    for idx, raw_c in enumerate(extracted_raw_cards, start=1):
        norm = _normalize_pasted_card_dict(
            raw_c,
            fallback_id=base_ts + idx,
            default_topic=default_topic,
        )
        if norm["question"]:
            normalized_cards.append(norm)

    if not normalized_cards:
        raise ValueError("Os cards colados não possuem o campo 'question' (enunciado/pergunta).")

    if not inferred_key and normalized_cards:
        first_topic = normalized_cards[0].get("topic", "")
        if first_topic and first_topic != "Clínica Médica":
            inferred_key = _normalize_slug(first_topic)
            inferred_title = first_topic

    return normalized_cards, inferred_key, inferred_title


def parse_pasted_cards(
    raw_text: str,
    default_topic: str = "Clínica Médica",
) -> list[dict[str, Any]]:
    """Converte o texto ou JSON colado pelo usuário em uma lista de notas normalizadas."""
    cards, _, _ = extract_pasted_payload(raw_text, default_topic=default_topic)
    return cards


def _parse_structured_text_cards(
    text: str,
    default_topic: str = "Clínica Médica",
) -> list[dict[str, Any]]:
    """
    Parser inteligente para flashcards colados em texto livre:
    - Blocos separados por linha em branco ou '---'
    - Suporta marcadores 'Pergunta:/Q:/Frente:', 'Resposta:/A:/Verso:', 'Comentário:/Hint:/Extra:', 'Tópico:/Tema:'
    - Suporta linhas contendo '{{c1::...}}' ou pares 'Pergunta :: Resposta'
    """
    blocks = [
        b.strip()
        for b in re.split(r"(?:\n\s*---+\s*\n|\n\s*\n)+", text.strip())
        if b.strip()
    ]
    cards: list[dict[str, Any]] = []

    q_prefix = re.compile(r"^(?:pergunta|question|frente|front|q|enunciado)\s*[:\-]\s*(.+)$", re.IGNORECASE)
    a_prefix = re.compile(r"^(?:resposta|answer|verso|back|a|r)\s*[:\-]\s*(.+)$", re.IGNORECASE)
    h_prefix = re.compile(r"^(?:coment[áa]rio|hint|extra|explica[çc][ãa]o|obs)\s*[:\-]\s*(.+)$", re.IGNORECASE)
    t_prefix = re.compile(r"^(?:t[óo]pico|topic|tema|assunto)\s*[:\-]\s*(.+)$", re.IGNORECASE)

    for block in blocks:
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue

        current: dict[str, Any] = {"topic": default_topic}
        unlabeled_lines: list[str] = []

        for line in lines:
            clean_line = re.sub(r"^[\-\*\d\)\.]+\s+", "", line).strip()
            m_t = t_prefix.match(clean_line)
            m_q = q_prefix.match(clean_line)
            m_a = a_prefix.match(clean_line)
            m_h = h_prefix.match(clean_line)

            if m_t:
                current["topic"] = m_t.group(1).strip()
            elif m_q:
                current["question"] = m_q.group(1).strip()
            elif m_a:
                current["answer"] = m_a.group(1).strip()
            elif m_h:
                current["hint"] = m_h.group(1).strip()
            else:
                unlabeled_lines.append(clean_line)

        if "question" not in current and unlabeled_lines:
            first_line = unlabeled_lines[0]
            if "::" in first_line and "{{c" not in first_line:
                parts = first_line.split("::", 1)
                current["question"] = parts[0].strip()
                current["answer"] = parts[1].strip()
                if len(unlabeled_lines) > 1 and "hint" not in current:
                    current["hint"] = " ".join(unlabeled_lines[1:])
            elif "{{c" in first_line:
                current["type"] = "cloze"
                current["question"] = first_line
                current["answer"] = ""
                if len(unlabeled_lines) > 1 and "hint" not in current:
                    current["hint"] = " ".join(unlabeled_lines[1:])
            elif len(unlabeled_lines) >= 2 and first_line.endswith("?"):
                current["type"] = "basic"
                current["question"] = first_line
                current["answer"] = unlabeled_lines[1]
                if len(unlabeled_lines) > 2 and "hint" not in current:
                    current["hint"] = " ".join(unlabeled_lines[2:])
            elif len(first_line) >= 12:
                # Transforma sentença declarativa em cloze se contiver palavra-chave ou básico
                current["question"] = first_line
                if len(unlabeled_lines) > 1 and "answer" not in current:
                    current["answer"] = unlabeled_lines[1]

        if current.get("question"):
            cards.append(current)

    return cards


@dataclass
class DeckCatalogEntry:
    """Metadados de um deck descoberto no projeto para seleção rápida na CLI."""

    key: str
    title: str
    notes_path: Path
    note_count: int = 0
    area: str = ""


def discover_available_decks(project_root: Path | None = None) -> list[DeckCatalogEntry]:
    """
    Descobre todos os decks registrados em `decks.toml` e em `data/decks/*_notes.json`.
    """
    root = project_root or get_project_root()
    decks_dir = root / "data" / "decks"
    toml_path = root / "decks.toml"

    entries_by_key: dict[str, DeckCatalogEntry] = {}

    if toml_path.is_file():
        try:
            raw_toml = tomllib.loads(toml_path.read_text(encoding="utf-8"))
            for key, cfg in raw_toml.items():
                if not isinstance(cfg, dict):
                    continue
                if key == "decks":
                    for subkey, subcfg in cfg.items():
                        if isinstance(subcfg, dict):
                            title = str(
                                subcfg.get("deck_name")
                                or subcfg.get("title")
                                or subcfg.get("name")
                                or subkey.replace("_", " ").title()
                            )
                            area = str(subcfg.get("area") or "")
                            notes_rel = (
                                subcfg.get("json_file")
                                or subcfg.get("notes")
                                or f"{subkey}_notes.json"
                            )
                            notes_path = root / "data" / "decks" / Path(str(notes_rel)).name
                            entries_by_key[subkey] = DeckCatalogEntry(
                                key=subkey,
                                title=title,
                                notes_path=notes_path,
                                area=area,
                            )
                    continue
                title = str(
                    cfg.get("deck_name")
                    or cfg.get("title")
                    or cfg.get("name")
                    or key.replace("_", " ").title()
                )
                area = str(cfg.get("area") or "")
                notes_rel = (
                    cfg.get("json_file")
                    or cfg.get("notes")
                    or f"{key}_notes.json"
                )
                notes_path = root / "data" / "decks" / Path(str(notes_rel)).name
                entries_by_key[key] = DeckCatalogEntry(
                    key=key,
                    title=title,
                    notes_path=notes_path,
                    area=area,
                )
        except Exception as exc:
            logger.debug("Falha ao ler decks.toml: %s", exc)

    if decks_dir.is_dir():
        for json_file in sorted(decks_dir.glob("*_notes.json")):
            key = json_file.name[: -len("_notes.json")]
            if key not in entries_by_key:
                entries_by_key[key] = DeckCatalogEntry(
                    key=key,
                    title=key.replace("_", " ").title(),
                    notes_path=json_file,
                )

    catalog: list[DeckCatalogEntry] = []
    for key in sorted(entries_by_key):
        entry = entries_by_key[key]
        if entry.notes_path.is_file():
            try:
                data = json.loads(entry.notes_path.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    entry.note_count = len(data)
                elif isinstance(data, dict) and isinstance(data.get("notes"), list):
                    entry.note_count = len(data["notes"])
            except Exception:
                entry.note_count = 0
        catalog.append(entry)

    return catalog


def resolve_deck_target(
    target: str, project_root: Path | None = None
) -> tuple[str, Path | None, str]:
    """
    Resolve um argumento livre do usuário (chave, sigla médica, substring ou caminho .json)
    para `(deck_key, input_json_path_or_None, deck_title)`.
    """
    root = project_root or get_project_root()
    raw = target.strip()

    # 1. Verifica se o alvo é um caminho de arquivo JSON direto
    candidate_path = Path(raw)
    if not candidate_path.is_absolute() and not candidate_path.exists():
        alt_in_root = root / raw
        if alt_in_root.exists():
            candidate_path = alt_in_root

    if candidate_path.is_file() or raw.lower().endswith(".json"):
        stem = candidate_path.stem
        inferred_key = stem[: -len("_notes")] if stem.endswith("_notes") else stem
        inferred_key = _normalize_slug(inferred_key) or "deck_refinado"
        return inferred_key, candidate_path, inferred_key.replace("_", " ").title()

    catalog = discover_available_decks(root)
    if not catalog:
        slug = _normalize_slug(raw) or "deck_refinado"
        return slug, None, slug.replace("_", " ").title()

    by_key = {entry.key: entry for entry in catalog}
    slug_query = _normalize_slug(raw)

    # 2. Match exato por chave
    if raw in by_key:
        hit = by_key[raw]
        return hit.key, None, hit.title
    if slug_query in by_key:
        hit = by_key[slug_query]
        return hit.key, None, hit.title

    # 3. Match por siglas médicas conhecidas (ex: has -> hipertensao_arterial_sistemica)
    if slug_query in MEDICAL_KEY_ALIASES:
        for alias_target in MEDICAL_KEY_ALIASES[slug_query]:
            if alias_target in by_key:
                hit = by_key[alias_target]
                return hit.key, None, hit.title
            for entry in catalog:
                if alias_target in entry.key:
                    return entry.key, None, entry.title

    # 4. Match por acrônimo automático das iniciais da chave (ex: i_s_t -> ist)
    stopwords = {"de", "da", "do", "das", "dos", "e", "em", "na", "no"}
    for entry in catalog:
        tokens = [t for t in entry.key.split("_") if t]
        acronym_all = "".join(t[0] for t in tokens)
        acronym_clean = "".join(t[0] for t in tokens if t not in stopwords)
        if slug_query in {acronym_all, acronym_clean}:
            return entry.key, None, entry.title

    # 5. Match por prefixo ou substring na chave ou no título
    prefix_matches = [
        e for e in catalog if e.key.startswith(slug_query) or _normalize_slug(e.title).startswith(slug_query)
    ]
    if len(prefix_matches) == 1:
        hit = prefix_matches[0]
        return hit.key, None, hit.title

    substring_matches = [
        e
        for e in catalog
        if slug_query in e.key or slug_query in _normalize_slug(e.title)
    ]
    if len(substring_matches) >= 1:
        existing_subs = [e for e in substring_matches if e.notes_path.is_file()]
        hit = existing_subs[0] if existing_subs else substring_matches[0]
        return hit.key, None, hit.title

    # 6. Match fuzzy via difflib
    close_keys = difflib.get_close_matches(slug_query, list(by_key.keys()), n=1, cutoff=0.55)
    if close_keys:
        hit = by_key[close_keys[0]]
        return hit.key, None, hit.title

    return slug_query or raw, None, (slug_query or raw).replace("_", " ").title()


@dataclass
class MediaResolutionResult:
    """Resultado da resolução em cascata de mídia para um card."""

    card_id: int
    status: str  # "NONE" | "EXISTING_LINKED" | "EXTRACTED_FROM_PDF" | "ON_DEMAND_REQUIRED"
    image_filename: str | None = None
    source_pdf: str | None = None
    message: str = ""


@dataclass
class MutationRecord:
    """Registro de mutação cirúrgica de um card original para 1..N cards refinados."""

    original_id: int
    new_ids: list[int]
    action: str  # "UNCHANGED" | "REFINED_IN_PLACE" | "SPLIT_1_TO_N"
    violations_detected: list[str] = field(default_factory=list)
    media_status: str = "NONE"
    audio_generated: bool = False
    used_local_fallback: bool = False


@dataclass
class SurgicalReport:
    """Relatório consolidado da execução do pipeline de refinamento."""

    deck_key: str
    input_count: int
    output_count: int
    split_operations: int
    in_place_refinements: int
    unchanged_count: int
    violations_before: dict[str, int]
    violations_after: dict[str, int]
    linter_errors: int
    linter_warnings: int
    linter_messages: list[str]
    media_resolutions: list[MediaResolutionResult] = field(default_factory=list)
    mutations: list[MutationRecord] = field(default_factory=list)
    apkg_path: str | None = None
    anki_synced: bool = False
    publication_error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class FSRSIdAllocator:
    """
    Alocador determinístico de IDs que preserva o histórico de agendamento FSRS.

    Regras:
    - Refinamento 1 -> 1: preserva o `id` original intacto.
    - Desmembramento 1 -> N: o 1º fragmento herda o `id` original; os fragmentos
      2..N recebem `int(time.time() * 1000) + offset` estritamente crescentes e
      livres de colisão.
    """

    def __init__(self, existing_ids: Iterable[int] = ()) -> None:
        self._used_ids: set[int] = {int(i) for i in existing_ids if i is not None}
        self._offset: int = 0
        self._last_generated: int = max(self._used_ids, default=0)

    def register_id(self, card_id: int) -> None:
        self._used_ids.add(int(card_id))
        if card_id > self._last_generated:
            self._last_generated = int(card_id)

    def next_unique_id(self) -> int:
        self._offset += 1
        base_ts = int(time.time() * 1000) + self._offset
        candidate = max(base_ts, self._last_generated + 1)
        while candidate in self._used_ids:
            self._offset += 1
            candidate += 1
        self._used_ids.add(candidate)
        self._last_generated = candidate
        return candidate

    def allocate_for_group(
        self, original_id: int | None, fragment_count: int
    ) -> list[int]:
        if fragment_count <= 0:
            return []

        allocated: list[int] = []
        if original_id is not None:
            orig_int = int(original_id)
            self._used_ids.add(orig_int)
            allocated.append(orig_int)
        else:
            allocated.append(self.next_unique_id())

        for _ in range(1, fragment_count):
            allocated.append(self.next_unique_id())

        return allocated


class MediaCascadeResolver:
    """
    Resolvedor de mídias visuais em cascata de 3 níveis:
    1º: Verifica existência em `04_Mídias/<chave>/`.
    2º: Se requisitado e inexistente, busca e recorta do acervo `02_Capítulos_PDF/` via `pdf_images`.
    3º: Se não localizado automaticamente, sinaliza `ON_DEMAND_REQUIRED`.
    """

    def __init__(self, project_root: Path | None = None) -> None:
        self.project_root = project_root or get_project_root()
        self.media_root = self.project_root / "04_Mídias"
        self.pdf_root = self.project_root / "02_Capítulos_PDF"

    def needs_clinical_image(self, card: dict[str, Any]) -> bool:
        image_mode = str(card.get("image_mode") or "").lower().strip()
        if image_mode in {"required", "clinical", "algorithm", "exam", "true"}:
            return True
        if image_mode in {"none", "false", "disabled"}:
            return False

        hint = str(card.get("hint") or "")
        question = str(card.get("question") or "")
        if (
            IMG_TAG_PATTERN.search(hint)
            or IMG_TAG_PATTERN.search(question)
            or BUSCAR_IMAGEM_PATTERN.search(hint)
            or BUSCAR_IMAGEM_PATTERN.search(question)
        ):
            return True

        combined_lower = f"{question} {hint}".lower()
        return any(kw.lower() in combined_lower for kw in CLINICAL_MEDIA_KEYWORDS)

    def resolve_for_card(
        self, card: dict[str, Any], deck_key: str
    ) -> MediaResolutionResult:
        card_id = int(card.get("id") or 0)
        deck_media_dir = self.media_root / deck_key
        deck_media_dir.mkdir(parents=True, exist_ok=True)

        hint = str(card.get("hint") or "")
        question = str(card.get("question") or "")

        img_match = IMG_TAG_PATTERN.search(hint) or IMG_TAG_PATTERN.search(question)
        explicit_img_name = Path(img_match.group(1)).name if img_match else None

        buscar_match = BUSCAR_IMAGEM_PATTERN.search(hint) or BUSCAR_IMAGEM_PATTERN.search(question)
        buscar_query = (
            buscar_match.group(1).strip()
            if (buscar_match and buscar_match.group(1))
            else None
        )

        if not self.needs_clinical_image(card) and not explicit_img_name and not buscar_match:
            return MediaResolutionResult(
                card_id=card_id,
                status="NONE",
                message="Card não requer imagem clínica.",
            )

        # 1º Nível: Verificar em 04_Mídias/<chave>/ ou no acervo geral via query
        existing_file = self._find_existing_media(
            deck_media_dir,
            card_id,
            explicit_img_name,
            str(card.get("topic") or ""),
            query=buscar_query,
        )
        if existing_file is not None:
            self._ensure_img_tag_in_hint(card, existing_file.name)
            return MediaResolutionResult(
                card_id=card_id,
                status="EXISTING_LINKED",
                image_filename=existing_file.name,
                message=f"Mídia existente vinculada em 04_Mídias/{deck_key}/{existing_file.name}.",
            )

        # 2º Nível: Buscar e extrair de 02_Capítulos_PDF/ via pdf_images
        target_filename = explicit_img_name or f"{deck_key}_{card_id}.png"
        extracted_file, source_pdf_name = (None, None)
        if explicit_img_name is None:
            extracted_file, source_pdf_name = self._extract_from_pdf_repository(
                card, deck_media_dir / target_filename
            )
        if extracted_file is not None and extracted_file.exists():
            self._ensure_img_tag_in_hint(card, extracted_file.name)
            return MediaResolutionResult(
                card_id=card_id,
                status="EXTRACTED_FROM_PDF",
                image_filename=extracted_file.name,
                source_pdf=source_pdf_name,
                message=(
                    f"Imagem extraída do PDF '{source_pdf_name}' "
                    f"para 04_Mídias/{deck_key}/{extracted_file.name}."
                ),
            )

        # 3º Nível: Sinalizar ON_DEMAND_REQUIRED
        return MediaResolutionResult(
            card_id=card_id,
            status="ON_DEMAND_REQUIRED",
            image_filename=explicit_img_name,
            message=(
                f"Mídia clínica requerida para o card {card_id} não localizada "
                f"em 04_Mídias/{deck_key}/ nem extraída de 02_Capítulos_PDF/."
            ),
        )

    def _find_existing_media(
        self,
        deck_media_dir: Path,
        card_id: int,
        explicit_name: str | None,
        topic: str,
        query: str | None = None,
    ) -> Path | None:
        if not self.media_root.exists():
            return None

        valid_exts = {".png", ".jpg", ".jpeg", ".webp", ".svg"}

        if explicit_name:
            if deck_media_dir.exists():
                candidate = deck_media_dir / explicit_name
                if candidate.is_file():
                    return candidate
            for p in self.media_root.rglob(explicit_name):
                if p.is_file() and p.suffix.lower() in valid_exts:
                    if deck_media_dir.exists() and p.parent != deck_media_dir:
                        dest = deck_media_dir / p.name
                        if not dest.exists():
                            shutil.copy2(p, dest)
                        return dest
                    return p

        deck_images = (
            sorted(
                p
                for p in deck_media_dir.iterdir()
                if p.is_file() and p.suffix.lower() in valid_exts
            )
            if deck_media_dir.exists()
            else []
        )

        id_str = str(card_id)
        if id_str and id_str != "0":
            for img_path in deck_images:
                if id_str in img_path.stem:
                    return img_path

        # Busca por termos da query (ex: [BUSCAR IMAGEM: ecg flutter])
        query_words: list[str] = []
        if query:
            clean_q = re.sub(
                r"[^a-zA-Z0-9áéíóúÁÉÍÓÚãõÃÕâêîôûÂÊÎÔÛçÇ]+", " ", query
            ).lower()
            stopwords = {
                "imagem",
                "buscar",
                "foto",
                "figura",
                "ver",
                "para",
                "com",
                "que",
                "uma",
                "card",
                "de",
                "do",
                "da",
            }
            query_words = [
                w for w in clean_q.split() if len(w) > 2 and w not in stopwords
            ]

        if query_words:
            for img_path in deck_images:
                stem_lower = img_path.stem.lower()
                if any(w in stem_lower for w in query_words):
                    return img_path

            for p in self.media_root.rglob("*"):
                if p.is_file() and p.suffix.lower() in valid_exts:
                    stem_lower = p.stem.lower()
                    if all(w in stem_lower for w in query_words) or (
                        len(query_words) >= 2
                        and sum(w in stem_lower for w in query_words) >= 2
                    ):
                        if deck_media_dir.exists() and p.parent != deck_media_dir:
                            dest = deck_media_dir / p.name
                            if not dest.exists():
                                shutil.copy2(p, dest)
                            return dest
                        return p

        topic_slug = re.sub(r"[^a-z0-9]+", "_", topic.lower()).strip("_")
        if len(topic_slug) >= 4:
            for img_path in deck_images:
                if topic_slug in img_path.stem.lower():
                    return img_path

        return None

    def _extract_from_pdf_repository(
        self, card: dict[str, Any], output_path: Path
    ) -> tuple[Path | None, str | None]:
        # Usa somente a página citada. Se houver mais de uma figura, exige seleção.
        candidates: set[tuple[Path, int]] = set()
        for source in card.get("sources") or []:
            if not isinstance(source, dict):
                continue
            name, page = source.get("file"), source.get("page")
            if not isinstance(name, str) or type(page) is not int or page < 1:
                continue
            pdf = (self.pdf_root / name).resolve()
            if pdf.is_relative_to(self.pdf_root.resolve()) and pdf.suffix.lower() == ".pdf":
                if pdf.is_file():
                    candidates.add((pdf, page))

        if len(candidates) != 1:
            return None, None
        pdf, page = next(iter(candidates))
        try:
            with pymupdf.open(pdf) as doc:
                images = {
                    image[0] for image in doc[page - 1].get_images()
                    if min(image[2], image[3]) >= 150
                }
                if len(images) != 1:
                    return None, None
                pix = pymupdf.Pixmap(doc, images.pop())
                if pix.n - pix.alpha >= 4:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                pdf_images.save_png(
                    pdf_images.pixmap_to_image(pix), output_path, overwrite=False, crop=False
                )
                return output_path, pdf.name
        except (OSError, ValueError, RuntimeError, IndexError) as exc:
            logger.warning("Não foi possível extrair mídia de %s: %s", pdf.name, exc)
        return None, None

    @staticmethod
    def _ensure_img_tag_in_hint(card: dict[str, Any], image_filename: str) -> None:
        hint = str(card.get("hint") or "").strip()
        question = str(card.get("question") or "").strip()

        # 1. Se a tag [BUSCAR IMAGEM] estiver no question (ex: image_mode recognition)
        if BUSCAR_IMAGEM_PATTERN.search(question):
            card["question"] = BUSCAR_IMAGEM_PATTERN.sub(
                f'<img src="{image_filename}">', question, count=1
            )
            return

        topic = str(card.get("topic") or "Achado clínico").strip()
        caption = f"<i>Figura clínica: {html.escape(topic)}.</i>"
        img_prefix = f'<img src="{image_filename}"><br>{caption}<br><br>'

        # 2. Se a tag [BUSCAR IMAGEM] estiver no hint
        if BUSCAR_IMAGEM_PATTERN.search(hint):
            card["hint"] = BUSCAR_IMAGEM_PATTERN.sub(img_prefix, hint, count=1)
            return

        if f'src="{image_filename}"' in hint or f"src='{image_filename}'" in hint:
            return

        if IMG_TAG_PATTERN.search(hint):
            card["hint"] = IMG_TAG_PATTERN.sub(
                f'<img src="{image_filename}">', hint, count=1
            )
            return

        if COMMENT_MARKER_PATTERN.search(hint):
            card["hint"] = f"{img_prefix}{hint}"
        else:
            card["hint"] = f"{img_prefix}<b>Comentário:</b> {hint}"


class CardRefiner:
    """
    Motor cirúrgico de diagnóstico, refinamento assistido pelo Gemini 4 Argon,
    alocação de IDs FSRS, resolução de mídia em cascata, síntese de áudio e
    portão estrito de linting.
    """

    def __init__(
        self,
        project_root: Path | None = None,
        argon_bin: str | None = None,
        argon_timeout: int = 240,
    ) -> None:
        self.project_root = project_root or get_project_root()
        self.argon_bin = argon_bin or os.environ.get("ARGON_BIN", "argon")
        self.argon_timeout = argon_timeout
        self.media_resolver = MediaCascadeResolver(project_root=self.project_root)

    def diagnose_card(self, card: dict[str, Any]) -> list[str]:
        """
        Audita um card contra as regras da Doutrina Internato-First e retorna
        os códigos de violação detectados:
        - CLOZE_TOO_LONG
        - MULTIPLE_CLOZES
        - HINT_OVER_320_CHARS
        - MULTIPLE_EVAL_UNITS
        - PARENTHESIS_SPOILER
        """
        violations: list[str] = []
        card_type = str(card.get("type") or "").strip().lower()
        question = str(card.get("question") or "").strip()
        answer = str(card.get("answer") or "").strip()
        hint = str(card.get("hint") or "").strip()

        # 1. Validação de Clozes (tamanho da lacuna e múltiplas lacunas)
        if card_type == "cloze":
            matches = list(CLOZE_PATTERN.finditer(question))
            if len(matches) > 1:
                violations.append("MULTIPLE_CLOZES")
            for match in matches:
                cloze_content = match.group(2).strip()
                if count_words(cloze_content) > MAX_CLOZE_WORDS:
                    if "CLOZE_TOO_LONG" not in violations:
                        violations.append("CLOZE_TOO_LONG")

        # 2. Validação do limite de 320 caracteres visíveis no Comentário
        visible_comment = extract_comment_visible_text(hint)
        has_comment_marker = bool(COMMENT_MARKER_PATTERN.search(hint))
        if (
            not has_comment_marker
            or not visible_comment
            or len(visible_comment) > MAX_COMMENT_VISIBLE_CHARS
        ):
            violations.append("HINT_OVER_320_CHARS")

        # 3. Validação de spoiler de resposta entre parênteses
        if lint.detect_parenthesis_spoiler(card):
            violations.append("PARENTHESIS_SPOILER")

        # 4. Validação de múltiplas unidades de avaliação no mesmo card
        if self._has_multiple_eval_units(card_type, question, answer):
            violations.append("MULTIPLE_EVAL_UNITS")

        return violations

    @staticmethod
    def _has_multiple_eval_units(
        card_type: str, question: str, answer: str
    ) -> bool:
        clean_q = strip_html_tags(question)
        q_without_vf = re.sub(
            r"\[?\s*verdadeiro\s+ou\s+falso\??\s*\]?",
            "",
            clean_q,
            flags=re.IGNORECASE,
        )
        if q_without_vf.count("?") > 1:
            return True

        if re.search(r"<(ul|ol|li)\b", question, flags=re.IGNORECASE) or re.search(
            r"<(ul|ol|li)\b", answer, flags=re.IGNORECASE
        ):
            return True

        clean_a = strip_html_tags(answer)
        if card_type == "basic":
            semicolons = clean_a.count(";")
            numbered_items = len(re.findall(r"(?:^|\s)\d+[\)\.]\s+", clean_a))
            if semicolons >= 2 or numbered_items >= 3 or count_words(clean_a) > 35:
                return True

        return False

    def refine_with_argon(
        self,
        cards: list[dict[str, Any]],
        deck_key: str,
        deck_title: str = "",
        force_all: bool = False,
    ) -> tuple[list[dict[str, Any]], list[MutationRecord]]:
        """
        Refina os cards que apresentam violações diagnósticas invocando
        `argon -b high` via subprocess e preserva rigorosamente os IDs FSRS.
        """
        existing_ids = [
            int(c["id"]) for c in cards if c.get("id") is not None
        ]
        allocator = FSRSIdAllocator(existing_ids=existing_ids)

        diagnostics_map: dict[int, list[str]] = {}
        cards_to_refine: list[dict[str, Any]] = []

        for card in cards:
            existing_id = card.get("id")
            cid = int(existing_id) if existing_id is not None else allocator.next_unique_id()
            card["id"] = cid
            allocator.register_id(cid)
            violations = self.diagnose_card(card)
            diagnostics_map[cid] = violations
            if violations or force_all:
                cards_to_refine.append(card)

        argon_mapping: dict[int, list[dict[str, Any]]] = {}
        if cards_to_refine:
            argon_mapping = self._invoke_argon_subprocess(
                cards_to_refine=cards_to_refine,
                diagnostics_map=diagnostics_map,
                deck_key=deck_key,
                deck_title=deck_title or deck_key.replace("_", " ").title(),
            )

        refined_deck: list[dict[str, Any]] = []
        mutations: list[MutationRecord] = []

        for original_card in cards:
            orig_id = int(original_card["id"])
            violations = diagnostics_map.get(orig_id, [])

            if not violations and not force_all:
                sanitized = self._enforce_card_invariants(
                    original_card, fallback_source=original_card
                )
                sanitized["id"] = orig_id
                refined_deck.append(sanitized)
                mutations.append(
                    MutationRecord(
                        original_id=orig_id,
                        new_ids=[orig_id],
                        action="UNCHANGED" if sanitized == original_card else "REFINED_IN_PLACE",
                        violations_detected=[],
                    )
                )
                continue

            candidate_fragments = argon_mapping.get(orig_id, [])
            expected_fragments = (
                len(CLOZE_PATTERN.findall(original_card["question"]))
                if "MULTIPLE_CLOZES" in violations else 1
            )
            used_local_fallback = len(candidate_fragments) < expected_fragments
            if used_local_fallback:
                candidate_fragments = self._local_surgical_fallback(
                    original_card, violations
                )

            normalized_fragments: list[dict[str, Any]] = []
            for frag in candidate_fragments:
                normalized_fragments.append(
                    self._enforce_card_invariants(
                        frag, fallback_source=original_card
                    )
                )

            allocated_ids = allocator.allocate_for_group(
                original_id=orig_id,
                fragment_count=len(normalized_fragments),
            )

            for frag, new_id in zip(normalized_fragments, allocated_ids):
                frag["id"] = new_id
                refined_deck.append(frag)

            action = (
                "SPLIT_1_TO_N"
                if len(allocated_ids) > 1
                else "REFINED_IN_PLACE"
            )
            mutations.append(
                MutationRecord(
                    original_id=orig_id,
                    new_ids=allocated_ids,
                    action=action,
                    violations_detected=violations,
                    used_local_fallback=used_local_fallback,
                )
            )

        return refined_deck, mutations

    def _build_argon_prompt(
        self,
        cards_to_refine: list[dict[str, Any]],
        diagnostics_map: dict[int, list[str]],
        deck_key: str,
        deck_title: str,
    ) -> str:
        payload_items = []
        for card in cards_to_refine:
            cid = int(card["id"])
            item: dict[str, Any] = {
                "original_id": cid,
                "violations": diagnostics_map.get(cid, []),
                "card": card,
            }
            spoiler = lint.detect_parenthesis_spoiler(card)
            if spoiler:
                item["spoiler_detail"] = spoiler
            payload_items.append(item)

        schema_instructions = {
            "deck_key": deck_key,
            "deck_title": deck_title,
            "doctrine": "Internato-First / R1 High-Yield",
            "strict_rules": [
                "Preserve tipo e objetivo de memória no primeiro fragmento de cada nota e não invente fontes ou páginas.",
                "Cada card deve testar apenas 1 unidade de conhecimento clínico (decisão, diagnóstico ou conduta).",
                "Se o card original tiver MULTIPLE_CLOZES ou MULTIPLE_EVAL_UNITS, desmembre-o em N cards atômicos na lista 'fragments'.",
                "Para type='cloze': use apenas {{c1::termo}} com no MÁXIMO 5 palavras dentro da lacuna e mantenha answer=''.",
                "Para type='basic': question direta ou '[Verdadeiro ou Falso?]' e answer concisa terminada em ponto final '.'.",
                "PROIBIÇÃO ABSOLUTA DE SPOILER ENTRE PARÊNTESES: É expressamente proibido colocar entre parênteses no enunciado ('question') a resposta do card, o termo ocultado na lacuna {{c1::...}}, sinônimos diretos, siglas equivalentes ou pistas reveladoras que entreguem o conteúdo testado. O contexto clínico deve descrever o cenário e achados sem antecipar a resposta entre parênteses.",
                "O campo 'hint' DEVE iniciar o comentário com '<b>Comentário:</b> ' (preservando <img> antes se existir), ter 1 a 2 frases com termos-chave em <b>negrito</b>, contraste diferencial quando houver confusão clínica relevante e NO MÁXIMO 320 caracteres visíveis após '<b>Comentário:</b>'.",
                "Retorne APENAS um objeto JSON válido no formato: {\"results\": [{\"original_id\": <int>, \"fragments\": [<card_dict>, ...]}]}",
            ],
            "items": payload_items,
        }

        return (
            "Você é o motor cirúrgico Gemini 4 Argon do projeto Criador de Cards.\n"
            "Refine os flashcards médicos abaixo corrigindo 100% das violações listadas.\n"
            "Responda EXCLUSIVAMENTE com JSON puro sem texto adicional:\n\n"
            + json.dumps(schema_instructions, ensure_ascii=False, indent=2)
        )

    def _invoke_argon_subprocess(
        self,
        cards_to_refine: list[dict[str, Any]],
        diagnostics_map: dict[int, list[str]],
        deck_key: str,
        deck_title: str,
    ) -> dict[int, list[dict[str, Any]]]:
        logger.info(
            "Execução do Argon desativada (créditos Vertex AI esgotados). Utilizando refinador cirúrgico determinístico local."
        )
        return {}

    @staticmethod
    def _parse_json_from_llm_output(raw_output: str) -> Any:
        cleaned = raw_output.strip()
        fence_match = re.search(
            r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```",
            cleaned,
            flags=re.DOTALL | re.IGNORECASE,
        )
        if fence_match:
            cleaned = fence_match.group(1).strip()
        else:
            first_brace = min(
                [pos for pos in (cleaned.find("{"), cleaned.find("[")) if pos != -1],
                default=-1,
            )
            if first_brace > 0:
                cleaned = cleaned[first_brace:]
            last_brace = max(cleaned.rfind("}"), cleaned.rfind("]"))
            if last_brace != -1:
                cleaned = cleaned[: last_brace + 1]

        return json.loads(cleaned)

    @staticmethod
    def _normalize_argon_response(
        parsed: Any,
    ) -> dict[int, list[dict[str, Any]]]:
        mapping: dict[int, list[dict[str, Any]]] = {}
        if isinstance(parsed, dict) and isinstance(parsed.get("results"), list):
            for entry in parsed["results"]:
                if not isinstance(entry, dict):
                    continue
                orig_id = entry.get("original_id")
                fragments = entry.get("fragments")
                if orig_id is not None and isinstance(fragments, list) and fragments:
                    valid_frags = [
                        f for f in fragments if isinstance(f, dict)
                    ]
                    if valid_frags:
                        mapping[int(orig_id)] = valid_frags
        elif isinstance(parsed, list):
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                if "original_id" in item and isinstance(item.get("fragments"), list):
                    mapping[int(item["original_id"])] = [
                        f for f in item["fragments"] if isinstance(f, dict)
                    ]
                elif "id" in item:
                    cid = int(item["id"])
                    mapping.setdefault(cid, []).append(item)

        return mapping

    def _local_surgical_fallback(
        self, card: dict[str, Any], violations: list[str]
    ) -> list[dict[str, Any]]:
        """
        Refinamento cirúrgico determinístico local para garantir 100% de
        conformidade mesmo quando o binário externo não está presente ou
        quando um card exige desmembramento imediato de múltiplos clozes.
        """
        card_type = str(card.get("type") or "cloze").strip().lower()
        question = str(card.get("question") or "").strip()

        fragments: list[dict[str, Any]] = []

        if card_type == "cloze" and "MULTIPLE_CLOZES" in violations:
            matches = list(CLOZE_PATTERN.finditer(question))
            if len(matches) > 1:
                for target_idx, _ in enumerate(matches):
                    rebuilt_q = self._isolate_single_cloze(
                        question, matches, target_idx
                    )
                    frag_copy = dict(card)
                    frag_copy["question"] = rebuilt_q
                    frag_copy["answer"] = ""
                    fragments.append(frag_copy)

        if not fragments:
            fragments = [dict(card)]

        for frag in fragments:
            frag["question"] = self._clean_parenthesis_spoiler(frag)
            if str(frag.get("type") or "").lower() == "cloze":
                frag["question"] = self._shorten_long_clozes(
                    str(frag.get("question") or "")
                )
                frag["answer"] = ""

        return fragments

    @staticmethod
    def _clean_parenthesis_spoiler(card: dict[str, Any]) -> str:
        """Remove parênteses do enunciado que entregam a lacuna ou a resposta."""
        card_type = str(card.get("type") or "").strip().lower()
        q = str(card.get("question") or "")
        a = str(card.get("answer") or "")
        if not lint.detect_parenthesis_spoiler(card):
            return q

        if card_type == "basic":
            ans_norm = lint._normalize_text_for_spoiler(a)
            ans_kw = lint._extract_core_keywords(ans_norm)
            for m in re.finditer(r"\s*\(([^)]+)\)", q):
                p_text = m.group(1).strip()
                p_norm = lint._normalize_text_for_spoiler(p_text)
                is_spoiler = False
                if ans_norm == p_norm or (len(ans_norm) > 4 and ans_norm in p_norm):
                    is_spoiler = True
                elif ans_kw and all(k in set(p_norm.split()) for k in ans_kw):
                    is_spoiler = True
                if is_spoiler:
                    q = q[: m.start()] + q[m.end() :]
                    break

        elif card_type == "cloze":
            cloze_spans = list(CLOZE_PATTERN.finditer(q))
            for c in cloze_spans:
                target = c.group(2).split("::")[0].strip()
                target_norm = lint._normalize_text_for_spoiler(target)
                target_kw = lint._extract_core_keywords(target_norm)
                for m in re.finditer(r"\s*\(([^)]+)\)", q):
                    if c.start() <= m.start() < c.end():
                        continue
                    p_text = m.group(1).strip()
                    p_norm = lint._normalize_text_for_spoiler(p_text)
                    is_spoiler = False
                    if target_norm == p_norm or (len(target_norm) > 4 and target_norm in p_norm):
                        is_spoiler = True
                    elif target_kw and all(k in set(p_norm.split()) for k in target_kw):
                        is_spoiler = True
                    if is_spoiler:
                        q = q[: m.start()] + q[m.end() :]
                        break

        q = re.sub(r"\s+([?.!,;])", r"\1", q)
        q = re.sub(r"[ \t]+", " ", q).strip()
        return q

    @staticmethod
    def _isolate_single_cloze(
        question: str,
        matches: list[re.Match[str]],
        active_index: int,
    ) -> str:
        result_parts: list[str] = []
        last_pos = 0
        for idx, match in enumerate(matches):
            result_parts.append(question[last_pos : match.start()])
            content = match.group(2).strip()
            cloze_hint = match.group(3)
            if idx == active_index:
                if cloze_hint:
                    result_parts.append(f"{{{{c1::{content}::{cloze_hint.strip()}}}}}")
                else:
                    result_parts.append(f"{{{{c1::{content}}}}}")
            else:
                result_parts.append(f"<b>{content}</b>")
            last_pos = match.end()
        result_parts.append(question[last_pos:])
        return "".join(result_parts)

    @staticmethod
    def _shorten_long_clozes(question: str) -> str:
        def _replacer(match: re.Match[str]) -> str:
            content = match.group(2).strip()
            cloze_hint = match.group(3)
            # Remove dicas proibidas
            if cloze_hint:
                d_lower = cloze_hint.strip().lower()
                if (
                    any(
                        p in d_lower
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
                    or " ou " in d_lower
                ):
                    cloze_hint = None

            words = [w for w in re.split(r"\s+", strip_html_tags(content)) if w]
            if len(words) <= MAX_CLOZE_WORDS:
                if cloze_hint:
                    return f"{{{{c1::{content}::{cloze_hint.strip()}}}}}"
                return f"{{{{c1::{content}}}}}"

            # Tenta podar artigos/preposições iniciais
            if words and words[0].lower() in {"o", "a", "os", "as", "um", "uma", "de", "do", "da", "para", "em", "no", "na"}:
                words = words[1:]
                content = " ".join(words)

            if len(words) <= MAX_CLOZE_WORDS:
                if cloze_hint:
                    return f"{{{{c1::{content}::{cloze_hint.strip()}}}}}"
                return f"{{{{c1::{content}}}}}"

            core_words = " ".join(words[:MAX_CLOZE_WORDS])
            overflow_words = " ".join(words[MAX_CLOZE_WORDS:])
            if cloze_hint:
                return f"{{{{c1::{core_words}::{cloze_hint.strip()}}}}} {overflow_words}"
            return f"{{{{c1::{core_words}}}}} {overflow_words}"

        return CLOZE_PATTERN.sub(_replacer, question)

    @staticmethod
    def _strip_duplicate_topic_prefix(question: str, topic: str = "") -> str:
        """Remove prefixos em negrito no início da pergunta que repetem o tópico ou subtópico."""
        m = re.match(r"^\s*(?:\*\*|<b>)(.*?)(?:\*\*|</b>)[:\.]?\s*(.*)", question, re.DOTALL)
        if not m:
            return question
        prefix = m.group(1).strip()
        rest = m.group(2).strip()
        if not rest:
            return question
        p_lower = prefix.lower()
        t_lower = topic.lower().strip()
        subtop = topic.split(" - ")[-1].strip().lower() if " - " in topic else t_lower
        if (
            not topic
            or p_lower in t_lower
            or t_lower in p_lower
            or p_lower in subtop
            or subtop in p_lower
            or " - " in prefix
        ):
            if re.findall(r"\{\{c\d+::.*?\}\}", question) == re.findall(r"\{\{c\d+::.*?\}\}", rest):
                return rest
        return question

    def _enforce_card_invariants(
        self,
        card: dict[str, Any],
        fallback_source: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        source = fallback_source if isinstance(fallback_source, dict) else {}
        cleaned: dict[str, Any] = {}

        for key in ALLOWED_NOTE_FIELDS:
            if key in card and card[key] is not None:
                cleaned[key] = card[key]
            elif key in source and source[key] is not None:
                cleaned[key] = source[key]

        card_type = str(cleaned.get("type") or "cloze").strip().lower()
        if card_type not in {"cloze", "basic"}:
            card_type = "cloze"
        cleaned["type"] = card_type

        cleaned["topic"] = str(cleaned.get("topic") or "Clínica Médica").strip()
        question = str(cleaned.get("question") or "").strip()
        answer = str(cleaned.get("answer") or "").strip()

        question = self._clean_parenthesis_spoiler(
            {"type": card_type, "question": question, "answer": answer}
        )
        question = self._strip_duplicate_topic_prefix(question, cleaned["topic"])

        if card_type == "cloze":
            question = self._shorten_long_clozes(question)
            matches = list(CLOZE_PATTERN.finditer(question))
            if len(matches) > 1:
                question = self._isolate_single_cloze(question, matches, 0)
            answer = ""
        else:
            # Sanitiza answer basic removendo <b>...</b> e <strong>...</strong> externos
            answer = re.sub(
                r"^</?(?:b|strong)>\s*|\s*</?(?:b|strong)>$", "", answer, flags=re.IGNORECASE
            )
            answer = re.sub(
                r"^<(?:b|strong)>(.*?)</(?:b|strong)>\.?$", r"\1.", answer, flags=re.IGNORECASE | re.DOTALL
            ).strip()
            if answer and not answer.endswith("."):
                answer = answer.rstrip("?!;:, ") + "."

        cleaned["question"] = question
        cleaned["answer"] = answer
        cleaned["hint"] = self._normalize_hint_structure(
            hint=str(cleaned.get("hint") or ""),
            topic=cleaned["topic"],
        )

        tags = cleaned.get("tags")
        if not isinstance(tags, list):
            tags = []
        cleaned["tags"] = [str(t).strip() for t in tags if str(t).strip()]

        sources = source.get("sources", cleaned.get("sources"))
        cleaned["sources"] = sources if isinstance(sources, list) else []

        return cleaned

    def _normalize_hint_structure(self, hint: str, topic: str) -> str:
        """
        Garante a estrutura estrita do hint:
        [Opcional: <img src="..."><br><i>Legenda...</i><br><br>]
        <b>Comentário:</b> [Texto com <b>termos</b>, contraste diferencial e <= 320 chars visíveis]
        [Opcional: no máximo 1 tag <audio controls preload="none" class="med-audio">...]
        """
        # Converte tags [sound:...] legadas em player <audio> HTML5
        hint = re.sub(
            r"\[sound:([^\]]+)\]",
            r'<audio controls preload="none" class="med-audio"><source src="\1" type="audio/mpeg"></audio>',
            hint,
        )
        # Remove marcadores legados
        hint = re.sub(r"🎯\s*\[ALVO DE BANCA\]\s*", "", hint)
        hint = re.sub(r"🚨\s*\[BEIRA-LEITO\]\s*", "", hint)
        hint = re.sub(r"<b>🩺\s*Preceptoria[^<]*:?</b>\s*", "", hint)
        hint = re.sub(r"<b>⚠️\s*Armadilha[^<]*:?</b>\s*", "", hint)

        audio_matches = AUDIO_BLOCK_PATTERN.findall(hint)
        single_audio = audio_matches[0].strip() if audio_matches else ""
        without_audio = AUDIO_BLOCK_PATTERN.sub("", hint).strip()

        img_prefix = ""
        comment_body = without_audio

        marker_match = COMMENT_MARKER_PATTERN.search(without_audio)
        if marker_match:
            before_marker = without_audio[: marker_match.start()].strip()
            comment_body = without_audio[marker_match.end() :].strip()
            if IMG_TAG_PATTERN.search(before_marker):
                img_prefix = re.sub(
                    r"(<br\s*/?>\s*)+$", "", before_marker, flags=re.IGNORECASE
                )
                img_prefix = f"{img_prefix}<br><br>"
        else:
            img_match = IMG_TAG_PATTERN.search(without_audio)
            if img_match:
                img_tag = img_match.group(0)
                comment_body = without_audio.replace(img_tag, "", 1).strip()
                comment_body = re.sub(
                    r"^(<br\s*/?>\s*)+", "", comment_body, flags=re.IGNORECASE
                )
                img_prefix = f"{img_tag}<br><i>Figura: {html.escape(topic)}.</i><br><br>"

        assembled = f"{img_prefix}<b>Comentário:</b> {comment_body}".strip()
        if single_audio:
            assembled = f"{assembled}<br>{single_audio}"
        return assembled

    def synthesize_audio_if_needed(
        self,
        cards: list[dict[str, Any]],
        deck_key: str,
        media_dir: Path | None = None,
    ) -> int:
        """
        Gera arquivos `.mp3` via `audio.synthesize_speech` (edge-tts) para cards
        de alta relevância clínica/emergencial ou que já referenciem áudio,
        salvando em `04_Mídias/<chave>/` e garantindo no máximo 1 `<audio>` por card.
        """
        target_media_dir = media_dir or (self.project_root / "04_Mídias" / deck_key)
        target_media_dir.mkdir(parents=True, exist_ok=True)
        generated_count = 0

        for card in cards:
            hint = str(card.get("hint") or "")
            existing_audios = AUDIO_BLOCK_PATTERN.findall(hint)

            if len(existing_audios) > 1:
                first_audio = existing_audios[0]
                without_all = AUDIO_BLOCK_PATTERN.sub("", hint).strip()
                hint = f"{without_all}<br>{first_audio}"
                card["hint"] = hint

            src_match = AUDIO_SRC_PATTERN.search(hint)
            if src_match:
                mp3_name = Path(src_match.group(1)).name
                mp3_path = target_media_dir / mp3_name
                if not mp3_path.exists():
                    narration = extract_comment_visible_text(hint)
                    if narration and self._call_audio_synthesizer(narration, mp3_path):
                        generated_count += 1
                continue

            if not self._card_benefits_from_audio(card):
                continue

            card_id = int(card.get("id") or 0)
            mp3_name = f"{deck_key}_{card_id}.mp3"
            mp3_path = target_media_dir / mp3_name
            narration = extract_comment_visible_text(hint)
            if not narration:
                continue

            if not mp3_path.exists():
                if self._call_audio_synthesizer(narration, mp3_path):
                    generated_count += 1

            if mp3_path.exists():
                audio_tag = (
                    f'<audio controls preload="none" class="med-audio">'
                    f'<source src="{mp3_name}" type="audio/mpeg"></audio>'
                )
                card["hint"] = f"{hint}<br>{audio_tag}"

        return generated_count

    @staticmethod
    def _card_benefits_from_audio(card: dict[str, Any]) -> bool:
        if str(card.get("audio_mode") or "").lower() in {"required", "true", "auto"}:
            return True
        combined = (
            f"{card.get('topic', '')} {card.get('question', '')} {card.get('hint', '')}"
        ).lower()
        return any(kw in combined for kw in HIGH_YIELD_AUDIO_KEYWORDS)

    @staticmethod
    def _call_audio_synthesizer(text: str, output_path: Path) -> bool:
        try:
            asyncio.run(audio.synthesize_speech(text, output_path))
            return True
        except Exception as exc:
            logger.warning("Falha na síntese de áudio: %s", exc)
            return False

    def strict_linter_gate(
        self, cards: list[dict[str, Any]], deck_key: str
    ) -> tuple[int, int, list[str]]:
        issues, _ = self._validate_candidate(cards, deck_key)
        errors = sum(issue.severity == "erro" for issue in issues)
        return errors, len(issues) - errors, [
            f"[{issue.severity.upper()}] Card #{issue.note_id}: {issue.message}"
            for issue in issues
        ]

    def _validate_candidate(
        self, cards: list[dict[str, Any]], deck_key: str
    ) -> tuple[list[lint.Issue], set[str]]:
        project = build.Project(self.project_root)
        issues, media = lint.lint_deck(
            cards, project.media_dir(deck_key), sources_dir=project.sources_dir
        )
        if not cards:
            issues.append(lint.Issue("erro", "deck-vazio", None, "nenhuma nota para refinar"))
        for card in cards:
            for violation in self.diagnose_card(card):
                issues.append(lint.Issue("erro", violation, card.get("id"), violation))
        return issues, media

    def _summarize_violations(
        self, cards: Sequence[dict[str, Any]]
    ) -> dict[str, int]:
        counts: dict[str, int] = {}
        for card in cards:
            for v in self.diagnose_card(card):
                counts[v] = counts.get(v, 0) + 1
        return counts

    def run(
        self,
        deck_key: str,
        cards: list[dict[str, Any]] | None = None,
        input_json: Path | None = None,
        output_json: Path | None = None,
        deck_title: str = "",
        enable_audio: bool = True,
        build_apkg: bool = False,
        anki_sync: bool = False,
        check_only: bool = False,
        persist: bool = True,
        verbose: bool = False,
        approve: Callable[
            [list[dict[str, Any]], list[dict[str, Any]], list[MutationRecord]], bool
        ] | None = None,
        step_callback: Callable[[int, int, str, str, str], None] | None = None,
    ) -> tuple[list[dict[str, Any]], SurgicalReport]:
        """
        Executa o pipeline completo de auditoria e refinamento cirúrgico:
        1. Carrega notas de `cards`, `input_json` ou `data/decks/<chave>_notes.json`.
        2. Audita violações antes da intervenção.
        3. Se `check_only=True`, retorna diagnóstico sem modificar arquivos.
        4. Executa `refine_with_argon` preservando IDs FSRS via `FSRSIdAllocator`.
        5. Resolve imagens em cascata (`MediaCascadeResolver`).
        6. Sintetiza áudio se habilitado (`synthesize_audio_if_needed`).
        7. Passa pelo portão estrito de linting (`strict_linter_gate`).
        8. Persiste JSON, compila `.apkg` se solicitado e sincroniza via AnkiConnect.
        """
        if not re.fullmatch(r"[a-z0-9_]+", deck_key):
            raise ValueError(f"Chave de deck inválida: {deck_key!r}")
        project = build.Project(self.project_root)
        notify = step_callback or (TerminalUI.step if verbose else None)
        total_steps = 6

        default_deck_path = (
            self.project_root / "data" / "decks" / f"{deck_key}_notes.json"
        )
        if input_json:
            source_path = input_json
        else:
            source_path = default_deck_path
            if not source_path.exists():
                alt_json = self.project_root / "data" / "decks" / f"{deck_key}.json"
                if alt_json.exists():
                    source_path = alt_json

        target_out = output_json or (source_path if persist else None)
        protected_paths = {source_path, default_deck_path}
        if target_out is not None:
            protected_paths.add(target_out)
        snapshots = {
            path: path.read_bytes() if path.is_file() else None for path in protected_paths
        } if approve is not None else {}

        provided_cards = cards is not None
        if cards is None:
            if not source_path.exists():
                raise FileNotFoundError(
                    f"Arquivo de notas não encontrado: {source_path}"
                )
            raw_data = json.loads(source_path.read_text(encoding="utf-8-sig"))
            cards = self._extract_notes_list(raw_data)

        # Pré-reconciliação cirúrgica com o Anki: se o Anki estiver aberto com o baralho,
        # assegura que qualquer nota já existente utilize seu noteId canônico antes do refinamento.
        decks = project.load_decks()
        deck_cfg = decks.get(deck_key, {})
        deck_name = deck_cfg.get("deck_name", "")
        anki_index = anki.get_deck_notes_index(deck_name) if deck_name else {"by_id": {}, "by_norm_q": {}, "reviewed_nids": set()}
        if anki_index.get("by_id"):
            for c in cards:
                cid = c.get("id")
                if cid not in anki_index["by_id"]:
                    norm_q = anki.normalize_question_for_matching(c.get("question", ""))
                    if norm_q in anki_index["by_norm_q"]:
                        c["id"] = anki_index["by_norm_q"][norm_q]

        input_cards = [dict(c) for c in cards]
        violations_before = self._summarize_violations(input_cards)
        total_v_before = sum(violations_before.values())

        if notify:
            notify(
                1,
                total_steps,
                "🔍",
                "Auditoria Diagnóstica & FSRS Snapshot...",
                f"{len(input_cards)} card(s), {total_v_before} violação(ões)",
            )

        ids = [card["id"] for card in input_cards if card.get("id") is not None]
        invalid_ids = any(type(cid) is not int or cid < 1 for cid in ids)
        if check_only or invalid_ids or len(set(ids)) != len(ids):
            err_cnt, warn_cnt, lint_msgs = self.strict_linter_gate(
                input_cards, deck_key
            )
            report = SurgicalReport(
                deck_key=deck_key,
                input_count=len(input_cards),
                output_count=len(input_cards),
                split_operations=0,
                in_place_refinements=0,
                unchanged_count=len(input_cards),
                violations_before=violations_before,
                violations_after=violations_before,
                linter_errors=err_cnt,
                linter_warnings=warn_cnt,
                linter_messages=lint_msgs,
            )
            return input_cards, report

        if notify:
            notify(
                2,
                total_steps,
                "🧠",
                "Refinamento Clínico (Gemini 4 Argon)...",
                f"deck: {deck_key}",
            )

        original_types = {card["id"]: card.get("type") for card in input_cards if card.get("id") is not None}
        original_cards = [dict(card) for card in input_cards]
        refined_cards, mutations = self.refine_with_argon(
            cards=input_cards,
            deck_key=deck_key,
            deck_title=deck_title,
        )

        if approve is not None and provided_cards:
            baseline = default_deck_path if build_apkg or anki_sync else target_out
            previous = snapshots.get(baseline) if baseline is not None else None
            original_cards = (
                self._extract_notes_list(json.loads(previous.decode("utf-8-sig")))
                if previous is not None else []
            )
        publish = approve is None or approve(original_cards, refined_cards, mutations)
        if publish and any(
            (path.read_bytes() if path.is_file() else None) != snapshot
            for path, snapshot in snapshots.items()
        ):
            raise ValueError("O deck ou o destino mudou durante a revisão. Gere uma nova prévia.")

        if notify:
            notify(
                3,
                total_steps,
                "🖼️",
                "Cascata de Resolução de Mídias...",
                f"04_Mídias/{deck_key}/ -> 02_Capítulos_PDF/",
            )

        media_resolutions: list[MediaResolutionResult] = []
        status_by_id: dict[int, str] = {}
        for card in refined_cards if publish and (persist or output_json or build_apkg or anki_sync) else []:
            res = self.media_resolver.resolve_for_card(card, deck_key)
            media_resolutions.append(res)
            status_by_id[int(card["id"])] = res.status

        if notify:
            notify(
                4,
                total_steps,
                "🎙️",
                "Síntese de Micro-Áudio (edge-tts)...",
                "ativado" if enable_audio else "desativado",
            )

        if enable_audio and publish and (persist or output_json or build_apkg or anki_sync):
            self.synthesize_audio_if_needed(refined_cards, deck_key)

        for mut in mutations:
            primary_id = mut.new_ids[0] if mut.new_ids else mut.original_id
            mut.media_status = status_by_id.get(primary_id, "NONE")
            card_match = next(
                (c for c in refined_cards if int(c.get("id", 0)) == primary_id),
                None,
            )
            if card_match and AUDIO_BLOCK_PATTERN.search(str(card_match.get("hint") or "")):
                mut.audio_generated = True

        violations_after = self._summarize_violations(refined_cards)
        issues, media = self._validate_candidate(refined_cards, deck_key)
        for card in refined_cards:
            old_type = original_types.get(card["id"])
            if old_type in {"cloze", "basic"} and card["type"] != old_type:
                issues.append(lint.Issue(
                    "erro", "modelo-alterado", card["id"],
                    "A nota existente precisa manter seu tipo para preservar o histórico.",
                ))
        if (target_out == default_deck_path or build_apkg or anki_sync) and default_deck_path.is_file():
            current = self._extract_notes_list(
                json.loads(default_deck_path.read_text(encoding="utf-8-sig"))
            )
            candidate_types = {card["id"]: card["type"] for card in refined_cards}
            for card in current:
                cid = card.get("id")
                if cid not in candidate_types or candidate_types[cid] != card.get("type"):
                    issues.append(lint.Issue(
                        "erro", "identidade", cid,
                        "O resultado remove ou muda o tipo de uma nota do deck existente. Mescle ou use outra chave.",
                    ))

        # Blindagem estrita contra perda de revisões FSRS no Anki Desktop:
        reviewed_nids = anki_index.get("reviewed_nids", set())
        if reviewed_nids:
            candidate_ids = {card.get("id") for card in refined_cards}
            dropped_reviewed = reviewed_nids - candidate_ids
            if dropped_reviewed:
                issues.append(
                    lint.Issue(
                        "erro",
                        "fsrs-preservacao",
                        None,
                        f"Violação de integridade FSRS: {len(dropped_reviewed)} nota(s) com revisões ativas no Anki seriam excluídas: {sorted(dropped_reviewed)}",
                    )
                )

        # Blindagem contra duplicidade de IDs dentro do mesmo baralho:
        all_candidate_ids = [c["id"] for c in refined_cards if c.get("id") is not None]
        if len(all_candidate_ids) != len(set(all_candidate_ids)):
            issues.append(
                lint.Issue(
                    "erro",
                    "id-duplicado",
                    None,
                    "O resultado gerou IDs de notas duplicados dentro do mesmo baralho.",
                )
            )
        err_cnt = sum(issue.severity == "erro" for issue in issues)
        warn_cnt = len(issues) - err_cnt
        lint_msgs = [
            f"[{issue.severity.upper()}] Card #{issue.note_id}: {issue.message}"
            for issue in issues
        ]
        if notify:
            notify(5, total_steps, "🛡️", "Validação do candidato",
                   f"{err_cnt} erro(s), {warn_cnt} aviso(s)")

        apkg_path_str: str | None = None
        synced = False
        publication_error = None
        if publish and not err_cnt:
            try:
                if build_apkg or anki_sync:
                    if notify:
                        notify(6, total_steps, "📦", "Publicação Anki", deck_key)
                    decks = project.load_decks()
                    if deck_key not in decks:
                        if build.create_deck(project, deck_key, deck_title) != 0:
                            raise ValueError(f"Não foi possível cadastrar '{deck_key}'.")
                        decks = project.load_decks()
                    deck = decks[deck_key]
                    output = build.publish_deck(
                        project, deck_key, deck, refined_cards, media, target_out,
                    )
                    apkg_path_str = str(output)
                elif target_out is not None:
                    build.write_notes(target_out, refined_cards)
                if anki_sync:
                    try:
                        anki.sync_package(
                            Path(apkg_path_str) if apkg_path_str else Path(),
                            deck["deck_name"],
                            notes=refined_cards,
                            deck_key=deck_key,
                            deck_id=deck["deck_id"],
                            media_dir=project.media_dir(deck_key),
                            media_files=media,
                            registry=build.anki.GuidRegistry(project.registry),
                            json_path=project.notes_path(deck_key),
                        )
                    except TypeError:
                        if apkg_path_str is not None:
                            anki.sync_package(Path(apkg_path_str), deck["deck_name"])
                    synced = True
            except Exception as exc:
                publication_error = str(exc)

        split_ops = sum(1 for m in mutations if m.action == "SPLIT_1_TO_N")
        in_place_ops = sum(
            1 for m in mutations if m.action == "REFINED_IN_PLACE"
        )
        unchanged_ops = sum(1 for m in mutations if m.action == "UNCHANGED")

        report = SurgicalReport(
            deck_key=deck_key,
            input_count=len(input_cards),
            output_count=len(refined_cards),
            split_operations=split_ops,
            in_place_refinements=in_place_ops,
            unchanged_count=unchanged_ops,
            violations_before=violations_before,
            violations_after=violations_after,
            linter_errors=err_cnt,
            linter_warnings=warn_cnt,
            linter_messages=lint_msgs,
            media_resolutions=media_resolutions,
            mutations=mutations,
            apkg_path=apkg_path_str,
            anki_synced=synced,
            publication_error=publication_error,
        )
        return refined_cards, report

    @staticmethod
    def _extract_notes_list(raw_data: Any) -> list[dict[str, Any]]:
        if isinstance(raw_data, list):
            return [item for item in raw_data if isinstance(item, dict)]
        if isinstance(raw_data, dict):
            for key in ("notes", "cards", "items"):
                if isinstance(raw_data.get(key), list):
                    return [
                        item for item in raw_data[key] if isinstance(item, dict)
                    ]
        raise ValueError(
            "O JSON de entrada deve ser uma lista de notas ou um objeto contendo 'notes'."
        )

def _merge_cards_preserving_fsrs(
    existing_cards: list[dict[str, Any]],
    new_cards: list[dict[str, Any]],
    deck_name: str | None = None,
) -> list[dict[str, Any]]:
    """
    Mescla cards recém-colados em um deck existente:
    - Se um card colado tiver o mesmo `id` ou `question` normalizado a um card existente,
      atualiza o card mantendo o `id` original do FSRS.
    - Se Anki estiver acessível e o card existir no Anki, adota o ID canônico do Anki.
    - Caso contrário, aloca um novo ID único FSRS e acrescenta ao final.
    """
    allocator = FSRSIdAllocator(
        existing_ids=[int(c["id"]) for c in existing_cards if c.get("id") is not None]
    )
    merged = [dict(c) for c in existing_cards]
    index_by_id = {int(c["id"]): idx for idx, c in enumerate(merged) if c.get("id") is not None}
    question_positions: dict[str, list[int]] = {}
    for idx, card in enumerate(merged):
        q_norm = anki.normalize_question_for_matching(card.get("question", ""))
        if q_norm:
            question_positions.setdefault(q_norm, []).append(idx)

    anki_index = anki.get_deck_notes_index(deck_name) if deck_name else {"by_id": {}, "by_norm_q": {}}

    for card in new_cards:
        c_copy = dict(card)
        cid = c_copy.get("id")
        q_norm = anki.normalize_question_for_matching(c_copy.get("question", ""))

        if cid is not None and int(cid) in index_by_id:
            pos = index_by_id[int(cid)]
            c_copy["id"] = int(cid)
            merged[pos] = c_copy
        elif q_norm and len(question_positions.get(q_norm, [])) == 1:
            pos = question_positions[q_norm][0]
            c_copy["id"] = int(merged[pos].get("id") or allocator.next_unique_id())
            merged[pos] = c_copy
        elif q_norm and q_norm in anki_index.get("by_norm_q", {}):
            # Adota o ID do Anki se a nota já existir no baralho no Anki
            c_copy["id"] = anki_index["by_norm_q"][q_norm]
            allocator.register_id(c_copy["id"])
            merged.append(c_copy)
        else:
            c_copy["id"] = allocator.next_unique_id()
            merged.append(c_copy)

    return merged


def main(argv: Sequence[str] | None = None) -> int:
    from criador_cards.refiner_cli import main as cli_main

    return cli_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
