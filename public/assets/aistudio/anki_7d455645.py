"""Modelos do Anki, montagem do .apkg, registro de GUIDs e sincronização via AnkiConnect.

Os IDs, nomes, campos, templates e CSS dos modelos abaixo NÃO devem mudar:
qualquer alteração faz o Anki tratar as notas como de outro tipo e pode
quebrar o histórico de revisões (FSRS).
"""

from __future__ import annotations

import hashlib
import html
import json
import logging
import os
import re
import shutil
import tempfile
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore[assignment]

try:
    import msvcrt
except ImportError:
    msvcrt = None  # type: ignore[assignment]

import genanki

logger = logging.getLogger(__name__)

CLOZE_MODEL_ID = 1738331521911
CLOZE_MODEL_NAME = "Med_Cloze_Inverted_v2"
BASIC_MODEL_ID = 1738331521912
BASIC_MODEL_NAME = "Med_Basic_Inverted_v2"
GUID_SALT = "criador-de-cards"

CSS = """
.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 18.5px;
  line-height: 1.58;
  text-align: left;
  color: #1e293b;
  background-color: #f8fafc;
  padding: 24px;
}
.med-card { max-width: 740px; margin: 0 auto; }
.topic-box {
  display: inline-block; background-color: #f1f5f9; color: #0369a1;
  padding: 4px 10px; border-radius: 4px; font-size: 13.5px;
  font-weight: 700; margin-bottom: 12px; border: 1px solid #cbd5e1;
  text-transform: uppercase; letter-spacing: 0.5px;
}
b, strong { color: #0284c7; font-weight: 700; }
.cloze { font-weight: 700; color: #0284c7; border-bottom: 2px solid #38bdf8; padding: 0 2px; }
.front-content { font-size: 19.5px; color: #0f172a; line-height: 1.58; }
.back-content { font-size: 18.5px; color: #0f172a; line-height: 1.58; margin-top: 10px; }
.main-answer { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
.extra-box {
  margin-top: 16px; padding: 14px 18px; background: #f1f5f9;
  border-radius: 8px; border-left: 4px solid #0284c7;
  font-size: 16px; color: #334155; line-height: 1.52;
}
hr, hr#answer, hr.med-divider { border: 0; height: 1px; background: #cbd5e1; margin: 20px 0; }
img {
  max-width: 100%; max-height: 65vh; height: auto; border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12); margin: 14px auto 0;
  background: #ffffff; padding: 4px; display: block; object-fit: contain;
}
table.med-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 15px; }
table.med-table th, table.med-table td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
table.med-table th { background-color: #e0f2fe; color: #0369a1; font-weight: 700; }
.badge-beira-leito { display: block; margin: 12px 0 8px; padding: 8px 12px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 6px; color: #991b1b; font-size: 14.5px; font-weight: 600; line-height: 1.4; }
.badge-alvo-banca { display: block; margin: 8px 0 12px; padding: 8px 12px; background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 6px; color: #92400e; font-size: 14.5px; font-weight: 600; line-height: 1.4; }
.nightMode.card, .night_mode.card, body.nightMode, body.night_mode { background-color: #18181b !important; color: #f4f4f5 !important; }
.nightMode .topic-box, .night_mode .topic-box { background-color: #27272a !important; color: #7dd3fc !important; border-color: #3f3f46 !important; }
.nightMode .front-content, .nightMode .back-content, .night_mode .front-content, .night_mode .back-content, .nightMode .cloze-text, .night_mode .cloze-text { color: #f4f4f5 !important; }
.nightMode .main-answer, .night_mode .main-answer { color: #f4f4f5 !important; }
.nightMode b, .nightMode strong, .night_mode b, .night_mode strong { color: #38bdf8 !important; }
.nightMode .cloze, .night_mode .cloze { color: #38bdf8 !important; border-bottom: 2px solid #0ea5e9 !important; }
.nightMode .extra-box, .night_mode .extra-box { background: #27272a !important; border-left: 4px solid #38bdf8 !important; color: #e4e4e7 !important; }
.nightMode .badge-beira-leito, .night_mode .badge-beira-leito { background: #450a0a !important; border-left-color: #f87171 !important; color: #fecaca !important; }
.nightMode .badge-alvo-banca, .night_mode .badge-alvo-banca { background: #451a03 !important; border-left-color: #fbbf24 !important; color: #fef3c7 !important; }
.nightMode hr, .night_mode hr, .nightMode hr#answer, .night_mode hr#answer, .nightMode hr.med-divider, .night_mode hr.med-divider { background: #3f3f46 !important; }
.nightMode img, .night_mode img { background: #ffffff !important; border: 1px solid #3f3f46; }
.nightMode table.med-table th, .night_mode table.med-table th { background-color: #0c4a6e !important; color: #e0f2fe !important; border-color: #3f3f46 !important; }
.nightMode table.med-table td, .night_mode table.med-table td { border-color: #3f3f46 !important; color: #f4f4f5 !important; }
@media (max-width: 600px) {
  .card { padding: 14px; font-size: 16.5px; }
  .med-card { max-width: 100%; }
  .front-content { font-size: 17.5px; }
  .back-content { font-size: 16.5px; }
  .main-answer { font-size: 18px; }
  .extra-box { padding: 10px 14px; font-size: 15px; }
  img { max-height: 55vh; margin-top: 10px; }
}
"""

