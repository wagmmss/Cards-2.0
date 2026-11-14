"""Validação das notas segundo a skill `criar-cards`.

- ERRO: impede o build (o card quebraria ou violaria uma regra dura).
- AVISO: desvio de estilo da skill; só bloqueia com `--strict`.
"""

from __future__ import annotations

import html
import os
import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
SOURCES_ROOT = ROOT / "02_Capítulos_PDF"
MEDQUEST_DB = Path(
    os.environ.get("MEDQUEST_DB", str(Path.home() / "Desktop" / "medquest.db"))
)

ALLOWED_FIELDS = {
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
    "last_synced_hash",
}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
AUDIO_EXT = {".mp3", ".ogg", ".wav", ".m4a"}
MAX_CLOZE_WORDS = 5
MAX_BASIC_ANSWER_WORDS = 15
MAX_BASIC_ANSWER_CHARS = 110
MAX_QUESTION_WORDS = 50
MAX_COMMENT_CHARS = 320  # ~1–2 frases

CLOZE = re.compile(r"\{\{c(\d+)::(.*?)\}\}", re.DOTALL)
COMPOUND_QUESTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"\bqual\b[^?]{3,65}\be\s+(?:qual|quais|como|quando|onde)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bqual\s+(?:é\s+)?o\s+diagn[óo]stico\s+e\s+a\s+conduta\b",
        re.IGNORECASE,
    ),
)


@dataclass
class Issue:
    severity: str  # "erro" | "aviso"
    rule: str
    note_id: object
    message: str


def visible_text(text: str) -> str:
    text = CLOZE.sub(lambda m: m.group(2).split("::")[0], text or "")
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()


MEDICAL_UNITS_AND_STOPWORDS: frozenset[str] = frozenset(
    {
        "para",
        "com",
        "sem",
        "por",
        "que",
        "dos",
        "das",
        "uma",
        "como",
        "mais",
        "menos",
        "qual",
        "quais",
        "onde",
        "quando",
        "caso",
        "sobre",
        "entre",
        "apos",
        "antes",
        "anos",
        "ano",
        "dias",
        "dia",
        "meses",
        "mes",
        "horas",
        "hora",
        "minutos",
        "minuto",
        "segundos",
        "segundo",
        "grau",
        "tipo",
        "fase",
        "nivel",
        "risco",
        "dose",
        "doses",
        "sao",
        "este",
        "esta",
        "isto",
        "esses",
        "essas",
        "pelo",
        "pela",
        "pelos",
        "pelas",
        "mmhg",
        "bpm",
        "cpm",
        "mg",
        "mcg",
        "kg",
        "ml",
        "cm",
        "mm",
        "meq",
        "meql",
        "ui",
        "se",
        "ou",
        "nao",
        "sim",
        "uso",
        "via",
        "oral",
        "intravenosa",
        "intramuscular",
    }
)


def _normalize_text_for_spoiler(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text)
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", ascii_only.lower()).strip()


def _extract_core_keywords(norm_text: str) -> list[str]:
    return [
        w
        for w in norm_text.split()
        if len(w) > 3 and w not in MEDICAL_UNITS_AND_STOPWORDS
    ]


