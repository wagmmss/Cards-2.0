"""Sidecar Visual Zero-Dependency (cards preview / cards studio).

Servidor HTTP nativo (Python http.server) que roda localmente em http://localhost:8766.
Serve uma interface moderna single-file para inspeção e edição de flashcards com:
- Comparativo lado a lado: Visão Desktop e Visão Mobile (390px estilo smartphone)
- Filtros rápidos (todos, imagens, recognition, feedback, avisos de linter, modificados)
- Edição inline (contenteditable="true") com contador de caracteres em tempo real (245/320 chars)
- Botão "Salvar & Sync Anki" via POST /save e AnkiConnect
- Zero dependências externas (sem React, sem Node, sem frameworks web pesados)
"""

from __future__ import annotations

import json
import mimetypes
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

from criador_cards import anki, lint
from criador_cards.build import Project

DEFAULT_PORT = 8766


class PreviewHandler(BaseHTTPRequestHandler):
    project: Project
    current_deck_key: str

    def log_message(self, format: str, *args: Any) -> None:
        # Suprime logs excessivos de requisições estáticas para manter o terminal limpo
        pass

    def send_json(self, data: Any, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. Rota Principal: SPA HTML single-file
        if path == "/" or path == "/index.html":
            deck_key = query.get("deck", [self.current_deck_key])[0]
            html_content = generate_studio_html(self.project, deck_key)
            payload = html_content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        # 2. API: Lista de decks disponíveis
        if path == "/api/decks":
            decks = self.project.load_decks()
            deck_list = []
            for k, d in decks.items():
                np = self.project.notes_path(k)
                cnt = 0
                if np.is_file():
                    try:
                        cnt = len(json.loads(np.read_text(encoding="utf-8-sig")))
                    except Exception:
                        pass
                deck_list.append({
                    "key": k,
                    "name": d.get("deck_name", k),
                    "enabled": d.get("enabled", True),
                    "notes_count": cnt,
                })
            self.send_json({"decks": deck_list, "current": self.current_deck_key})
            return

        # 3. API: Dados do Deck selecionado
        if path == "/api/deck":
            deck_key = query.get("deck", [self.current_deck_key])[0]
            decks = self.project.load_decks()
            deck_info = decks.get(deck_key, {})
            notes_p = self.project.notes_path(deck_key)
            notes: list[dict[str, Any]] = []
            if notes_p.is_file():
                try:
                    notes = json.loads(notes_p.read_text(encoding="utf-8-sig"))
                except Exception as exc:
                    self.send_json({"error": f"Erro ao ler JSON: {exc}"}, status=500)
                    return

            media_dir = self.project.media_dir(deck_key)
            linter_warnings: list[dict[str, Any]] = []
            try:
                raw_issues, _ = lint.lint_deck(notes, media_dir)
                for iss in raw_issues:
                    linter_warnings.append({
                        "rule": getattr(iss, "rule", "aviso"),
                        "severity": getattr(iss, "severity", "aviso"),
                        "message": getattr(iss, "message", str(iss)),
                        "note_id": getattr(iss, "note_id", None),
                    })
            except Exception as exc:
                linter_warnings = [{"rule": "linter", "severity": "erro", "message": f"Erro ao rodar linter: {exc}"}]

            # Checagem de status do AnkiConnect
            anki_online = False
            try:
                anki.anki_invoke("version")
                anki_online = True
            except Exception:
                pass

            self.send_json({
                "key": deck_key,
                "deck_name": deck_info.get("deck_name", deck_key),
                "notes": notes,
                "linter_warnings": linter_warnings,
                "anki_online": anki_online,
            })
            return

        # 4. Servir arquivos de mídia (imagens e áudios de 04_Mídias/)
        # Tenta servir do deck atual ou da raiz de 04_Mídias
        clean_name = path.lstrip("/")
        if clean_name.startswith("media/"):
            clean_name = clean_name[len("media/") :]

        # Se houver indicação de subdiretório de deck
        cand_paths = [
            self.project.media_dir(self.current_deck_key) / clean_name,
            self.project.media_root / clean_name,
        ]
        # Se contiver barra na query (ex: deck/arquivo.webp)
        if "/" in clean_name:
            cand_paths.append(self.project.media_root / clean_name)

        media_file: Path | None = None
        for cand in cand_paths:
            if cand.is_file():
                media_file = cand
                break

        if media_file:
            mime_type, _ = mimetypes.guess_type(str(media_file))
            mime_type = mime_type or "application/octet-stream"
            try:
                data = media_file.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "public, max-age=3600")
                self.end_headers()
                self.wfile.write(data)
                return
            except Exception:
                pass

        self.send_response(404)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"404 Not Found")

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in ("/save", "/api/save"):
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                payload = json.loads(body.decode("utf-8"))
            except Exception as exc:
                self.send_json({"error": f"Payload JSON inválido: {exc}"}, status=400)
                return

            deck_key = payload.get("deck", self.current_deck_key)
            notes = payload.get("notes")
            sync_anki = bool(payload.get("sync_anki", False))

            if not isinstance(notes, list):
                self.send_json({"error": "Campo 'notes' deve ser uma lista"}, status=400)
                return

            notes_p = self.project.notes_path(deck_key)
            try:
                # Salva o arquivo de notas atomicamente
                anki.atomic_write(
                    notes_p,
                    (json.dumps(notes, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
                )
            except Exception as exc:
                self.send_json({"error": f"Erro ao salvar JSON: {exc}"}, status=500)
                return

            sync_stats: dict[str, Any] | None = None
            if sync_anki:
                decks = self.project.load_decks()
                deck_info = decks.get(deck_key)
                if not deck_info:
                    self.send_json({"error": f"Deck '{deck_key}' não encontrado em decks.toml"}, status=400)
                    return
                registry = anki.GuidRegistry(self.project.registry)
                media_dir = self.project.media_dir(deck_key)
                _, media_files = lint.lint_deck(notes, media_dir)
                try:
                    sync_stats = anki.sync_deck_inplace(
                        deck_name=deck_info["deck_name"],
                        deck_key=deck_key,
                        notes=notes,
                        deck_id=deck_info.get("deck_id"),
                        media_dir=media_dir,
                        media_files=media_files,
                        registry=registry,
                        json_path=notes_p,
                        prefer_anki=False,
                    )
                except Exception as exc:
                    self.send_json({
                        "saved": True,
                        "sync_error": f"Erro ao sincronizar com Anki: {exc}",
                    }, status=200)
                    return

            self.send_json({
                "saved": True,
                "deck": deck_key,
                "notes_count": len(notes),
                "synced": sync_anki,
                "sync_stats": sync_stats,
            })
            return

        self.send_response(404)
        self.end_headers()


def generate_studio_html(project: Project, current_deck: str) -> str:
    """Gera a página HTML única e autocontida para o Cards Studio."""
    anki_css = anki.CSS

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cards Studio — Sidecar Visual de Flashcards</title>
  <style>
    :root {{
      --bg-canvas: #0f172a;
      --bg-panel: #1e293b;
      --bg-card: #ffffff;
      --border-color: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #0284c7;
      --accent-hover: #0369a1;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-canvas);
      color: var(--text-main);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }}

    /* CSS Oficial do Anki Desktop (Embutido) */
    {anki_css}

    /* Studio Header & Toolbars */
    header.studio-header {{
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border-color);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      z-index: 100;
    }}
    .brand {{
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      font-size: 17px;
      color: #38bdf8;
      letter-spacing: -0.5px;
    }}
    .brand span.badge {{
      background: #0369a1;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 999px;
      text-transform: uppercase;
    }}
    .deck-picker {{
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    select.deck-select {{
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 14px;
      font-weight: 600;
      max-width: 320px;
      cursor: pointer;
    }}
    .actions-bar {{
      display: flex;
      align-items: center;
      gap: 10px;
    }}
    .btn {{
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease-in-out;
    }}
    .btn-primary {{
      background: var(--accent);
      color: #fff;
    }}
    .btn-primary:hover {{ background: var(--accent-hover); }}
    .btn-sync {{
      background: #059669;
      color: #fff;
    }}
    .btn-sync:hover {{ background: #047857; }}
    .btn-outline {{
      background: transparent;
      color: var(--text-main);
      border: 1px solid var(--border-color);
    }}
    .btn-outline:hover {{ background: #334155; }}
    .status-pill {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: #0f172a;
      border: 1px solid var(--border-color);
    }}
    .dot-online {{ width: 8px; height: 8px; border-radius: 50%; background: #10b981; }}
    .dot-offline {{ width: 8px; height: 8px; border-radius: 50%; background: #ef4444; }}

    /* Sub-header com Filtros e Busca */
    .filter-bar {{
      background: #1e293b;
      border-bottom: 1px solid var(--border-color);
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }}
    .filter-tabs {{
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }}
    .filter-btn {{
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12.5px;
      font-weight: 600;
      background: #0f172a;
      color: var(--text-muted);
      border: 1px solid var(--border-color);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }}
    .filter-btn.active {{
      background: #0284c7;
      color: #ffffff;
      border-color: #38bdf8;
    }}
    .filter-count {{
      background: rgba(255,255,255,0.18);
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 999px;
    }}
    .search-box {{
      position: relative;
      flex: 1;
      max-width: 380px;
    }}
    .search-box input {{
      width: 100%;
      background: #0f172a;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 6px 12px 6px 32px;
      font-size: 13.5px;
      color: #fff;
    }}
    .search-box svg {{
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 14px;
      height: 14px;
      fill: var(--text-muted);
    }}

    /* Layout da Área de Trabalho */
    main.studio-workspace {{
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }}

    /* Card Comparison Container */
    .card-entry {{
      background: #182234;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    }}
    .card-entry.has-warnings {{
      border-left: 5px solid var(--warning);
    }}
    .card-header-bar {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #293548;
      padding-bottom: 10px;
    }}
    .card-meta {{
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: var(--text-muted);
    }}
    .badge-type {{
      background: #0369a1;
      color: #e0f2fe;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 11.5px;
      text-transform: uppercase;
    }}
    .card-tools {{
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .char-badge {{
      font-size: 12px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
    }}
    .char-ok {{ background: #064e3b; color: #6ee7b7; }}
    .char-warn {{ background: #78350f; color: #fde68a; }}
    .char-danger {{ background: #7f1d1d; color: #fca5a5; }}

    /* Comparativo: Desktop vs Mobile 390px lado a lado */
    .views-grid {{
      display: grid;
      grid-template-columns: 1fr 410px;
      gap: 24px;
      align-items: flex-start;
    }}
    @media (max-width: 1100px) {{
      .views-grid {{ grid-template-columns: 1fr; }}
    }}

    .view-column {{
      display: flex;
      flex-direction: column;
      gap: 8px;
    }}
    .column-title {{
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }}

    /* Moldura Mobile 390px */
    .mobile-wrapper {{
      width: 390px;
      max-width: 100%;
      background: #090d16;
      border: 6px solid #334155;
      border-radius: 36px;
      overflow: hidden;
      box-shadow: 0 12px 30px rgba(0,0,0,0.5);
      position: relative;
    }}
    .mobile-speaker-bar {{
      height: 18px;
      background: #090d16;
      display: flex;
      justify-content: center;
      align-items: center;
    }}
    .mobile-speaker {{
      width: 50px;
      height: 4px;
      background: #334155;
      border-radius: 4px;
    }}
    .mobile-screen {{
      height: 520px;
      overflow-y: auto;
      background: #f8fafc;
      color: #1e293b;
      padding: 4px;
    }}
    .mobile-screen.nightMode {{
      background: #18181b;
      color: #f4f4f5;
    }}

    /* Card Wrapper */
    .anki-render-box {{
      border-radius: 8px;
      overflow: hidden;
      background: #f8fafc;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      position: relative;
    }}
    .anki-render-box.nightMode {{
      background: #18181b;
    }}

    /* Edição Inline com ContentEditable */
    [contenteditable="true"] {{
      outline: none;
      transition: background 0.15s;
      border-radius: 4px;
      padding: 2px 4px;
    }}
    [contenteditable="true"]:focus {{
      background: rgba(2, 132, 199, 0.12);
      box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.4);
    }}
    .editable-hint-wrapper {{
      min-height: 40px;
    }}

    /* Avisos do Linter */
    .linter-box {{
      background: #451a03;
      border-left: 4px solid var(--warning);
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 13px;
      color: #fef3c7;
      line-height: 1.45;
    }}

    /* Toast Flutuante */
    .toast {{
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 20px;
      background: #0f172a;
      border: 1px solid var(--accent);
      color: #fff;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      display: none;
      align-items: center;
      gap: 10px;
      z-index: 1000;
    }}
    .toast.show {{ display: flex; animation: slideIn 0.2s ease-out; }}
    @keyframes slideIn {{
      from {{ transform: translateY(20px); opacity: 0; }}
      to {{ transform: translateY(0); opacity: 1; }}
    }}
  </style>
</head>
<body>
  <header class="studio-header">
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z"/>
      </svg>
      CARDS STUDIO
      <span class="badge">Zero-Dep Sidecar</span>
    </div>

    <div class="deck-picker">
      <label for="deckSelect" style="font-size: 12px; color: var(--text-muted); font-weight: 700;">BARALHO:</label>
      <select id="deckSelect" class="deck-select" onchange="changeDeck(this.value)"></select>
    </div>

    <div class="actions-bar">
      <div id="ankiStatus" class="status-pill">
        <span class="dot-offline"></span> Anki Offline
      </div>
      <button class="btn btn-outline" onclick="toggleNightMode()" title="Alternar Modo Escuro">🌙 Dark Mode</button>
      <button class="btn btn-primary" onclick="saveDeck(false)">💾 Salvar (Ctrl+S)</button>
      <button class="btn btn-sync" onclick="saveDeck(true)">⚡ Salvar & Sync Anki</button>
    </div>
  </header>

  <div class="filter-bar">
    <div class="filter-tabs">
      <button class="filter-btn active" data-filter="all" onclick="setFilter('all')">
        Todos <span id="cnt-all" class="filter-count">0</span>
      </button>
      <button class="filter-btn" data-filter="images" onclick="setFilter('images')">
        🖼️ Com Imagens <span id="cnt-images" class="filter-count">0</span>
      </button>
      <button class="filter-btn" data-filter="recognition" onclick="setFilter('recognition')">
        🔍 Recognition <span id="cnt-recognition" class="filter-count">0</span>
      </button>
      <button class="filter-btn" data-filter="feedback" onclick="setFilter('feedback')">
        💡 Feedback <span id="cnt-feedback" class="filter-count">0</span>
      </button>
      <button class="filter-btn" data-filter="warnings" onclick="setFilter('warnings')">
        ⚠️ Com Avisos <span id="cnt-warnings" class="filter-count">0</span>
      </button>
      <button class="filter-btn" data-filter="modified" onclick="setFilter('modified')">
        ✏️ Modificados <span id="cnt-modified" class="filter-count">0</span>
      </button>
    </div>

    <div class="search-box">
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      <input type="text" id="searchInput" placeholder="Filtrar por texto, termo, pergunta ou hint..." oninput="applyFilters()">
    </div>
  </div>

  <main id="workspace" class="studio-workspace"></main>

  <div id="toast" class="toast">
    <span id="toastMsg">Mensagem</span>
  </div>

  <script>
    let currentDeckKey = "{current_deck}";
    let deckNotes = [];
    let linterWarnings = [];
    let activeFilter = "all";
    let isNightMode = false;
    let modifiedIndices = new Set();

    async function loadDecks() {{
      try {{
        const res = await fetch("/api/decks");
        const data = await res.json();
        const sel = document.getElementById("deckSelect");
        sel.innerHTML = "";
        data.decks.forEach(d => {{
          const opt = document.createElement("option");
          opt.value = d.key;
          opt.textContent = `${{d.key}} (${{d.notes_count}} notas)`;
          if (d.key === currentDeckKey) opt.selected = true;
          sel.appendChild(opt);
        }});
      }} catch (e) {{
        console.error("Erro ao listar baralhos:", e);
      }}
    }}

    async function loadDeckData(deckKey) {{
      currentDeckKey = deckKey;
      const ws = document.getElementById("workspace");
      ws.innerHTML = '<div style="color:#94a3b8; text-align:center; padding:50px;">Carregando notas do baralho...</div>';
      try {{
        const res = await fetch(`/api/deck?deck=${{encodeURIComponent(deckKey)}}`);
        const data = await res.json();
        deckNotes = data.notes || [];
        linterWarnings = data.linter_warnings || [];
        modifiedIndices.clear();

        // Status do AnkiConnect
        const statusEl = document.getElementById("ankiStatus");
        if (data.anki_online) {{
          statusEl.innerHTML = '<span class="dot-online"></span> Anki Desktop Conectado';
        }} else {{
          statusEl.innerHTML = '<span class="dot-offline"></span> Anki Offline';
        }}

        updateFilterCounts();
        renderNotes();
      }} catch (e) {{
        ws.innerHTML = `<div style="color:#ef4444; padding:30px;">Falha ao carregar deck: ${{e.message}}</div>`;
      }}
    }}

    function changeDeck(newKey) {{
      const url = new URL(window.location);
      url.searchParams.set("deck", newKey);
      window.history.pushState({{}}, "", url);
      loadDeckData(newKey);
    }}

    function toggleNightMode() {{
      isNightMode = !isNightMode;
      document.querySelectorAll(".card, .anki-render-box, .mobile-screen").forEach(el => {{
        if (isNightMode) el.classList.add("nightMode");
        else el.classList.remove("nightMode");
      }});
    }}

    function getCharCountBadge(len) {{
      let cls = "char-ok";
      if (len > 320) cls = "char-danger";
      else if (len > 245) cls = "char-warn";
      return `<span class="char-badge ${{cls}}">${{len}} / 320 chars</span>`;
    }}

    function updateFilterCounts() {{
      document.getElementById("cnt-all").textContent = deckNotes.length;
      document.getElementById("cnt-images").textContent = deckNotes.filter(n => (n.question + n.hint).includes("<img")).length;
      document.getElementById("cnt-recognition").textContent = deckNotes.filter(n => n.question.includes("<img") || n.question.includes("[RECONHECIMENTO]") || (n.topic||"").includes("Reconhecimento")).length;
      document.getElementById("cnt-feedback").textContent = deckNotes.filter(n => !n.question.includes("<img") && n.hint.includes("<img")).length;
      document.getElementById("cnt-warnings").textContent = linterWarnings.length > 0 ? linterWarnings.length : 0;
      document.getElementById("cnt-modified").textContent = modifiedIndices.size;
    }}

    function setFilter(filter) {{
      activeFilter = filter;
      document.querySelectorAll(".filter-btn").forEach(b => {{
        if (b.dataset.filter === filter) b.classList.add("active");
        else b.classList.remove("active");
      }});
      applyFilters();
    }}

    function applyFilters() {{
      const query = document.getElementById("searchInput").value.toLowerCase().trim();
      const entries = document.querySelectorAll(".card-entry");
      entries.forEach(entry => {{
        const idx = parseInt(entry.dataset.index, 10);
        const note = deckNotes[idx];
        if (!note) return;

        let passFilter = true;
        const fullContent = (note.question + " " + note.hint + " " + (note.topic||"") + " " + (note.answer||"")).toLowerCase();
        const hasImg = fullContent.includes("<img");
        const isRecog = (note.question||"").includes("<img") || (note.question||"").includes("[RECONHECIMENTO]") || (note.topic||"").includes("Reconhecimento");
        const isFeedback = hasImg && !isRecog;

        if (activeFilter === "images" && !hasImg) passFilter = false;
        else if (activeFilter === "recognition" && !isRecog) passFilter = false;
        else if (activeFilter === "feedback" && !isFeedback) passFilter = false;
        else if (activeFilter === "warnings" && !entry.classList.contains("has-warnings")) passFilter = false;
        else if (activeFilter === "modified" && !modifiedIndices.has(idx)) passFilter = false;

        if (passFilter && query) {{
          if (!fullContent.includes(query) && !String(note.id).includes(query)) {{
            passFilter = false;
          }}
        }}

        entry.style.display = passFilter ? "flex" : "none";
      }});
    }}

    function renderNotes() {{
      const ws = document.getElementById("workspace");
      ws.innerHTML = "";

      deckNotes.forEach((note, idx) => {{
        const entry = document.createElement("div");
        entry.className = "card-entry";
        entry.dataset.index = idx;

        const qLen = (note.question || "").replace(/<[^>]+>/g, "").length;
        const charBadge = getCharCountBadge(qLen);

        // Renderiza card no estilo oficial do Anki
        const qHtml = note.question || "";
        const topicHtml = note.topic ? `<div class="topic-box" contenteditable="true" data-field="topic" data-index="${{idx}}">${{note.topic}}</div>` : '';
        const hintHtml = note.hint ? `<hr id="answer" class="med-divider"><div class="extra-box" contenteditable="true" data-field="hint" data-index="${{idx}}">${{note.hint}}</div>` : '';
        const answerHtml = (note.type === "basic" && note.answer) ? `<div class="main-answer" contenteditable="true" data-field="answer" data-index="${{idx}}">${{note.answer}}</div>` : '';

        entry.innerHTML = `
          <div class="card-header-bar">
            <div class="card-meta">
              <span style="font-weight:700; color:#fff;">#${{idx + 1}}</span>
              <span class="badge-type">${{note.type || "cloze"}}</span>
              <span>ID: ${{note.id || "novo"}}</span>
              ${{note.tags ? `<span style="font-size:11px;">🏷️ ${{note.tags.join(", ")}}</span>` : ""}}
            </div>
            <div class="card-tools">
              <span id="char-badge-${{idx}}">${{charBadge}}</span>
            </div>
          </div>

          <div class="views-grid">
            <!-- Coluna 1: Visão Desktop -->
            <div class="view-column">
              <div class="column-title">💻 Visão Desktop (Anki Desktop)</div>
              <div class="anki-render-box ${{isNightMode ? 'nightMode' : ''}}">
                <div class="card ${{isNightMode ? 'nightMode' : ''}}">
                  <div class="med-card">
                    ${{topicHtml}}
                    <div class="front-content" contenteditable="true" data-field="question" data-index="${{idx}}">${{qHtml}}</div>
                    ${{answerHtml}}
                    ${{hintHtml}}
                  </div>
                </div>
              </div>
            </div>

            <!-- Coluna 2: Visão Mobile 390px (AnkiMobile) -->
            <div class="view-column">
              <div class="column-title">📱 Visão Mobile 390px (Plantão)</div>
              <div class="mobile-wrapper">
                <div class="mobile-speaker-bar"><div class="mobile-speaker"></div></div>
                <div class="mobile-screen ${{isNightMode ? 'nightMode' : ''}}">
                  <div class="card ${{isNightMode ? 'nightMode' : ''}}" style="padding:14px; font-size:16.5px;">
                    <div class="med-card">
                      <div class="topic-box" style="font-size:12px;">${{note.topic || ""}}</div>
                      <div class="front-content mobile-sync-q-${{idx}}" style="font-size:17.5px;">${{qHtml}}</div>
                      ${{answerHtml ? `<div class="main-answer" style="font-size:18px;">${{note.answer || ""}}</div>` : ""}}
                      ${{note.hint ? `<hr id="answer" class="med-divider"><div class="extra-box mobile-sync-h-${{idx}}" style="padding:10px 14px; font-size:15px;">${{note.hint}}</div>` : ""}}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;

        ws.appendChild(entry);
      }});

      // Liga os listeners de edição inline
      document.querySelectorAll('[contenteditable="true"]').forEach(el => {{
        el.addEventListener("input", onFieldEdit);
      }});

      applyFilters();
    }}

    function onFieldEdit(e) {{
      const el = e.currentTarget;
      const idx = parseInt(el.dataset.index, 10);
      const field = el.dataset.field;
      const note = deckNotes[idx];
      if (!note) return;

      const newHtml = el.innerHTML
        .replace(/<div><br\\s*\\/?><\\/div>/gi, "<br>")
        .replace(/<div>/gi, "<br>")
        .replace(/<\\/div>/gi, "")
        .replace(/<p>/gi, "")
        .replace(/<\\/p>/gi, "<br>")
        .replace(/&nbsp;/gi, " ")
        .trim();
      note[field] = newHtml;
      modifiedIndices.add(idx);
      updateFilterCounts();

      // Atualiza badge de caracteres se for a pergunta
      if (field === "question") {{
        const plainText = el.innerText.replace(/\\s+/g, " ").trim();
        const badgeEl = document.getElementById(`char-badge-${{idx}}`);
        if (badgeEl) {{
          badgeEl.innerHTML = getCharCountBadge(plainText.length);
        }}
        // Espelha na tela mobile instantaneamente
        const mobSync = document.querySelector(`.mobile-sync-q-${{idx}}`);
        if (mobSync) mobSync.innerHTML = newHtml;
      }} else if (field === "hint") {{
        const mobSyncH = document.querySelector(`.mobile-sync-h-${{idx}}`);
        if (mobSyncH) mobSyncH.innerHTML = newHtml;
      }}
    }}

    async function saveDeck(syncAnki = false) {{
      showToast(syncAnki ? "Salvando e sincronizando com Anki..." : "Salvando alterações no JSON...");
      try {{
        const res = await fetch("/save", {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify({{
            deck: currentDeckKey,
            notes: deckNotes,
            sync_anki: syncAnki,
          }}),
        }});
        const data = await res.json();
        if (data.saved) {{
          modifiedIndices.clear();
          updateFilterCounts();
          if (syncAnki) {{
            if (data.sync_stats) {{
              showToast(`✅ Salvo e Sincronizado no Anki! (${{data.sync_stats.updated}} atualizadas, ${{data.sync_stats.added}} novas)`);
            }} else if (data.sync_error) {{
              showToast(`⚠️ Salvo localmente, mas Anki falhou: ${{data.sync_error}}`);
            }} else {{
              showToast("✅ Salvo e Sincronizado no Anki Desktop!");
            }}
          }} else {{
            showToast("✅ Salvo com sucesso no JSON local!");
          }}
        }} else {{
          showToast(`❌ Erro ao salvar: ${{data.error || "Desconhecido"}}`);
        }}
      }} catch (e) {{
        showToast(`❌ Falha na requisição: ${{e.message}}`);
      }}
    }}

    function showToast(msg) {{
      const t = document.getElementById("toast");
      const m = document.getElementById("toastMsg");
      m.textContent = msg;
      t.classList.add("show");
      setTimeout(() => {{ t.classList.remove("show"); }}, 3500);
    }}

    // Atalho de teclado global Ctrl+S / Cmd+S
    document.addEventListener("keydown", (e) => {{
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {{
        e.preventDefault();
        saveDeck(false);
      }}
    }});

    // Inicialização
    loadDecks().then(() => loadDeckData(currentDeckKey));
  </script>
</body>
</html>
"""


def run_preview_server(
    project: Project | None = None,
    deck_key: str | None = None,
    port: int = DEFAULT_PORT,
    open_browser: bool = True,
) -> None:
    """Inicia o servidor visual do Sidecar e abre o browser."""
    project = project or Project()
    decks = project.load_decks()
    if not deck_key:
        deck_key = next(iter(decks.keys())) if decks else "puerperio"

    class CustomHandler(PreviewHandler):
        pass

    CustomHandler.project = project
    CustomHandler.current_deck_key = deck_key

    # Tenta instanciar o servidor na porta especificada ou em portas subsequentes
    server = None
    target_port = port
    for p in range(target_port, target_port + 10):
        try:
            server = HTTPServer(("127.0.0.1", p), CustomHandler)
            target_port = p
            break
        except OSError:
            continue

    if not server:
        print(f"❌ Não foi possível abrir porta entre {port} e {port+10}", file=sys.stderr)
        return

    url = f"http://localhost:{target_port}/?deck={deck_key}"
    print("\n" + "=" * 65)
    print("🚀 CARDS STUDIO — SIDECAR VISUAL ZERO-DEPENDENCY INICIADO")
    print(f"   • Endereço: {url}")
    print(f"   • Baralho Ativo: {deck_key}")
    print("   • Pressione Ctrl+C para encerrar o servidor visual.")
    print("=" * 65 + "\n")

    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Servidor Cards Studio finalizado.")
    finally:
        server.server_close()


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Sidecar Visual do Criador de Cards")
    parser.add_argument("--deck", help="Chave do baralho para abrir no estúdio")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Porta local (padrão: 8766)")
    parser.add_argument("--no-browser", action="store_true", help="Não abre o navegador automaticamente")
    args = parser.parse_args()

    run_preview_server(
        deck_key=args.deck,
        port=args.port,
        open_browser=not args.no_browser,
    )


if __name__ == "__main__":
    main()