_FIELDS = [
    {"name": "Question"},
    {"name": "Topic"},
    {"name": "Answer"},
    {"name": "Hint"},
]

CLOZE_MODEL = genanki.Model(
    CLOZE_MODEL_ID,
    CLOZE_MODEL_NAME,
    fields=_FIELDS,
    templates=[
        {
            "name": "Cloze",
            "qfmt": '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div></div>',
            "afmt": '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div>{{#Hint}}<hr id="answer" class="med-divider"><div class="extra-box">{{Hint}}</div>{{/Hint}}</div><script>(document.querySelector(".cloze") || document.getElementById("answer"))?.scrollIntoView({behavior: "smooth", block: "center"});</script>',
        }
    ],
    css=CSS,
    model_type=genanki.Model.CLOZE,
)

BASIC_MODEL = genanki.Model(
    BASIC_MODEL_ID,
    BASIC_MODEL_NAME,
    fields=_FIELDS,
    templates=[
        {
            "name": "Basic",
            "qfmt": '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div></div>',
            "afmt": '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div><hr id="answer" class="med-divider"><div class="back-content"><div class="main-answer"><b>{{Answer}}</b></div>{{#Hint}}<div class="extra-box">{{Hint}}</div>{{/Hint}}</div></div><script>document.getElementById("answer")?.scrollIntoView({behavior: "smooth", block: "nearest"});</script>',
        }
    ],
    css=CSS,
)

# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

_ALLOWED_TAG = re.compile(
    r"(</?(?:b|strong|i|em|br|img|figcaption|table|thead|tbody|tr|th|td|audio|source)(?:\s+[^<>]*)?/?>)",
    re.IGNORECASE,
)


def sanitize_html(text: str) -> str:
    """Escapa '<' e '>' soltos (ex.: 'PA > 140') preservando as tags permitidas."""
    if not isinstance(text, str):
        raise TypeError(
            f"Esperado str para sanitização HTML, recebeu {type(text).__name__}"
        )
    if not text:
        return text
    parts = _ALLOWED_TAG.split(text)
    return "".join(
        p if i % 2 else p.replace("<", "&lt;").replace(">", "&gt;")
        for i, p in enumerate(parts)
    )


def tags_for(note: dict[str, Any], deck_key: str) -> list[str]:
    extra = [
        str(t).strip()
        for t in note.get("tags", [])
        if str(t).strip() and str(t).strip() != deck_key
    ]
    return [deck_key] + list(dict.fromkeys(t for t in extra if not re.search(r"\s", t)))


# ---------------------------------------------------------------------------
# Registro de GUIDs (preserva o histórico de revisões no Anki)
# ---------------------------------------------------------------------------


@contextmanager
def _registry_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_file = path.with_suffix(".lock")
    with open(lock_file, "a+", encoding="utf-8") as f:
        if fcntl is not None:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        elif msvcrt is not None:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)  # type: ignore[attr-defined]
        else:
            raise RuntimeError(
                "Plataforma sem suporte a trava de arquivo (fcntl/msvcrt)"
            )
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            elif msvcrt is not None:
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)  # type: ignore[attr-defined]