def detect_parenthesis_spoiler(note: dict[str, Any]) -> str | None:
    """Detecta se o contexto entre parênteses no enunciado antecipa ou entrega a resposta do card."""
    card_type = str(note.get("type") or "").strip().lower()
    q = str(note.get("question") or "")
    a = str(note.get("answer") or "")

    if card_type == "basic":
        ans_norm = _normalize_text_for_spoiler(a)
        if not ans_norm:
            return None
        ans_keywords = _extract_core_keywords(ans_norm)
        if not ans_keywords and len(ans_norm) < 4:
            return None

        for match in re.finditer(r"\(([^)]+)\)", q):
            p_text = match.group(1).strip()
            p_norm = _normalize_text_for_spoiler(p_text)
            if not p_norm:
                continue
            if ans_norm == p_norm or (len(ans_norm) > 4 and ans_norm in p_norm):
                return f"texto entre parênteses '({p_text})' entrega a resposta '{a.strip()}'"
            if len(ans_keywords) >= 1:
                p_words = set(p_norm.split())
                if all(kw in p_words for kw in ans_keywords):
                    return f"palavras-chave entre parênteses '({p_text})' entregam a resposta '{a.strip()}'"

    elif card_type == "cloze":
        cloze_spans = list(CLOZE.finditer(q))
        q_masked = CLOZE.sub(" __CLOZE__ ", q)
        parens_outside = list(re.finditer(r"\(([^)]+)\)", q_masked))

        for c_match in cloze_spans:
            target = c_match.group(2).split("::")[0].strip()
            target_norm = _normalize_text_for_spoiler(target)
            if not target_norm:
                continue
            target_keywords = _extract_core_keywords(target_norm)

            for p_match in parens_outside:
                p_text = p_match.group(1).strip()
                p_norm = _normalize_text_for_spoiler(p_text)
                if not p_norm:
                    continue
                if target_norm == p_norm or (len(target_norm) > 4 and target_norm in p_norm):
                    return f"texto entre parênteses '({p_text})' no enunciado entrega a lacuna '{{{{c1::{target}}}}}'"
                if len(target_keywords) >= 1:
                    p_words = set(p_norm.split())
                    if all(kw in p_words for kw in target_keywords):
                        return f"palavras-chave entre parênteses '({p_text})' no enunciado entregam a lacuna '{{{{c1::{target}}}}}'"

    return None


SYNONYM_SPOILERS: dict[str, set[str]] = {
    "adrenalina": {"epinefrina"},
    "epinefrina": {"adrenalina"},
    "noradrenalina": {"norepinefrina"},
    "norepinefrina": {"noradrenalina"},
    "vasopressina": {"adh"},
}


def detect_topic_spoiler(note: dict[str, Any]) -> str | None:
    """Detecta se o cabeçalho 'topic' entrega a resposta do card basic ou a lacuna cloze."""
    topic_norm = _normalize_text_for_spoiler(str(note.get("topic") or ""))
    if not topic_norm:
        return None
    topic_words = set(_extract_core_keywords(topic_norm))
    expanded_topic_words = set(topic_words)
    for w in topic_words:
        expanded_topic_words |= SYNONYM_SPOILERS.get(w, set())

    ntype = str(note.get("type") or "").strip().lower()
    if ntype == "cloze":
        q = str(note.get("question") or "")
        for _, raw_target in CLOZE.findall(q):
            target = raw_target.split("::")[0].strip()
            target_kws = _extract_core_keywords(_normalize_text_for_spoiler(target))
            if target_kws:
                match_count = sum(1 for kw in target_kws if kw in expanded_topic_words)
                if match_count == len(target_kws) or (
                    len(target_kws) >= 2 and match_count / len(target_kws) >= 0.65
                ):
                    return f"o topic '{note.get('topic')}' entrega a lacuna '{{{{c1::{target}}}}}'"
    elif ntype == "basic":
        ans = str(note.get("answer") or "")
        ans_kws = _extract_core_keywords(_normalize_text_for_spoiler(ans))
        if ans_kws:
            match_count = sum(1 for kw in ans_kws if kw in expanded_topic_words)
            if 1 <= len(ans_kws) <= 4 and (
                match_count == len(ans_kws)
                or (len(ans_kws) >= 2 and match_count / len(ans_kws) >= 0.65)
            ):
                return f"o topic '{note.get('topic')}' entrega a resposta '{ans.strip()}'"
    return None


# ---------------------------------------------------------------------------
# HTML seguro (subconjunto suportado pelos modelos)
# ---------------------------------------------------------------------------


