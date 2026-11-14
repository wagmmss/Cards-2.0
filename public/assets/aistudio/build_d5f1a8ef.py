"""CLI do Criador de Cards: valida os JSONs, gera o .apkg e (opcionalmente) sincroniza com o Anki.

Exemplos:
  uv run cards --deck puerperio --check          # só valida
  uv run cards --deck puerperio                  # valida e gera o .apkg
  uv run cards --deck puerperio --anki-sync      # ... e importa no Anki aberto
  uv run cards --all                             # todos os decks com enabled = true
  uv run cards --create-deck avc --title "5º Ano::Clínica::Neurologia::AVC"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import tomllib
from collections import defaultdict
from pathlib import Path
from typing import Any

from criador_cards import anki, lint

ROOT = Path(__file__).resolve().parents[2]


class Project:
    def __init__(self, root: Path = ROOT) -> None:
        self.root = root
        self.toml = root / "decks.toml"
        self.decks_dir = root / "data" / "decks"
        self.media_root = root / "04_Mídias"
        self.sources_dir = root / "02_Capítulos_PDF"
        self.output_dir = root / "01_Decks_Anki"
        self.registry = root / "data" / "registry" / "note_guid_registry.json"

    def load_decks(self) -> dict[str, dict[str, Any]]:
        config: dict[str, dict[str, Any]] = (
            tomllib.loads(self.toml.read_text(encoding="utf-8"))
            if self.toml.exists()
            else {}
        )
        ids: dict[int, list[str]] = defaultdict(list)
        for key, deck in config.items():
            if not re.fullmatch(r"[a-z0-9_]+", key):
                raise ValueError(f"chave de deck inválida em decks.toml: {key!r}")
            if (
                not isinstance(deck.get("deck_id"), int)
                or isinstance(deck.get("deck_id"), bool)
                or not str(deck.get("deck_name", "")).strip()
            ):
                raise ValueError(f"[{key}] precisa de deck_id (inteiro) e deck_name")
            ids[deck["deck_id"]].append(key)
        dup = {i: k for i, k in ids.items() if len(k) > 1}
        if dup:
            raise ValueError(f"deck_id repetido em decks.toml: {dup}")
        return config

    def notes_path(self, key: str) -> Path:
        return self.decks_dir / f"{key}_notes.json"

    def media_dir(self, key: str) -> Path:
        return self.media_root / key

    def apkg_path(self, deck: dict[str, Any]) -> Path:
        name = deck.get("output_apkg")
        if not name:
            name = (
                re.sub(
                    r'[<>:"/\\|?*]+', " - ", str(deck["deck_name"]).replace("::", " - ")
                ).strip(" .-")
                + ".apkg"
            )
        return self.output_dir / str(name)


def write_notes(path: Path, notes: list[dict[str, Any]]) -> None:
    anki.atomic_write(path, (json.dumps(notes, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def package_deck(
    project: Project,
    key: str,
    deck: dict[str, Any],
    notes: list[dict[str, Any]],
    media: set[str],
    registry: anki.GuidRegistry,
) -> Path:
    output = project.apkg_path(deck)
    anki.write_package(
        key, deck["deck_id"], deck["deck_name"], notes, registry,
        project.media_dir(key), media, output,
    )
    return output


def publish_deck(
    project: Project,
    key: str,
    deck: dict[str, Any],
    notes: list[dict[str, Any]],
    media: set[str],
    notes_path: Path | None,
) -> Path:
    """Publica notas e pacote validados. Restaura o JSON se o pacote falhar."""
    previous = notes_path.read_bytes() if notes_path and notes_path.is_file() else None
    if notes_path is not None:
        write_notes(notes_path, notes)
    try:
        return package_deck(project, key, deck, notes, media, anki.GuidRegistry(project.registry))
    except Exception:
        if notes_path is not None:
            if previous is None:
                notes_path.unlink(missing_ok=True)
            else:
                anki.atomic_write(notes_path, previous)
        raise


def print_issues(issues: list[lint.Issue], verbose: bool) -> None:
    errors = [i for i in issues if i.severity == "erro"]
    for i in errors[:40]:
        print(f"   ❌ nota {i.note_id} [{i.rule}] {i.message}")
    if len(errors) > 40:
        print(f"   … mais {len(errors) - 40} erro(s)")
    warnings = [i for i in issues if i.severity == "aviso"]
    if verbose:
        for i in warnings:
            print(f"   ⚠️  nota {i.note_id} [{i.rule}] {i.message}")
        return
    by_rule: dict[str, list[lint.Issue]] = defaultdict(list)
    for i in warnings:
        by_rule[i.rule].append(i)
    for rule, items in sorted(by_rule.items(), key=lambda kv: -len(kv[1])):
        examples = ", ".join(str(i.note_id) for i in items[:3])
        print(
            f"   ⚠️  [{rule}] {len(items)} nota(s) — {items[0].message} (ex.: {examples})"
        )


def process_deck(
    project: Project,
    key: str,
    deck: dict[str, Any],
    registry: anki.GuidRegistry,
    args: argparse.Namespace,
) -> bool:
    print(f"\n▶ {deck['deck_name']}  ({key})")
    path = project.notes_path(key)
    try:
        notes = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"   ❌ não foi possível ler {path.relative_to(project.root)}: {exc}")
        return False

    media_dir = project.media_dir(key)
    sources_dir = project.sources_dir if project.sources_dir.is_dir() else None
    issues, media = lint.lint_deck(
        notes, media_dir, sources_dir=sources_dir, structural=args.structural
    )
    print_issues(issues, args.verbose)
    n_err = sum(i.severity == "erro" for i in issues)
    n_warn = len(issues) - n_err
    if n_err or (args.strict and n_warn):
        print(
            f"   ⛔ bloqueado: {n_err} erro(s), {n_warn} aviso(s){' (modo --strict)' if args.strict and not n_err else ''}"
        )
        return False
    if not notes:
        print("   (deck vazio, nada a gerar)")
        return True

    n_cards = sum(
        max(1, len({o for o, _ in lint.CLOZE.findall(n["question"])}))
        if n["type"] == "cloze"
        else 1
        for n in notes
    )
    if args.check:
        print(f"   ✅ válido: {len(notes)} notas → {n_cards} cards, {n_warn} aviso(s)")
        return True

    try:
        output = package_deck(project, key, deck, notes, media, registry)
    except Exception as exc:
        print(f"   ❌ falha ao empacotar {key}: {exc}")
        return False
    print(
        f"   ✅ {output.relative_to(project.root)}: {len(notes)} notas → {n_cards} cards, {len(media)} mídia(s), {n_warn} aviso(s)"
    )

    if args.anki_sync:
        try:
            try:
                total = anki.sync_package(
                    output,
                    deck["deck_name"],
                    notes=notes,
                    deck_key=key,
                    deck_id=deck["deck_id"],
                    media_dir=project.media_dir(key),
                    media_files=media,
                    registry=registry,
                    json_path=project.notes_path(key),
                    prefer_anki=getattr(args, "prefer_anki", False),
                )
            except TypeError:
                total = anki.sync_package(output, deck["deck_name"], notes=notes)
            print(f"   🔄 sincronizado in-place no Anki ({total} notas no deck)")
        except Exception as exc:
            print(
                f"   ❌ falha ao sincronizar com o Anki (ele está aberto com o AnkiConnect?): {exc}"
            )
            return False
    return True


def create_deck(project: Project, key: str, title: str | None) -> int:
    key = re.sub(r"[^a-z0-9_]", "_", key.lower()).strip("_")
    decks = project.load_decks()
    if not key or key in decks:
        print(f"❌ chave inválida ou já existente: {key!r}")
        return 1
    title = (title or key.replace("_", " ").title()).strip()
    used = {d["deck_id"] for d in decks.values()}
    deck_id = int(time.time() * 1000)
    while deck_id in used:
        deck_id += 1
    block = f"\n[{key}]\ndeck_id = {deck_id}\ndeck_name = {json.dumps(title, ensure_ascii=False)}\nenabled = true\n"
    current = project.toml.read_text(encoding="utf-8") if project.toml.exists() else ""
    project.toml.write_text(current.rstrip() + "\n" + block, encoding="utf-8")
    notes = project.notes_path(key)
    if not notes.exists():
        notes.parent.mkdir(parents=True, exist_ok=True)
        notes.write_text("[]\n", encoding="utf-8")
    project.media_dir(key).mkdir(parents=True, exist_ok=True)
    print(
        f"✅ deck '{key}' criado\n   JSON:   {notes.relative_to(project.root)}\n   Mídias: {project.media_dir(key).relative_to(project.root)}/"
    )
    return 0


def main(argv: list[str] | None = None, project: Project | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="cards",
        description="Criador e Auditor de Flashcards Médicos (Doutrina Internato-First)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    # Permite tema direto como argumento posicional: cards "asma"
    parser.add_argument(
        "query",
        nargs="?",
        help="Tema médico entre aspas (ex.: 'asma', 'apendicite', 'tep') ou caminho de PDF para buscar e gerar o deck automaticamente",
    )
    target = parser.add_mutually_exclusive_group(required=False)
    target.add_argument(
        "--deck",
        action="append",
        metavar="CHAVE",
        help="deck a processar (pode repetir)",
    )
    target.add_argument(
        "--all", action="store_true", help="todos os decks com enabled = true"
    )
    target.add_argument(
        "--create-deck", metavar="CHAVE", help="cria um deck novo em decks.toml"
    )
    target.add_argument(
        "--list", action="store_true", help="lista os decks configurados"
    )

    parser.add_argument(
        "--title",
        help="nome do deck no Anki (com --create-deck ou geração direta), ex.: '5º Ano::Clínica::Tema'",
    )
    parser.add_argument(
        "--chat",
        action="store_true",
        help="inicia o REPL conversacional do Agy Clínico (Gemini 4 Argon) restrito a flashcards e medicina",
    )
    parser.add_argument(
        "-p",
        "--prompt",
        metavar="INSTRUCAO",
        help="executa uma instrução em linguagem natural (criação, revisão, desmembramento ou auditoria de cards)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="só valida, não gera o .apkg (ou gera rascunho sem sync)",
    )
    parser.add_argument(
        "--structural",
        action="store_true",
        help="valida apenas estrutura, sintaxe e regras editoriais (não exige acervo de PDFs e mídias em disco)",
    )
    parser.add_argument(
        "--strict", action="store_true", help="avisos de estilo também bloqueiam"
    )
    parser.add_argument(
        "--sync-only", action="store_true",
        help="importa o último .apkg publicado de um deck, sem gerar outro pacote",
    )
    parser.add_argument(
        "--anki-sync",
        action="store_true",
        help="importa o .apkg no Anki via AnkiConnect",
    )
    parser.add_argument(
        "--pull-anki",
        "--pull",
        action="store_true",
        help="consulta o Anki Desktop via AnkiConnect e atualiza o JSON local com eventuais edições manuais feitas no Anki (Question, Answer, Hint, tags)",
    )
    parser.add_argument(
        "--prefer-anki",
        action="store_true",
        help="em caso de conflito entre notas já revisadas no Anki e o JSON local, adota automaticamente a versão do Anki Desktop",
    )
    parser.add_argument(
        "--preview",
        "--studio",
        action="store_true",
        help="inicia o Sidecar Visual Zero-Dependency (Cards Studio) em http://localhost:8766",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8766,
        help="porta local para o servidor de preview (padrão: 8766)",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="lista cada aviso individualmente"
    )

    # Opções do pipeline automatizado
    parser.add_argument(
        "--mode",
        choices=["flash", "hybrid", "argon"],
        default="flash",
        help="arquitetura de IA: 'flash' (padrão: 100%% Gemini 3.8 Flash High), 'hybrid' (Flash Draft + Flash Preceptor)",
    )
    parser.add_argument(
        "--tts",
        action="store_true",
        help="sintetiza micro-áudios neurais (PT-BR) para cards estratégicos",
    )
    parser.add_argument(
        "--budget",
        choices=["low", "medium", "high"],
        default="high",
        help="budget de raciocínio do Argon (padrão: high)",
    )
    parser.add_argument(
        "--max-images", type=int, default=15, help="máximo de figuras a extrair do PDF"
    )
    parser.add_argument(
        "--no-images", action="store_true", help="desativa extração de figuras"
    )
    parser.add_argument(
        "-a",
        "--all-docs",
        action="store_true",
        help="seleciona e mescla todos os documentos encontrados no baralho",
    )
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="seleciona automaticamente o documento sem confirmação",
    )
    parser.add_argument(
        "--no-sync",
        action="store_true",
        help="não sincroniza com o Anki Desktop após o build",
    )
    parser.add_argument(
        "--no-telegram", action="store_true", help="não envia notificação no Telegram"
    )

    args = parser.parse_args(argv)
    project = project or Project()

    if args.sync_only and (
        not args.deck or len(args.deck) != 1
        or args.query or args.check or args.no_sync or args.anki_sync
    ):
        parser.error("--sync-only requer um único --deck e não pode ser combinado com --check ou opções de sincronização")

    if args.structural and not args.check:
        print(
            "❌ --structural só é permitido em conjunto com --check (a geração de .apkg exige mídias reais em disco)"
        )
        return 1

    query_cmd = (args.query or "").strip().lower()

    # Modo Sidecar Visual Zero-Dependency (Cards Studio / Preview)
    if args.preview or query_cmd in ("preview", "studio"):
        from criador_cards import preview
        target_deck = args.deck[0] if args.deck else None
        preview.run_preview_server(project=project, deck_key=target_deck, port=args.port)
        return 0

    if args.create_deck:
        return create_deck(project, args.create_deck, args.title)

    if args.list:
        try:
            decks = project.load_decks()
        except (OSError, ValueError, tomllib.TOMLDecodeError) as exc:
            print(f"❌ decks.toml: {exc}")
            return 1
        for key, deck in decks.items():
            path = project.notes_path(key)
            count = (
                len(json.loads(path.read_text(encoding="utf-8")))
                if path.exists()
                else 0
            )
            print(
                f"{'●' if deck.get('enabled', True) else '○'} {key:<40} {count:>4} notas  {deck['deck_name']}"
            )
        return 0

    if args.all or args.deck:
        try:
            decks = project.load_decks()
        except (OSError, ValueError, tomllib.TOMLDecodeError) as exc:
            print(f"❌ decks.toml: {exc}")
            return 1
        keys = (
            [k for k, d in decks.items() if d.get("enabled", True)]
            if args.all
            else (args.deck or [])
        )
        unknown = [k for k in keys if k not in decks]
        if unknown:
            print(f"❌ deck(s) não encontrado(s) em decks.toml: {', '.join(unknown)}")
            return 1
        if args.sync_only:
            deck = decks[keys[0]]
            package = project.apkg_path(deck)
            if not package.is_file():
                print(f"❌ Pacote para sincronizar não encontrado: {package}", file=sys.stderr)
                return 1
            notes_p = project.notes_path(keys[0])
            notes = (
                json.loads(notes_p.read_text(encoding="utf-8"))
                if notes_p.is_file()
                else None
            )
            _, media = (
                lint.lint_deck(notes, project.media_dir(keys[0]))
                if notes
                else ([], set())
            )
            registry = anki.GuidRegistry(project.registry)
            try:
                try:
                    total = anki.sync_package(
                        package,
                        deck["deck_name"],
                        notes=notes,
                        deck_key=keys[0],
                        deck_id=deck["deck_id"],
                        media_dir=project.media_dir(keys[0]),
                        media_files=media,
                        registry=registry,
                        json_path=notes_p,
                        prefer_anki=getattr(args, "prefer_anki", False),
                    )
                except TypeError:
                    total = anki.sync_package(package, deck["deck_name"])
            except Exception as exc:
                print(f"❌ Falha ao sincronizar {package}: {exc}", file=sys.stderr)
                return 1
            print(f"✅ Deck sincronizado in-place ({total} notas no deck): {package}")
            return 0

        if args.pull_anki:
            registry = anki.GuidRegistry(project.registry)
            for key in keys:
                deck = decks[key]
                notes_p = project.notes_path(key)
                if not notes_p.is_file():
                    print(f"⚠️ JSON local para '{key}' não encontrado: {notes_p}")
                    continue
                print(f"📥 Puxando edições manuais do Anki Desktop para '{key}' ({deck['deck_name']})...")
                res = anki.pull_deck_from_anki(
                    deck_name=deck["deck_name"],
                    notes_path=notes_p,
                    registry=registry,
                )
                print(
                    f"   ✅ {res['updated']} nota(s) atualizada(s) localmente "
                    f"(total local: {res['total_local']} | Anki: {res['total_anki']})"
                )
            return 0

        # Validação de Colisão Global de IDs entre baralhos ativos
        global_ids: dict[int, str] = {}
        has_id_collision = False
        for k in keys:
            if not decks[k].get("enabled", True):
                continue
            np = project.notes_path(k)
            if not np.is_file():
                continue
            try:
                content = json.loads(np.read_text(encoding="utf-8-sig"))
                if isinstance(content, list):
                    for note in content:
                        if isinstance(note, dict) and isinstance(note.get("id"), int):
                            nid = note["id"]
                            if nid in global_ids:
                                print(
                                    f"❌ ERRO FATAL: Colisão global de ID {nid} entre decks '{global_ids[nid]}' e '{k}'!",
                                    file=sys.stderr,
                                )
                                has_id_collision = True
                            else:
                                global_ids[nid] = k
            except Exception:
                pass
        if has_id_collision:
            print("⛔ Execução abortada devido a colisão de IDs entre decks ativos.", file=sys.stderr)
            return 1

        registry = anki.GuidRegistry(project.registry)
        results = [
            process_deck(project, key, decks[key], registry, args) for key in keys
        ]
        print(
            f"\n{'✅' if all(results) else '⛔'} {sum(results)}/{len(results)} deck(s) OK"
        )
        return 0 if all(results) else 1

    # Modo Busca Direta & Execução no Agy CLI
    from criador_cards import agy_cli

    # 1. Instrução explícita via -p / --prompt
    if args.prompt:
        return agy_cli.run_agy(query_or_prompt=args.prompt, project_root=project.root)

    query = (args.query or "").strip()

    # 2. Modo Interativo ('cards', 'cards chat', 'cards --chat', 'cards agy' ou execução sem argumentos no terminal)
    if args.chat or query.lower() in ("chat", "repl", "agy", "argon", "wizard", "interativo") or (not query and sys.stdin.isatty()):
        return agy_cli.run_agy(interactive=True, project_root=project.root)

    if not query:
        parser.print_help()
        return 1

    # 3. Se a query for uma instrução em linguagem natural, aciona o Agy CLI no escopo médico
    if agy_cli.is_natural_language_request(query):
        return agy_cli.run_agy(query_or_prompt=query, project_root=project.root)

    from criador_cards import generator

    # 4. Caso seja um tema curto ou arquivo PDF, busca em 02_Capítulos_PDF
    pdf_candidate = Path(query)
    if not pdf_candidate.is_file() and project.sources_dir.is_dir():
        rel_cand = project.sources_dir / query
        if rel_cand.is_file():
            pdf_candidate = rel_cand

    target_pdfs: list[Path] = []
    if pdf_candidate.is_file() and pdf_candidate.suffix.lower() == ".pdf":
        target_pdfs = [pdf_candidate]
    else:
        # Busca semântica de alta precisão em 02_Capítulos_PDF
        print(f'🔍 Pesquisando documentos em 02_Capítulos_PDF/ para: "{query}"...')
        matches = generator.search_pdf_documents(query, project.sources_dir, top_k=5)
        if not matches:
            print(
                f"ℹ️  Nenhum PDF encontrado para '{query}' em 02_Capítulos_PDF/. "
                f"Acionando o Agy CLI (Doutrina Internato-First) no escopo médico..."
            )
            return agy_cli.run_agy(
                query_or_prompt=f"Crie flashcards de alto rendimento (Doutrina Internato-First) sobre o tema médico: {query}",
                project_root=project.root,
            )

        target_pdfs = generator.select_pdf_interactively(
            matches,
            query,
            project.sources_dir,
            auto_yes=args.yes,
            all_docs=args.all_docs,
        )
        if not target_pdfs:
            print("Operação cancelada pelo usuário.")
            return 0

    print(f"\n📄 Documento(s) selecionado(s) ({len(target_pdfs)}):")
    for idx, p in enumerate(target_pdfs, start=1):
        try:
            rel_path = p.relative_to(project.root)
        except ValueError:
            rel_path = p
        print(f"   {idx}. {rel_path}")

    # 3. Execução completa do pipeline
    try:
        report = generator.run_pipeline(
            pdf_paths=target_pdfs,
            deck_key=None,
            deck_title=args.title,
            mode=args.mode,
            tts=args.tts,
            max_images=args.max_images,
            no_images=args.no_images,
            budget=args.budget,
            anki_sync=(not args.no_sync and not args.check),
            send_telegram=(not args.no_telegram and not args.check),
        )
        mode_badges = {
            "hybrid": "HYBRID (Flash 3.8 Draft ➔ Flash 3.8 High Preceptor)",
            "argon": "FLASH HIGH (Redirecionado)",
            "flash": "PURE FLASH (100% Gemini 3.8 Flash High)",
        }
        print("\n" + "=" * 65)
        print(f"🎉 BARALHO ENTREGUE COM SUCESSO: {report.deck_title}")
        print(f"   • Modo de IA: {mode_badges.get(report.mode, report.mode)}")
        print(
            f"   • Notas: {report.total_notes} ({report.cloze_count} Cloze | {report.basic_count} Basic)"
        )
        print(
            f"   • Imagens: {report.linked_images} vinculadas ({report.extracted_images} extraídas)"
        )
        print(f"   • Áudios neurais: {report.generated_audios}")
        print(f"   • Arquivo: {report.apkg_path}")
        print(
            f"   • Anki Desktop: {'✅ Sincronizado' if report.anki_synced else '📁 Arquivado em .apkg'}"
        )
        print("=" * 65 + "\n")
        return 0
    except Exception as exc:
        print(f"\n❌ [ERRO] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