class GuidRegistry:
    """Mapa persistente `<deck>:id:<id>` -> GUID do Anki. Nunca reatribui uma chave existente."""

    def __init__(self, path: Path) -> None:
        self.path = path
        raw: dict[str, Any] = (
            json.loads(path.read_text(encoding="utf-8"))
            if path.is_file()
            else {"version": 1, "entries": {}}
        )
        self.data = raw
        entries = self.data.setdefault("entries", {})
        self.entries: dict[str, str] = (
            {str(k): str(v) for k, v in entries.items()}
            if isinstance(entries, dict)
            else {}
        )
        self.data["entries"] = self.entries
        self._used: set[str] = set(self.entries.values())
        self._pending: dict[str, str] = {}

    def guid_for(self, deck_key: str, deck_id: int, note_id: int) -> str:
        if not isinstance(note_id, int) or isinstance(note_id, bool) or note_id <= 0:
            raise ValueError(f"note_id inválido para GUID: {note_id!r}")
        key = f"{deck_key}:id:{note_id}"
        if key in self.entries:
            return self.entries[key]
        guid = str(genanki.guid_for(GUID_SALT, deck_id, key))
        attempt = 0
        while guid in self._used:
            attempt += 1
            guid = str(genanki.guid_for(GUID_SALT, deck_id, key, str(attempt)))
        self.entries[key] = guid
        self._pending[key] = guid
        self._used.add(guid)
        return guid

    def reassign_note_id(self, deck_key: str, old_id: int, new_id: int) -> None:
        """Reatribui o GUID de um ID antigo para um novo ID canônico preservando histórico."""
        old_key = f"{deck_key}:id:{old_id}"
        new_key = f"{deck_key}:id:{new_id}"
        if old_key in self.entries:
            guid = self.entries.pop(old_key)
            self.entries[new_key] = guid
            self._pending[new_key] = guid
            if old_key in self._pending:
                del self._pending[old_key]

    def save(self) -> None:
        if not self._pending:
            return
        with _registry_lock(self.path):
            raw: dict[str, Any] = (
                json.loads(self.path.read_text(encoding="utf-8"))
                if self.path.is_file()
                else {"version": 1, "entries": {}}
            )
            raw_entries = raw.setdefault("entries", {})
            disk_entries: dict[str, str] = (
                {str(k): str(v) for k, v in raw_entries.items()}
                if isinstance(raw_entries, dict)
                else {}
            )
            raw["entries"] = disk_entries
            disk_used = set(disk_entries.values())
            for k, g in self._pending.items():
                if k in disk_entries and disk_entries[k] != g:
                    raise ValueError(
                        f"Conflito concorrente para {k}: já registrado com outro GUID."
                    )
                if k not in disk_entries and g in disk_used:
                    raise ValueError(f"Colisão concorrente de GUID ao salvar {k}.")
                disk_entries[k] = g
                disk_used.add(g)
            atomic_write(
                self.path,
                (json.dumps(raw, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
            )
            self.data = raw
            self.entries = disk_entries
            self._used = disk_used
            self._pending.clear()


# ---------------------------------------------------------------------------
# Pacote
# ---------------------------------------------------------------------------


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.stem}-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def write_package(
    deck_key: str,
    deck_id: int,
    deck_name: str,
    notes: list[dict[str, Any]],
    registry: GuidRegistry,
    media_dir: Path,
    media: set[str],
    output: Path,
) -> None:
    prev_entries = dict(registry.entries)
    prev_used = set(registry._used)
    prev_pending = dict(registry._pending)
    registry_disk_backup = (
        registry.path.read_bytes() if registry.path.is_file() else None
    )

    deck = genanki.Deck(deck_id, deck_name)
    try:
        for note in notes:
            fields: list[str] = []
            for name in ("question", "topic", "answer", "hint"):
                val = note.get(name)
                if not isinstance(val, str):
                    raise TypeError(
                        f"Campo '{name}' na nota {note.get('id')!r} deve ser str, recebeu {type(val).__name__}"
                    )
                fields.append(sanitize_html(val))
            ntype = note.get("type")
            if ntype not in ("cloze", "basic"):
                raise ValueError(f"Tipo inválido na nota {note.get('id')!r}: {ntype!r}")
            model = CLOZE_MODEL if ntype == "cloze" else BASIC_MODEL
            guid = registry.guid_for(deck_key, deck_id, note["id"])
            deck.add_note(
                genanki.Note(
                    model=model, fields=fields, tags=tags_for(note, deck_key), guid=guid
                )
            )

        package = genanki.Package(deck)
        package.media_files = [str(media_dir / name) for name in sorted(media)]
        output.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(
            prefix=f".{output.stem}-", suffix=".apkg", dir=output.parent
        )
        os.close(fd)
        try:
            package.write_to_file(tmp)
            # Persiste o registro de GUIDs antes de publicar o .apkg final
            registry.save()
            try:
                os.replace(tmp, output)
            except Exception:
                # Transação completa: se a publicação do .apkg falhar após o save do registro, restaura o disco
                if registry_disk_backup is not None:
                    atomic_write(registry.path, registry_disk_backup)
                elif registry.path.is_file():
                    registry.path.unlink(missing_ok=True)
                raise
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    except Exception:
        registry.entries = prev_entries
        registry.data["entries"] = prev_entries
        registry._used = prev_used
        registry._pending = prev_pending
        raise


# ---------------------------------------------------------------------------
# AnkiConnect
# ---------------------------------------------------------------------------

ANKI_CONNECT_URL = os.environ.get("ANKI_CONNECT_URL", "http://localhost:8765")
_FLATPAK_DIR = Path.home() / ".var/app/net.ankiweb.Anki/data/Anki2"


def anki_invoke(action: str, **params: Any) -> Any:
    body = json.dumps({"action": action, "version": 6, "params": params}).encode(
        "utf-8"
    )
    request = urllib.request.Request(
        ANKI_CONNECT_URL, body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.loads(response.read())
    if data.get("error"):
        raise RuntimeError(f"AnkiConnect {action}: {data['error']}")
    return data["result"]


def sync_media_files(
    media_dir: Path | None, media_files: set[str] | list[str] | None
) -> int:
    """Sincroniza os arquivos de mídia referenciados diretamente com o Anki."""
    if not media_files or not media_dir or not media_dir.is_dir():
        return 0
    anki_media_dir: Path | None = None
    try:
        dir_str = anki_invoke("getMediaDirPath")
        if dir_str and Path(dir_str).is_dir():
            anki_media_dir = Path(dir_str)
    except Exception:
        pass
    if anki_media_dir is None and _FLATPAK_DIR.is_dir():
        for p in _FLATPAK_DIR.iterdir():
            cand = p / "collection.media"
            if cand.is_dir():
                anki_media_dir = cand
                break

    copied = 0
    for name in media_files:
        src = media_dir / name
        if not src.is_file():
            continue
        if anki_media_dir and anki_media_dir.is_dir():
            dst = anki_media_dir / name
            if not dst.exists() or dst.stat().st_size != src.stat().st_size:
                shutil.copy2(src, dst)
                copied += 1
        else:
            try:
                import base64

                b64 = base64.b64encode(src.read_bytes()).decode("ascii")
                anki_invoke("storeMediaFile", filename=name, data=b64)
                copied += 1
            except Exception:
                pass
    return copied


def normalize_question_for_matching(text: str) -> str:
    """Normaliza o texto da pergunta para reconciliação cirúrgica de IDs existentes no Anki."""
    if not text:
        return ""
    text = html.unescape(text)
    # Remove tags HTML
    text = re.sub(r"<[^>]+>", " ", text)
    # Remove sintaxe cloze {{c1::resposta::dica}} -> resposta
    text = re.sub(r"\{\{c\d+::(.*?)(?:::.*?)?\}\}", r"\1", text)
    text = text.lower()
    text = re.sub(r"\s+", " ", text).strip()
    # Remove pontuação para evitar discrepâncias triviais de pontuação
    text = re.sub(r"[^\w\s]", "", text)
    return text[:120]


def compute_note_content_hash(fields: dict[str, str]) -> str:
    """Calcula o hash SHA256 canônico do conteúdo de uma nota (Question, Topic, Answer, Hint)."""
    canonical = (
        (fields.get("Question") or "").strip(),
        (fields.get("Topic") or "").strip(),
        (fields.get("Answer") or "").strip(),
        (fields.get("Hint") or "").strip(),
    )
    return hashlib.sha256(repr(canonical).encode("utf-8")).hexdigest()[:16]


def get_deck_notes_index(deck_name: str) -> dict[str, Any]:
    """Retorna um índice das notas existentes no baralho no Anki:
    - 'by_id': dict[noteId, info]
    - 'by_norm_q': dict[norm_question, noteId]
    - 'reviewed_nids': set[noteId]
    """
    try:
        escaped = deck_name.replace("\\", "\\\\").replace('"', '\\"')
        nids = anki_invoke("findNotes", query=f'"deck:{escaped}"') or []
        if not nids:
            return {"by_id": {}, "by_norm_q": {}, "reviewed_nids": set()}

        by_id: dict[int, dict[str, Any]] = {}
        by_norm_q: dict[str, int] = {}

        for i in range(0, len(nids), 100):
            batch = nids[i : i + 100]
            infos = anki_invoke("notesInfo", notes=batch)
            for info in infos:
                if isinstance(info, dict) and "noteId" in info:
                    nid = info["noteId"]
                    by_id[nid] = info
                    q_val = info.get("fields", {}).get("Question", {}).get("value", "")
                    norm_q = normalize_question_for_matching(q_val)
                    if norm_q and norm_q not in by_norm_q:
                        by_norm_q[norm_q] = nid

        cids = anki_invoke("findCards", query=f'"deck:{escaped}"') or []
        reviewed_nids: set[int] = set()
        if cids:
            for i in range(0, len(cids), 100):
                batch_c = cids[i : i + 100]
                cards_info = anki_invoke("cardsInfo", cards=batch_c)
                for c in cards_info:
                    if isinstance(c, dict) and c.get("reps", 0) > 0 and "note" in c:
                        reviewed_nids.add(c["note"])

        return {"by_id": by_id, "by_norm_q": by_norm_q, "reviewed_nids": reviewed_nids}
    except Exception:
        return {"by_id": {}, "by_norm_q": {}, "reviewed_nids": set()}


def get_reviewed_note_ids(deck_name: str) -> set[int]:
    """Retorna os IDs das notas que possuem histórico de revisões (reps > 0) no Anki."""
    index = get_deck_notes_index(deck_name)
    return index.get("reviewed_nids", set())


def sync_deck_inplace(
    deck_name: str,
    deck_key: str,
    notes: list[dict[str, Any]],
    deck_id: int | None = None,
    media_dir: Path | None = None,
    media_files: set[str] | list[str] | None = None,
    registry: GuidRegistry | None = None,
    json_path: Path | None = None,
    prefer_anki: bool = False,
    force_local: bool = False,
) -> dict[str, int]:
    """Sincroniza notas diretamente com o Anki Desktop aproveitando IDs existentes e preservando 100% do FSRS.

    1. Garante que o deck existe no Anki.
    2. Sincroniza arquivos de mídia diretamente.
    3. Proteção por Hash / Soberania Total: se a nota já foi revisada (reps > 0) e difere do JSON local,
       previne a sobrescrita silenciosa exibindo o diff, a menos que --prefer-anki seja ativado.
    4. Para notas com ID já existente no Anki: atualiza campos in-place via updateNoteFields e tags via updateNoteTags.
    5. Para notas com ID divergente ou ausente: reconcilia pelo conteúdo da pergunta existente no baralho
       e adota o noteId canônico, evitando duplicatas e mantendo 100% do histórico de revisões.
    6. Para notas genuinamente novas: insere via addNotes, captura o novo ID gerado e persiste no JSON e registry.
    """
    anki_invoke("version")
    anki_invoke("createDeck", deck=deck_name)

    if media_dir and media_files:
        sync_media_files(media_dir, media_files)

    index = get_deck_notes_index(deck_name)
    existing_ids: set[int] = set(index["by_id"].keys())
    deck_notes_by_id: dict[int, dict[str, Any]] = index["by_id"]
    deck_notes_by_norm_q: dict[str, int] = index["by_norm_q"]
    reviewed_nids: set[int] = index.get("reviewed_nids", set())

    candidate_ids = [
        n["id"] for n in notes if isinstance(n.get("id"), int) and n["id"] > 0
    ]
    orphan_candidates = [cid for cid in candidate_ids if cid not in existing_ids]
    if orphan_candidates:
        for i in range(0, len(orphan_candidates), 100):
            batch = orphan_candidates[i : i + 100]
            infos = anki_invoke("notesInfo", notes=batch)
            for info in infos:
                if isinstance(info, dict) and info.get("noteId") in batch:
                    existing_ids.add(info["noteId"])

    updated_count = 0
    added_count = 0
    json_modified = False
    conflicts: list[dict[str, Any]] = []

    notes_to_add: list[dict[str, Any]] = []
    notes_to_add_indices: list[int] = []

    for idx, note in enumerate(notes):
        nid = note.get("id")
        fields = {
            "Question": sanitize_html(note.get("question", "")),
            "Topic": sanitize_html(note.get("topic", "")),
            "Answer": sanitize_html(note.get("answer", "")),
            "Hint": sanitize_html(note.get("hint", "")),
        }
        tags = tags_for(note, deck_key)
        ntype = note.get("type", "cloze")
        model_name = CLOZE_MODEL_NAME if ntype == "cloze" else BASIC_MODEL_NAME

        target_nid = nid if (isinstance(nid, int) and nid in existing_ids) else None

        # Reconciliação inteligente: se o ID não existir no Anki, busca correspondência
        # pelo conteúdo da pergunta existente no baralho para evitar duplicações e preservar FSRS.
        if target_nid is None:
            norm_q = normalize_question_for_matching(note.get("question", ""))
            if norm_q and norm_q in deck_notes_by_norm_q:
                target_nid = deck_notes_by_norm_q[norm_q]
                note["id"] = target_nid
                json_modified = True
                if registry and deck_id:
                    registry.guid_for(deck_key, deck_id, target_nid)

        if target_nid is not None:
            note_info = deck_notes_by_id.get(target_nid)
            if note_info:
                current_model = note_info.get("modelName")
                if current_model and current_model != model_name:
                    try:
                        anki_invoke(
                            "updateNoteModel",
                            note={
                                "id": target_nid,
                                "modelName": model_name,
                                "fields": fields,
                                "tags": tags,
                            },
                        )
                    except Exception:
                        pass
                if "cards" in note_info and note_info.get("cards"):
                    try:
                        anki_invoke("changeDeck", cards=note_info["cards"], deck=deck_name)
                    except Exception:
                        pass

                # Proteção por Hash / Soberania de Dados do Plantão:
                # Se a nota tem histórico de revisões (reps > 0) e diferir do JSON local
                if target_nid in reviewed_nids:
                    anki_fields = note_info.get("fields", {})
                    anki_q = anki_fields.get("Question", {}).get("value", "").strip()
                    anki_t = anki_fields.get("Topic", {}).get("value", "").strip()
                    anki_a = anki_fields.get("Answer", {}).get("value", "").strip()
                    anki_h = anki_fields.get("Hint", {}).get("value", "").strip()

                    local_q = fields.get("Question", "").strip()
                    local_t = fields.get("Topic", "").strip()
                    local_a = fields.get("Answer", "").strip()
                    local_h = fields.get("Hint", "").strip()

                    differs = (
                        anki_q != local_q
                        or (ntype == "basic" and anki_a != local_a)
                        or anki_h != local_h
                        or (anki_t and anki_t != local_t)
                    )

                    if differs:
                        if prefer_anki:
                            # Aplica automaticamente as alterações feitas no Anki Desktop sobre o JSON local
                            note["question"] = anki_q
                            if ntype == "basic":
                                note["answer"] = anki_a
                            note["hint"] = anki_h
                            if anki_t:
                                note["topic"] = anki_t
                            fields["Question"] = anki_q
                            fields["Answer"] = anki_a
                            fields["Hint"] = anki_h
                            if anki_t:
                                fields["Topic"] = anki_t
                            note["last_synced_hash"] = compute_note_content_hash(fields)
                            json_modified = True
                            print(
                                f"   🔄 [PREFER-ANKI] Nota {target_nid} (revisada no Anki) adotou edições feitas no Anki Desktop."
                            )
                        elif force_local:
                            pass
                        else:
                            # Previne sobrescrita silenciosa exibindo o diff
                            diff_msgs: list[str] = []
                            if anki_q != local_q:
                                diff_msgs.append(f"      [Question Anki]:  {anki_q[:85]}...")
                                diff_msgs.append(f"      [Question Local]: {local_q[:85]}...")
                            if ntype == "basic" and anki_a != local_a:
                                diff_msgs.append(f"      [Answer Anki]:    {anki_a[:85]}...")
                                diff_msgs.append(f"      [Answer Local]:   {local_a[:85]}...")
                            if anki_h != local_h:
                                diff_msgs.append(f"      [Hint Anki]:      {anki_h[:85]}...")
                                diff_msgs.append(f"      [Hint Local]:     {local_h[:85]}...")

                            conflicts.append({"note_id": target_nid, "diffs": diff_msgs})
                            print(
                                f"   🛡️ [SOBERANIA DO PLANTÃO] Nota {target_nid} possui histórico de revisões (reps > 0) e difere do JSON local:"
                            )
                            for d in diff_msgs:
                                print(d)
                            print(
                                f"      ⛔ Sobrescrita bloqueada para a nota {target_nid}. Use '--prefer-anki' para adotar a versão do Anki."
                            )
                            # Pula updateNoteFields para preservar 100% das anotações feitas no Anki Desktop
                            continue

            anki_invoke("updateNoteFields", note={"id": target_nid, "fields": fields})
            anki_invoke("updateNoteTags", note=target_nid, tags=" ".join(tags))
            note["last_synced_hash"] = compute_note_content_hash(fields)
            updated_count += 1
        else:
            notes_to_add.append(
                {
                    "deckName": deck_name,
                    "modelName": model_name,
                    "fields": fields,
                    "tags": tags,
                    "options": {"allowDuplicate": False},
                }
            )
            notes_to_add_indices.append(idx)

    if notes_to_add:
        new_ids = anki_invoke("addNotes", notes=notes_to_add)
        for list_idx, new_nid in zip(notes_to_add_indices, new_ids):
            if isinstance(new_nid, int) and new_nid > 0:
                notes[list_idx]["id"] = new_nid
                added_count += 1
                json_modified = True
                if registry and deck_id:
                    registry.guid_for(deck_key, deck_id, new_nid)

    # Adota notas criadas manualmente pelo aluno no Anki (Soberania do Aluno)
    local_nids = {n.get("id") for n in notes if isinstance(n.get("id"), int)}
    for anki_nid, anki_info in deck_notes_by_id.items():
        if anki_nid not in local_nids:
            flds = anki_info.get("fields", {})
            q_val = flds.get("Question", {}).get("value", "").strip()
            if not q_val:
                continue
            is_cloze = "cloze" in str(anki_info.get("modelName", "")).lower() or "{{c" in q_val
            notes.append(
                {
                    "id": anki_nid,
                    "type": "cloze" if is_cloze else "basic",
                    "topic": flds.get("Topic", {}).get("value", "").strip() or f"{deck_key.title()} - Geral",
                    "question": q_val,
                    "answer": "" if is_cloze else flds.get("Answer", {}).get("value", "").strip(),
                    "hint": flds.get("Hint", {}).get("value", "").strip() or "<b>Comentário:</b> Nota adicionada no Anki.",
                    "tags": tags_for({"tags": anki_info.get("tags", [])}, deck_key),
                    "sources": [],
                }
            )
            local_nids.add(anki_nid)
            json_modified = True
            if registry and deck_id:
                registry.guid_for(deck_key, deck_id, anki_nid)

    if json_modified and json_path:
        atomic_write(
            json_path,
            (json.dumps(notes, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        )

    if registry:
        registry.save()

    # Remoção defensiva de notas órfãs no Anki (que não estão no JSON e não têm histórico de revisão)
    json_nids = {n.get("id") for n in notes if isinstance(n.get("id"), int)}
    orphan_nids = [
        nid for nid in existing_ids
        if nid not in json_nids and nid not in reviewed_nids
    ]
    if orphan_nids:
        try:
            anki_invoke("deleteNotes", notes=orphan_nids)
        except Exception:
            pass

    if conflicts and not prefer_anki:
        print(
            f"\n   ⚠️  [AVISO DE SOBERANIA] {len(conflicts)} nota(s) com revisões mantida(s) intacta(s) no Anki Desktop para prevenir perda de anotações do plantão."
            f"\n       💡 Dica: Execute novamente com '--prefer-anki' para adotar as alterações do Anki no JSON local, ou execute '--pull-anki'."
        )

    escaped = deck_name.replace("\\", "\\\\").replace('"', '\\"')
    total_in_deck = len(anki_invoke("findNotes", query=f'"deck:{escaped}"'))

    return {
        "updated": updated_count,
        "added": added_count,
        "total_in_deck": total_in_deck,
        "conflicts": len(conflicts),
    }


def sync_package(
    apkg: Path,
    deck_name: str,
    notes: list[dict[str, Any]] | None = None,
    deck_key: str | None = None,
    deck_id: int | None = None,
    media_dir: Path | None = None,
    media_files: set[str] | list[str] | None = None,
    registry: GuidRegistry | None = None,
    json_path: Path | None = None,
    prefer_anki: bool = False,
) -> int:
    """Sincroniza com o Anki aberto.

    Se notes for fornecido, executa sincronização cirúrgica in-place preservando 100% dos IDs
    e agendamentos FSRS existentes. Caso contrário, faz fallback para importação do .apkg.
    """
    if notes is not None:
        key = deck_key or (
            notes[0].get("tags", [None])[0]
            if notes and notes[0].get("tags")
            else "deck"
        )
        result = sync_deck_inplace(
            deck_name=deck_name,
            deck_key=key,
            notes=notes,
            deck_id=deck_id,
            media_dir=media_dir,
            media_files=media_files,
            registry=registry,
            json_path=json_path,
            prefer_anki=prefer_anki,
        )
        return result["total_in_deck"]

    try:
        imported = anki_invoke("importPackage", path=str(apkg.resolve()))
    except Exception:
        # Anki via Flatpak não enxerga caminhos fora da sandbox: copia para dentro dela.
        if not _FLATPAK_DIR.is_dir():
            raise
        with tempfile.NamedTemporaryFile(
            dir=_FLATPAK_DIR, prefix="cards-import-", suffix=".apkg", delete=False
        ) as f:
            tmp = Path(f.name)
        try:
            shutil.copy2(apkg, tmp)
            imported = anki_invoke("importPackage", path=str(tmp))
        finally:
            tmp.unlink(missing_ok=True)
    if imported is not True:
        raise RuntimeError("AnkiConnect não confirmou a importação do pacote.")
    escaped = deck_name.replace("\\", "\\\\").replace('"', '\\"')
    return len(anki_invoke("findNotes", query=f'"deck:{escaped}"'))


def pull_deck_from_anki(
    deck_name: str,
    notes_path: Path,
    registry: GuidRegistry | None = None,
) -> dict[str, int]:
    """Consulta notas no Anki Desktop via AnkiConnect e atualiza o JSON local com eventuais
    edições manuais de texto (Question, Topic, Answer, Hint, tags) feitas pelo usuário no Anki,
    além de adotar notas criadas diretamente no Anki (Soberania do Aluno).
    """
    index = get_deck_notes_index(deck_name)
    by_id = index.get("by_id", {})
    by_norm_q = index.get("by_norm_q", {})

    if not by_id:
        return {"updated": 0, "total_local": 0, "total_anki": 0}

    if not notes_path.is_file():
        return {"updated": 0, "total_local": 0, "total_anki": len(by_id)}

    try:
        notes = json.loads(notes_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        logger.error(f"Erro ao ler JSON {notes_path}: {exc}")
        return {"updated": 0, "total_local": 0, "total_anki": len(by_id)}

    if not isinstance(notes, list):
        return {"updated": 0, "total_local": 0, "total_anki": len(by_id)}

    updated_count = 0
    registry_updated = False
    deck_key = notes_path.stem.replace("_notes", "")

    for note in notes:
        if not isinstance(note, dict):
            continue

        nid = note.get("id")
        anki_note = None

        # 1. Busca por ID exato
        if isinstance(nid, int) and nid in by_id:
            anki_note = by_id[nid]
        else:
            # 2. Reconcilia por pergunta normalizada
            norm_q = normalize_question_for_matching(str(note.get("question") or ""))
            matched_nid = by_norm_q.get(norm_q)
            if matched_nid and matched_nid in by_id:
                anki_note = by_id[matched_nid]
                if isinstance(nid, int) and nid != matched_nid:
                    note["id"] = matched_nid
                    if registry:
                        registry.reassign_note_id(deck_key, nid, matched_nid)
                        registry_updated = True
                    updated_count += 1

        if not anki_note:
            continue

        fields = anki_note.get("fields", {})
        changed = False

        # 1. Compare usando sanitize_html para evitar falsos diffs de '<' e '>'
        anki_q = fields.get("Question", {}).get("value")
        if (
            anki_q
            and anki_q.strip()
            and anki_q.strip() != sanitize_html(str(note.get("question") or "").strip())
        ):
            note["question"] = anki_q.strip()
            changed = True

        anki_t = fields.get("Topic", {}).get("value")
        if (
            anki_t
            and anki_t.strip()
            and anki_t.strip() != sanitize_html(str(note.get("topic") or "").strip())
        ):
            note["topic"] = anki_t.strip()
            changed = True

        # Atualiza Answer se basic
        if note.get("type") == "basic":
            anki_a = fields.get("Answer", {}).get("value")
            if (
                anki_a
                and anki_a.strip()
                and anki_a.strip() != sanitize_html(str(note.get("answer") or "").strip())
            ):
                note["answer"] = anki_a.strip()
                changed = True

        # Atualiza Hint
        anki_h = fields.get("Hint", {}).get("value")
        if (
            anki_h is not None
            and anki_h.strip() != sanitize_html(str(note.get("hint") or "").strip())
        ):
            note["hint"] = anki_h.strip()
            changed = True

        # 2. Preserve a tag principal (deck_key) na posição 0 ao comparar tags
        anki_tags = anki_note.get("tags")
        if isinstance(anki_tags, list) and anki_tags:
            expected_local_tags = tags_for(note, deck_key)
            clean_anki_tags = [deck_key] + [
                t.strip() for t in anki_tags if t.strip() and t.strip() != deck_key
            ]
            if set(clean_anki_tags) != set(expected_local_tags):
                note["tags"] = clean_anki_tags
                changed = True

        if changed:
            updated_count += 1

    # 3. ADOTE notas criadas manualmente pelo aluno no Anki (Soberania do Aluno)
    local_nids = {n.get("id") for n in notes if isinstance(n.get("id"), int)}
    for anki_nid, anki_info in by_id.items():
        if anki_nid not in local_nids:
            flds = anki_info.get("fields", {})
            q_val = flds.get("Question", {}).get("value", "").strip()
            if not q_val:
                continue
            is_cloze = "cloze" in str(anki_info.get("modelName", "")).lower() or "{{c" in q_val
            notes.append(
                {
                    "id": anki_nid,
                    "type": "cloze" if is_cloze else "basic",
                    "topic": flds.get("Topic", {}).get("value", "").strip() or f"{deck_key.title()} - Geral",
                    "question": q_val,
                    "answer": "" if is_cloze else flds.get("Answer", {}).get("value", "").strip(),
                    "hint": flds.get("Hint", {}).get("value", "").strip() or "<b>Comentário:</b> Nota adicionada no Anki.",
                    "tags": tags_for({"tags": anki_info.get("tags", [])}, deck_key),
                    "sources": [],
                }
            )
            updated_count += 1
            local_nids.add(anki_nid)

    if updated_count > 0:
        atomic_write(
            notes_path,
            (json.dumps(notes, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        )
        if registry_updated and registry:
            registry.save()

    return {
        "updated": updated_count,
        "total_local": len(notes),
        "total_anki": len(by_id),
    }