class _HtmlChecker(HTMLParser):
    TAGS = {
        "b",
        "strong",
        "i",
        "em",
        "br",
        "img",
        "figcaption",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "audio",
        "source",
    }
    VOID = {"br", "img", "source"}
    ATTRS = {
        "img": {"src", "alt"},
        "table": {"class"},
        "th": {"colspan", "rowspan"},
        "td": {"colspan", "rowspan"},
        "audio": {"controls", "preload", "class"},
        "source": {"src", "type"},
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.problems: list[str] = []
        self.stack: list[str] = []
        self.media: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in self.TAGS:
            self.problems.append(f"tag não permitida <{tag}>")
            return
        if tag not in self.VOID:
            self.stack.append(tag)
        for name, value in attrs:
            if name not in self.ATTRS.get(tag, set()):
                self.problems.append(f"atributo não permitido em <{tag}>: {name}")
            if name == "src":
                src = (value or "").strip()
                if (
                    not src
                    or re.match(r"^([a-z][a-z0-9+.-]*:|//)", src, re.I)
                    or "/" in src
                    or "\\" in src
                ):
                    self.problems.append(
                        f"src inválido (use só o nome do arquivo local): {src!r}"
                    )
                else:
                    self.media.append(src)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID and self.stack and self.stack[-1] == tag:
            self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        if tag in self.VOID or tag not in self.TAGS:
            return
        if not self.stack or self.stack[-1] != tag:
            self.problems.append(f"fechamento </{tag}> fora de ordem")
            if tag in self.stack:
                while self.stack.pop() != tag:
                    pass
            return
        self.stack.pop()


def check_html(text: str) -> tuple[list[str], list[str]]:
    """Retorna (problemas, arquivos de mídia referenciados)."""
    parser = _HtmlChecker()
    parser.feed(text or "")
    parser.close()
    if parser.stack:
        parser.problems.append("tag(s) não fechada(s): " + ", ".join(parser.stack))
    sounds = re.findall(r"\[sound:([^\]]+)\]", text or "")
    return parser.problems, parser.media + [s.strip() for s in sounds]


def _resolve_source_file(
    file_str: str, media_dir: Path, sources_dir: Path | None
) -> Path | None:
    rel = Path(file_str)
    if rel.is_absolute() or ".." in rel.parts:
        return None
    roots = [r for r in (sources_dir, SOURCES_ROOT, ROOT, media_dir) if r is not None]
    for base in roots:
        candidate = base / rel
        if candidate.is_file():
            return candidate
    return None


@dataclass(frozen=True)
class MedQuestQuestion:
    id: int
    year: int | None
    institution_code: str
    institution_label: str


def _load_medquest_questions(db_path: Path) -> dict[int, MedQuestQuestion] | None:
    if not db_path.is_file():
        return None
    try:
        with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as con:
            res: dict[int, MedQuestQuestion] = {}
            for row in con.execute(
                "SELECT id, year, institution_code, institution_label FROM questions"
            ):
                qid = int(row[0])
                year = (
                    int(row[1])
                    if row[1] is not None and str(row[1]).isdigit()
                    else None
                )
                code = str(row[2] or "").strip()
                label = str(row[3] or "").strip()
                res[qid] = MedQuestQuestion(
                    id=qid, year=year, institution_code=code, institution_label=label
                )
            return res
    except sqlite3.Error:
        return None


# ---------------------------------------------------------------------------
# Regras
# ---------------------------------------------------------------------------


def lint_deck(
    notes: object,
    media_dir: Path,
    sources_dir: Path | None = None,
    *,
    structural: bool = False,
) -> tuple[list[Issue], set[str]]:
    """Valida todas as notas de um deck. Retorna (problemas, mídias referenciadas)."""
    issues: list[Issue] = []
    media: set[str] = set()
    if not isinstance(notes, list):
        return [
            Issue("erro", "json", None, "a raiz do JSON deve ser uma lista de notas")
        ], media

    on_disk = (
        {p.name for p in media_dir.iterdir() if p.is_file()}
        if media_dir.is_dir()
        else set()
    )
    on_disk_lower = {n.casefold(): n for n in on_disk}
    seen_ids: set[int] = set()
    seen_questions: dict[str, object] = {}
    pdf_pages_cache: dict[Path, int] = {}
    medquest_questions: dict[int, MedQuestQuestion] | None = None
    medquest_loaded = False

    for pos, note in enumerate(notes, 1):
        if not isinstance(note, dict):
            issues.append(Issue("erro", "json", f"#{pos}", "nota não é um objeto JSON"))
            continue
        raw_id = note.get("id")
        valid_id = (
            isinstance(raw_id, int) and not isinstance(raw_id, bool) and raw_id > 0
        )
        nid: object = raw_id if valid_id else f"#{pos}"

        def add(sev: str, rule: str, msg: str, _nid: object = nid) -> None:
            issues.append(Issue(sev, rule, _nid, msg))

        # Estrutura e tipos estritos
        unknown = sorted(set(note) - ALLOWED_FIELDS)
        if unknown:
            add(
                "erro",
                "campo-desconhecido",
                f"campos não reconhecidos: {', '.join(unknown)}",
            )
        if not valid_id:
            add(
                "erro",
                "id",
                "id deve ser inteiro positivo (é ele que mantém o histórico no Anki)",
            )
        elif isinstance(raw_id, int):
            if raw_id in seen_ids:
                add("erro", "id-duplicado", "id repetido no deck")
            else:
                seen_ids.add(raw_id)

        ntype = note.get("type")
        if ntype not in ("basic", "cloze"):
            add("erro", "tipo", "type deve ser 'basic' ou 'cloze'")
            continue

        fields: dict[str, str] = {}
        type_error = False
        for k in ("topic", "question", "answer", "hint"):
            val = note.get(k)
            if not isinstance(val, str):
                add("erro", "tipo-campo", f"'{k}' deve ser texto (str)")
                fields[k] = ""
                type_error = True
            else:
                fields[k] = val

        for k in ("topic", "question", "hint"):
            if isinstance(note.get(k), str) and not fields[k].strip():
                add("erro", "campo-vazio", f"'{k}' está vazio")

        raw_tags = note.get("tags", [])
        if not isinstance(raw_tags, list) or any(
            not isinstance(t, str) or not t.strip() for t in raw_tags
        ):
            add("erro", "tags", "tags deve ser uma lista de strings não vazias")

        # Fontes e referências de prova
        srcs = note.get("sources")
        if srcs is not None:
            if not isinstance(srcs, list) or not srcs:
                add(
                    "erro",
                    "sources",
                    "sources deve ser uma lista não vazia de referências",
                )
            else:
                for s in srcs:
                    if not isinstance(s, dict):
                        add(
                            "erro",
                            "sources",
                            "cada item em sources deve ser um objeto JSON",
                        )
                        continue
                    raw_file = s.get("file")
                    raw_page = s.get("page")
                    if not isinstance(raw_file, str) or not raw_file.strip():
                        add(
                            "erro",
                            "sources",
                            "cada item em sources deve ter 'file' (string não vazia)",
                        )
                        continue
                    if (
                        not isinstance(raw_page, int)
                        or isinstance(raw_page, bool)
                        or raw_page < 1
                    ):
                        add(
                            "erro",
                            "sources",
                            f"fonte '{raw_file}' precisa de 'page' inteiro >= 1",
                        )
                        continue
                    resolved = _resolve_source_file(
                        raw_file.strip(), media_dir, sources_dir
                    )
                    if resolved is None:
                        if not structural:
                            add(
                                "erro",
                                "sources",
                                f"arquivo de fonte não encontrado: {raw_file}",
                            )
                    elif resolved.suffix.lower() == ".pdf":
                        if resolved not in pdf_pages_cache:
                            with pymupdf.open(resolved) as doc:
                                pdf_pages_cache[resolved] = doc.page_count
                        max_p = pdf_pages_cache[resolved]
                        if raw_page > max_p:
                            add(
                                "erro",
                                "sources",
                                f"página {raw_page} fora do limite do PDF (1..{max_p}): {raw_file}",
                            )
        else:
            add("aviso", "sem-fonte", "nota sem campo 'sources' de proveniência")

        ex_refs = note.get("exam_refs")
        if ex_refs is not None:
            if not isinstance(ex_refs, list):
                add("erro", "exam-refs", "exam_refs deve ser uma lista")
            else:
                for ex in ex_refs:
                    if not isinstance(ex, dict):
                        add(
                            "erro",
                            "exam-refs",
                            "cada item em exam_refs deve ser um objeto JSON",
                        )
                        continue
                    inst = ex.get("institution")
                    year = ex.get("year")
                    qid = ex.get("question_id")
                    if not isinstance(inst, str) or not inst.strip():
                        add(
                            "erro",
                            "exam-refs",
                            "cada item em exam_refs deve conter 'institution' (string não vazia)",
                        )
                        continue
                    if (
                        not isinstance(year, int)
                        or isinstance(year, bool)
                        or not (1980 <= year <= 2100)
                    ):
                        add(
                            "erro",
                            "exam-refs",
                            "cada item em exam_refs deve conter 'year' inteiro válido",
                        )
                        continue
                    if not isinstance(qid, int) or isinstance(qid, bool) or qid <= 0:
                        add(
                            "erro",
                            "exam-refs",
                            "cada item em exam_refs deve conter 'question_id' inteiro positivo",
                        )
                        continue
                    if ex.get("source", "medquest") == "medquest":
                        if not medquest_loaded:
                            medquest_questions = _load_medquest_questions(MEDQUEST_DB)
                            medquest_loaded = True
                        if medquest_questions is None:
                            add(
                                "aviso",
                                "medquest-indisponivel",
                                f"banco MedQuest ({MEDQUEST_DB}) indisponível; questão {qid} ({inst}, {year}) não pôde ser conferida",
                            )
                        elif qid not in medquest_questions:
                            add(
                                "erro",
                                "exam-refs",
                                f"question_id {qid} não encontrado no banco MedQuest",
                            )
                        else:
                            q_meta = medquest_questions[qid]
                            if q_meta.year is not None and year != q_meta.year:
                                add(
                                    "erro",
                                    "exam-refs",
                                    f"ano {year} divergente do banco MedQuest para questão {qid} (esperado: {q_meta.year})",
                                )
                            norm_inst = inst.casefold()
                            code_match = norm_inst == q_meta.institution_code.casefold()
                            label_match = (
                                norm_inst == q_meta.institution_label.casefold()
                                or norm_inst in q_meta.institution_label.casefold()
                            )
                            if not (code_match or label_match):
                                add(
                                    "erro",
                                    "exam-refs",
                                    f"instituição '{inst}' não confere com questão {qid} no MedQuest ('{q_meta.institution_code}' - '{q_meta.institution_label}')",
                                )

        if "Banca Examinadora:" in fields["hint"] and not ex_refs:
            add(
                "erro",
                "falsa-banca",
                "menção a 'Banca Examinadora:' no hint sem referência real em exam_refs",
            )

        if type_error:
            continue

        # HTML e mídias
        audio_count = 0
        for k, text in fields.items():
            problems, refs = check_html(text)
            for p in problems:
                add("erro", "html", f"{k}: {p}")
            if "[BUSCAR IMAGEM" in text.upper():
                add(
                    "erro",
                    "buscar-imagem",
                    "o agente deve inserir a imagem real, não '[BUSCAR IMAGEM]'",
                )
            if k == "topic" and refs:
                add("erro", "midia-no-topic", "topic não pode ter imagem ou áudio")
            for ref in refs:
                ext = Path(ref).suffix.lower()
                audio_count += ext in AUDIO_EXT
                if ext not in IMAGE_EXT | AUDIO_EXT:
                    add("erro", "midia-formato", f"formato não suportado: {ref}")
                elif ref not in on_disk:
                    if not structural:
                        hint_msg = (
                            f" (no disco está '{on_disk_lower[ref.casefold()]}')"
                            if ref.casefold() in on_disk_lower
                            else ""
                        )
                        add(
                            "erro",
                            "midia-ausente",
                            f"arquivo não encontrado em {media_dir.name}/: {ref}{hint_msg}",
                        )
                    else:
                        media.add(ref)
                else:
                    media.add(ref)
        if audio_count > 1:
            add("erro", "audio", f"{audio_count} áudios no card (máximo 1)")

        q, a, hint = fields["question"], fields["answer"], fields["hint"]

        # Proibição estrita de sintaxe LaTeX / MathJax não renderizada (ex.: $\beta$, \ge, \le)
        for fld_name, fld_val in [("question", q), ("hint", hint), ("topic", fields["topic"]), ("answer", a)]:
            if "$" in fld_val or re.search(r"\\[a-zA-Z(\[]", fld_val):
                add(
                    "erro",
                    "latex-proibido",
                    f"campo '{fld_name}' contém sintaxe LaTeX/MathJax não renderizada ('$' ou comando com '\\'). Use caracteres Unicode diretos (ex.: β, ≥, ≤, α).",
                )
        # Lacunas em posições diferentes testam respostas diferentes.
        key = (
            visible_text(CLOZE.sub(r" [lacuna] ", q))
            if ntype == "cloze" else visible_text(q)
        ).casefold()
        if ntype == "cloze":
            key += "|" + "|".join(
                visible_text(target.split("::")[0]).casefold() for _, target in CLOZE.findall(q)
            )
        if note.get("image_mode") == "recognition":
            key += "|" + "|".join(sorted(check_html(q)[1]))
        if key in seen_questions:
            add(
                "erro",
                "pergunta-duplicada",
                f"mesma pergunta da nota {seen_questions[key]}",
            )
        seen_questions[key] = nid

        # Cloze / Q&A
        if ntype == "cloze":
            spans = CLOZE.findall(q)
            if (
                not spans
                or len(spans) != q.count("{{c")
                or re.search(r"\{\{C\d|\{\{c0", q)
            ):
                add(
                    "erro",
                    "cloze",
                    "marcação cloze ausente ou malformada (use {{c1::termo}})",
                )
            ords = sorted({int(o) for o, _ in spans})
            if ords and ords != list(range(1, ords[-1] + 1)):
                add("erro", "cloze", f"numeração cloze com salto: {ords}")
            if any(o > 1 for o in ords):
                add(
                    "aviso",
                    "so-c1",
                    "use apenas c1; conceitos independentes viram cards separados",
                )
            if len(spans) > 1:
                add(
                    "aviso",
                    "multiplos-clozes",
                    f"{len(spans)} lacunas na mesma nota; use estritamente 1 '{{{{c1::...}}}}' por nota",
                )
            for _, target in spans:
                words = len(visible_text(target.split("::")[0]).split())
                if words == 0:
                    add("erro", "cloze", "lacuna vazia")
                elif words > MAX_CLOZE_WORDS:
                    add(
                        "aviso",
                        "lacuna-longa",
                        f"lacuna com {words} palavras (máx. {MAX_CLOZE_WORDS})",
                    )
                clean_target = visible_text(target.split("::")[0]).split()
                if len(clean_target) >= 3 and clean_target[-1].lower() in {
                    "de", "da", "do", "para", "com", "em", "por", "a", "o", "e", "ou", "no", "na"
                }:
                    add(
                        "erro",
                        "cloze-truncado",
                        f"lacuna cloze termina com partícula truncada ('{clean_target[-1]}'); reformule o termo",
                    )
                if "::" in target:
                    dica = target.split("::", 1)[1].strip().lower()
                    prohibited_cloze_hints = {
                        "fármaco",
                        "farmaco",
                        "droga",
                        "conduta",
                        "classe",
                        "substância",
                        "substancia",
                        "momento",
                        "tempo",
                        "dose",
                        "quantidade",
                        "número",
                        "numero",
                        "derivações",
                        "derivacoes",
                        "valor",
                        "valores",
                        "critério",
                        "criterio",
                    }
                    if any(w in dica for w in prohibited_cloze_hints):
                        add(
                            "aviso",
                            "dica-cloze-proibida",
                            f"dica '::{dica}' proibida dentro do cloze; o enunciado deve dar o contexto",
                        )
            if a.strip():
                add(
                    "aviso",
                    "answer-em-cloze",
                    "em cloze o campo answer deve ficar vazio",
                )
        else:
            vis_a = visible_text(a)
            if not a.strip():
                add("erro", "answer-vazio", "card basic precisa de answer")
            elif not vis_a.endswith("."):
                add("aviso", "answer-ponto", "answer deve terminar com ponto final")
            if "Resposta:" in a:
                add("aviso", "answer-ponto", "não escreva 'Resposta:' no answer")

            a_words = len(vis_a.split())
            if a_words > MAX_BASIC_ANSWER_WORDS or len(vis_a) > MAX_BASIC_ANSWER_CHARS:
                add(
                    "aviso",
                    "answer-longo",
                    f"answer com {a_words} palavras / {len(vis_a)} chars (Princípio da Informação Mínima: máx. {MAX_BASIC_ANSWER_WORDS} palavras / {MAX_BASIC_ANSWER_CHARS} chars)",
                )

            vis_q = visible_text(q)
            if any(pat.search(vis_q) for pat in COMPOUND_QUESTION_PATTERNS) or ";" in vis_a:
                add(
                    "aviso",
                    "pergunta-composta",
                    "card basic faz mais de uma pergunta ou tem resposta composta por ';'; aplique o Duplo Salto Implícito pedindo apenas 1 alvo atômico",
                )

            if re.search(
                r"\bqual\s+(?:é\s+)?a\s+conduta\s*\?\s*$", vis_q, flags=re.IGNORECASE
            ):
                add(
                    "aviso",
                    "conduta-sem-janela-temporal",
                    "especifique a janela temporal ('Qual a conduta imediata de admissão?' ou 'Qual a conduta definitiva?')",
                )

        if note.get("image_mode") == "recognition":
            if ntype != "basic" or "<img" not in q:
                add(
                    "erro",
                    "recognition",
                    "image_mode recognition exige type basic com <img> na pergunta",
                )
            if "<i>" not in hint:
                add(
                    "aviso",
                    "recognition-sem-legenda-no-hint",
                    "cards recognition devem trazer <i>Descrição do achado visual...</i> no início do hint",
                )
        elif note.get("image_mode") not in (None, "feedback"):
            add("erro", "image-mode", "image_mode deve ser 'feedback' ou 'recognition'")

        # 1. Proibição de Categorias de Risco Gestacional Antigas da FDA (A, B, C, D, X)
        if re.search(r"\bcategoria\s+[ABCDX]\b", f"{q} {a} {hint}", flags=re.IGNORECASE):
            add(
                "aviso",
                "fda-categoria-obsoleta",
                "evite categorias em letras da FDA (A/B/C/D/X); descreva o risco teratogênico específico (PLLR)",
            )

        # Spoiler de resposta entre parênteses
        spoiler_detail = detect_parenthesis_spoiler(note)
        if spoiler_detail:
            add(
                "aviso",
                "spoiler-parenteses",
                f"contexto entre parênteses entrega a resposta: {spoiler_detail}",
            )

        topic_spoiler = detect_topic_spoiler(note)
        if topic_spoiler:
            add(
                "aviso",
                "spoiler-topic",
                f"cabeçalho topic entrega a resposta: {topic_spoiler}",
            )


        # Estilo do verso (skill)
        if "Comentário:" not in hint:
            add("aviso", "comentario", "hint deve conter '<b>Comentário:</b>'")
        if "Preceptoria" in hint or "Armadilha" in hint:
            add(
                "aviso",
                "muro-de-texto",
                "remova os blocos Preceptoria/Armadilha; use só o Comentário curto",
            )
        comment = re.sub(
            r"<table.*?</table>",
            " ",
            hint.split("Comentário:", 1)[-1],
            flags=re.S | re.I,
        )
        size = len(visible_text(comment))
        if size > MAX_COMMENT_CHARS:
            add(
                "aviso",
                "comentario-longo",
                f"comentário com {size} caracteres (alvo: 1–2 frases, ≤ {MAX_COMMENT_CHARS})",
            )
        if "<img" in hint and "<i>" not in hint:
            add("aviso", "legenda", "imagem no hint sem legenda em <i>...</i>")

        q_imgs = {
            Path(m).name.lower()
            for m in check_html(q)[1]
            if Path(m).suffix.lower() in IMAGE_EXT
        }
        h_imgs = {
            Path(m).name.lower()
            for m in check_html(hint)[1]
            if Path(m).suffix.lower() in IMAGE_EXT
        }
        dups = q_imgs & h_imgs
        if dups:
            add(
                "aviso",
                "imagem-duplicada-frente-verso",
                f"mesma imagem presente na pergunta e no verso ({', '.join(sorted(dups))}); no verso de cards recognition, use apenas legenda descritiva em <i>...</i>",
            )

        topic = visible_text(fields["topic"])
        if topic and (topic.isupper() or " - " not in topic):
            add("aviso", "topic", "topic no formato 'Tema - Subtema', sem caixa alta")

        # Verificação de tópico duplicado no início da pergunta
        if topic:
            m_prefix = re.match(r"^\s*(?:\*\*|<b>)(.*?)(?:\*\*|</b>)[:\.]?\s*", q, re.DOTALL)
            if m_prefix:
                pfx = visible_text(m_prefix.group(1)).strip().lower()
                top_clean = topic.lower()
                subtop = topic.split(" - ")[-1].strip().lower() if " - " in topic else top_clean
                if (
                    pfx == top_clean
                    or pfx == subtop
                    or (len(pfx) > 5 and (pfx in top_clean or top_clean in pfx or pfx in subtop or subtop in pfx))
                ):
                    add(
                        "erro",
                        "topic-duplicado-na-pergunta",
                        f"a pergunta inicia repetindo o tópico '{m_prefix.group(1)}' em negrito (o tópico já é exibido no topo do card)",
                    )

    return issues, media
