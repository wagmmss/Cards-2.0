from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Sequence

from criador_cards.refiner import (
    PASTE_CANCEL_MARKERS,
    PASTE_END_MARKERS,
    CardRefiner,
    DeckCatalogEntry,
    MutationRecord,
    SurgicalReport,
    _merge_cards_preserving_fsrs,
    discover_available_decks,
    extract_pasted_payload,
    parse_pasted_cards,
    resolve_deck_target,
    strip_html_tags,
)
from criador_cards.terminal import TerminalUI


def show_preview(
    before: list[dict[str, Any]],
    after: list[dict[str, Any]],
    mutations: list[MutationRecord],
) -> None:
    original = {card.get("id"): card for card in before if card.get("id") is not None}
    revised = {card["id"]: card for card in after}
    print("\nPrévia das mudanças nas notas")
    changed = False
    for mutation in mutations:
        old = original.get(mutation.original_id)
        if (
            old == revised.get(mutation.original_id)
            and len(mutation.new_ids) == 1
            and not mutation.used_local_fallback
        ):
            continue
        changed = True
        print(f"\nNota #{mutation.original_id}" if old else "\nNova nota")
        if mutation.used_local_fallback:
            print("  Resposta da IA ausente ou incompleta. Usado o refinamento local.")
        for index, note_id in enumerate(mutation.new_ids):
            if old and index == 0:
                label = f"Mantém o histórico da nota #{mutation.original_id}"
            else:
                label = f"Nova nota #{note_id}, sem histórico"
            print(f"  {label}")
            for field, title in (
                ("question", "Pergunta"), ("answer", "Resposta"),
                ("sources", "Fontes"), ("hint", "Comentário"),
                ("topic", "Tópico"), ("tags", "Tags"),
                ("type", "Tipo"), ("exam_refs", "Questões"),
                ("image_mode", "Modo de imagem"),
            ):
                previous = old.get(field) if old else None
                current = revised[note_id].get(field)
                if previous != current or (field in {"question", "answer", "sources"} and len(mutation.new_ids) > 1):
                    print(f"    {title}")
                    print(f"      Antes: {json.dumps(previous, ensure_ascii=False)}")
                    print(f"      Depois: {json.dumps(current, ensure_ascii=False)}")
    for removed in original.keys() - revised.keys():
        changed = True
        print(f"  Nota #{removed} ausente no candidato. Antes: {original[removed]['question']}")
    if not changed:
        print("  Nenhuma alteração nas notas.")


def _format_surgical_report(
    report: SurgicalReport, use_color: bool | None = None
) -> str:
    """
    Formata o Relatório Cirúrgico Final utilizando caracteres de desenho de caixa
    Unicode (Box-Drawing) e cores ANSI (quando em terminal interativo), mantendo
    todas as chaves de auditoria para compatibilidade com scripts e testes.
    """
    c = TerminalUI.supports_color() if use_color is None else use_color
    width = 78

    border_top = TerminalUI.style(f"╭{'─' * width}╮", TerminalUI.CYAN, enabled=c)
    border_sep = TerminalUI.style(f"├{'─' * width}┤", TerminalUI.CYAN, enabled=c)
    border_bot = TerminalUI.style(f"╰{'─' * width}╯", TerminalUI.CYAN, enabled=c)
    v_bar = TerminalUI.style("│", TerminalUI.CYAN, enabled=c)

    def _box_line(content: str, color_codes: tuple[str, ...] = ()) -> str:
        raw_padded = content[:width].ljust(width)
        styled = TerminalUI.style(raw_padded, *color_codes, enabled=c) if color_codes else raw_padded
        return f"{v_bar}{styled}{v_bar}"

    header_title = f"=== Relatório Cirúrgico Gemini 4 Argon [{report.deck_key}] ==="
    gate_ok = report.linter_errors == 0 and not report.violations_after

    lines: list[str] = [
        border_top,
        _box_line(f"  {header_title}", (TerminalUI.BOLD, TerminalUI.WHITE)),
        border_sep,
        _box_line(f"  Cards Entrada : {report.input_count}"),
        _box_line(f"  Cards Saída   : {report.output_count}"),
        _box_line(f"  Refinados 1->1: {report.in_place_refinements}"),
        _box_line(f"  Splits 1->N   : {report.split_operations}"),
        _box_line(f"  Inalterados   : {report.unchanged_count}"),
        _box_line(
            f"  Violações Pré : {json.dumps(report.violations_before, ensure_ascii=False)}",
            (TerminalUI.YELLOW,) if report.violations_before else (TerminalUI.DIM,),
        ),
        _box_line(
            f"  Violações Pós : {json.dumps(report.violations_after, ensure_ascii=False)}",
            (TerminalUI.GREEN,) if not report.violations_after else (TerminalUI.RED,),
        ),
        _box_line(
            f"  Linter Gate   : {report.linter_errors} erro(s), {report.linter_warnings} aviso(s)",
            (TerminalUI.BOLD, TerminalUI.GREEN) if gate_ok else (TerminalUI.BOLD, TerminalUI.RED),
        ),
    ]

    if report.mutations:
        lines.append(border_sep)
        lines.append(
            _box_line(
                "  Tabela de Mutações Cirúrgicas (FSRS ID Safe):",
                (TerminalUI.BOLD, TerminalUI.TEAL),
            )
        )
        max_rows = 12
        for mut in report.mutations[:max_rows]:
            ids_str = ", ".join(str(i) for i in mut.new_ids)
            if len(ids_str) > 22:
                ids_str = ids_str[:19] + "..."
            act_badge = {
                "UNCHANGED": "[OK 1->1]",
                "REFINED_IN_PLACE": "[REF 1->1]",
                "SPLIT_1_TO_N": f"[SPLIT 1->{len(mut.new_ids)}]",
            }.get(mut.action, f"[{mut.action}]")
            audio_icon = "♪" if mut.audio_generated else "-"
            row_text = (
                f"    #{mut.original_id:<13} -> [{ids_str:<22}] "
                f"{act_badge:<12} Mídia:{mut.media_status[:10]:<10} Áudio:{audio_icon}"
            )
            lines.append(_box_line(row_text))
        if len(report.mutations) > max_rows:
            remaining = len(report.mutations) - max_rows
            lines.append(_box_line(f"    ... e mais {remaining} card(s) processado(s).", (TerminalUI.DIM,)))

    on_demand = [
        m for m in report.media_resolutions if m.status == "ON_DEMAND_REQUIRED"
    ]
    if on_demand or report.apkg_path or report.anki_synced:
        lines.append(border_sep)
    if on_demand:
        lines.append(
            _box_line(
                f"  Mídias On-Demand Requeridas: {[m.card_id for m in on_demand]}",
                (TerminalUI.YELLOW,),
            )
        )
    if report.apkg_path:
        lines.append(
            _box_line(f"  Pacote .apkg  : {report.apkg_path}", (TerminalUI.GREEN,))
        )
    if report.anki_synced:
        lines.append(
            _box_line("  AnkiConnect   : Sincronizado com sucesso", (TerminalUI.GREEN,))
        )

    if report.publication_error:
        lines.append(_box_line(f"  Falha na publicação: {report.publication_error}", (TerminalUI.RED,)))

    if report.linter_messages:
        lines.append(border_sep)
        lines.append(_box_line("  --- Detalhes do Linter ---", (TerminalUI.BOLD, TerminalUI.YELLOW)))
        for msg in report.linter_messages:
            color = (TerminalUI.RED,) if "[ERRO]" in msg else (TerminalUI.YELLOW,)
            lines.append(_box_line(f"  {msg}", color))

    lines.append(border_bot)
    if report.publication_error and report.apkg_path and not report.anki_synced:
        lines.append(f"Para retomar: uv run cards --deck {report.deck_key} --sync-only")
    return "\n".join(lines)


def _run_interactive_paste_flow(
    project_root: Path,
    preset_key: str | None = None,
    merge_flag: bool = False,
) -> tuple[str, str, list[dict[str, Any]], Path | None] | None:
    """
    Conduz a experiência interativa de colagem direta de cards no terminal.
    Retorna `(deck_key, deck_title, cards_para_refinar, output_json_path)` ou `None` se cancelado.
    """
    c = TerminalUI.supports_color()

    # Se STDIN não for um TTY (ex: `cat cards.json | ./refine paste`), lê tudo diretamente
    if not sys.stdin.isatty():
        raw_piped = sys.stdin.read()
        if not raw_piped.strip():
            print("Erro: Nenhum card recebido via entrada padrão.", file=sys.stderr)
            return None
        cards, inf_key, inf_title = extract_pasted_payload(raw_piped)
        final_key = preset_key or inf_key or "deck_colado"
        final_title = inf_title or final_key.replace("_", " ").title()
        out_path = project_root / "data" / "decks" / f"{final_key}_notes.json"
        return final_key, final_title, cards, out_path

    print()
    print(
        TerminalUI.style(
            "╭──────────────────────────────────────────────────────────────────────────────╮",
            TerminalUI.CYAN,
            enabled=c,
        )
    )
    print(
        TerminalUI.style(
            "│  📋 MODO DE COLAGEM DIRETA DE CARDS (JSON / MARKDOWN / TEXTO)                │",
            TerminalUI.BOLD,
            TerminalUI.WHITE,
            enabled=c,
        )
    )
    print(
        TerminalUI.style(
            "├──────────────────────────────────────────────────────────────────────────────┤",
            TerminalUI.CYAN,
            enabled=c,
        )
    )
    print(
        TerminalUI.style(
            "│  • Cole abaixo um JSON ([...] ou {...}), bloco ```json ... ``` do chat,      │",
            TerminalUI.TEAL,
            enabled=c,
        )
    )
    print(
        TerminalUI.style(
            "│    ou texto ('Pergunta: ... / Resposta: ...' ou frases com '{{c1::...}}').   │",
            TerminalUI.TEAL,
            enabled=c,
        )
    )
    print(
        TerminalUI.style(
            "│  • Para CONCLUIR: digite FIM em uma linha vazia e pressione Enter (ou Ctrl+D)│",
            TerminalUI.BOLD,
            TerminalUI.YELLOW,
            enabled=c,
        )
    )
    print(
        TerminalUI.style(
            "│  • Para CANCELAR: digite CANCELAR (ou pressione Ctrl+C)                      │",
            TerminalUI.DIM,
            TerminalUI.GRAY,
            enabled=c,
        )
    )
    print(
        TerminalUI.style(
            "╰──────────────────────────────────────────────────────────────────────────────╯",
            TerminalUI.CYAN,
            enabled=c,
        )
    )
    print(
        TerminalUI.style(
            "Cole os cards abaixo (aguardando entrada...):",
            TerminalUI.BOLD,
            TerminalUI.CYAN,
            enabled=c,
        )
    )

    collected_lines: list[str] = []
    try:
        while True:
            line = input()
            stripped_upper = line.strip().upper()
            if stripped_upper in PASTE_CANCEL_MARKERS:
                print(TerminalUI.style("\n✖ Colagem cancelada pelo usuário.", TerminalUI.YELLOW, enabled=c))
                return None
            if stripped_upper in PASTE_END_MARKERS:
                break
            collected_lines.append(line)
    except EOFError:
        pass
    except KeyboardInterrupt:
        print(TerminalUI.style("\n✖ Colagem interrompida.", TerminalUI.YELLOW, enabled=c))
        return None

    raw_pasted = "\n".join(collected_lines).strip()
    if not raw_pasted:
        print(TerminalUI.style("⚠ Nenhum conteúdo foi colado.", TerminalUI.YELLOW, enabled=c), file=sys.stderr)
        return None

    try:
        pasted_cards, inferred_key, inferred_title = extract_pasted_payload(raw_pasted)
    except ValueError as exc:
        print(TerminalUI.style(f"✖ Erro ao interpretar cards colados: {exc}", TerminalUI.RED, enabled=c), file=sys.stderr)
        return None

    first_q = strip_html_tags(str(pasted_cards[0].get("question") or ""))[:65]
    print(
        TerminalUI.style(
            f"\n✔ {len(pasted_cards)} card(s) reconhecido(s) com sucesso! "
            f"(Ex: \"{first_q}...\")",
            TerminalUI.BOLD,
            TerminalUI.GREEN,
            enabled=c,
        )
    )

    default_key = preset_key or inferred_key or "deck_colado"
    if not preset_key:
        try:
            key_prompt = TerminalUI.style(
                f"Chave ou sigla do deck de destino [Enter = {default_key}]: ",
                TerminalUI.BOLD,
                TerminalUI.CYAN,
                enabled=c,
            )
            user_key = input(key_prompt).strip()
        except (EOFError, KeyboardInterrupt):
            user_key = ""
        target_query = user_key or default_key
    else:
        target_query = preset_key

    resolved_key, _, resolved_title = resolve_deck_target(target_query, project_root)
    if inferred_title and resolved_key == default_key and not preset_key:
        resolved_title = inferred_title

    dest_json_path = project_root / "data" / "decks" / f"{resolved_key}_notes.json"
    final_cards = pasted_cards

    if dest_json_path.is_file() and not merge_flag:
        try:
            existing_raw = json.loads(dest_json_path.read_text(encoding="utf-8"))
            existing_cards = CardRefiner._extract_notes_list(existing_raw)
        except Exception:
            existing_cards = []

        if existing_cards:
            try:
                mode_prompt = TerminalUI.style(
                    f"O deck '{resolved_key}' já possui {len(existing_cards)} card(s). "
                    "[M] Mesclar/atualizar (padrão) | [S] Substituir tudo | [N] Novo arquivo isolado: ",
                    TerminalUI.YELLOW,
                    enabled=c,
                )
                mode_choice = input(mode_prompt).strip().lower()
            except (EOFError, KeyboardInterrupt):
                mode_choice = "m"

            if mode_choice in {"n", "novo"}:
                ts_suffix = int(time.time())
                resolved_key = f"{resolved_key}_{ts_suffix}"
                dest_json_path = project_root / "data" / "decks" / f"{resolved_key}_notes.json"
            elif mode_choice not in {"s", "substituir", "replace"}:
                final_cards = _merge_cards_preserving_fsrs(existing_cards, pasted_cards)
                print(
                    TerminalUI.style(
                        f"  ↳ Mesclando: {len(pasted_cards)} colado(s) + {len(existing_cards)} existente(s) -> {len(final_cards)} card(s) totais.",
                        TerminalUI.TEAL,
                        enabled=c,
                    )
                )
    elif dest_json_path.is_file() and merge_flag:
        try:
            existing_raw = json.loads(dest_json_path.read_text(encoding="utf-8"))
            existing_cards = CardRefiner._extract_notes_list(existing_raw)
            final_cards = _merge_cards_preserving_fsrs(existing_cards, pasted_cards)
        except Exception:
            pass

    return resolved_key, resolved_title, final_cards, dest_json_path


def _prompt_interactive_deck_selection(
    project_root: Path,
) -> tuple[str, list[DeckCatalogEntry]]:
    """
    Exibe o menu interativo de alto acabamento para escolha rápida de:
    - [1..N] Deck específico
    - [P]    Colar cards diretamente no terminal
    - [A]    Refinar todos os decks em lote
    - [Q]    Sair
    Retorna `(modo, lista_de_decks)`, onde `modo` é `"DECKS"`, `"PASTE"` ou `"CANCEL"`.
    """
    c = TerminalUI.supports_color()
    catalog = [e for e in discover_available_decks(project_root) if e.notes_path.is_file()]
    if not catalog:
        catalog = discover_available_decks(project_root)

    print()
    print(TerminalUI.banner(enabled=c))

    if catalog:
        print(
            TerminalUI.style(
                "\n  #    CHAVE DO DECK                           CARDS       ÁREA / TÍTULO",
                TerminalUI.BOLD,
                TerminalUI.CYAN,
                enabled=c,
            )
        )
        print(TerminalUI.style(f"  {'─' * 76}", TerminalUI.DIM, TerminalUI.CYAN, enabled=c))
        for idx, entry in enumerate(catalog, start=1):
            num_badge = TerminalUI.style(f"[{idx:2d}]", TerminalUI.BOLD, TerminalUI.CYAN, enabled=c)
            key_str = TerminalUI.style(f"{entry.key:<38}", TerminalUI.WHITE, enabled=c)
            count_raw = f"{entry.note_count:>3d} cards" if entry.note_count else "sem notas"
            count_color = TerminalUI.GREEN if entry.note_count > 0 else TerminalUI.GRAY
            count_str = TerminalUI.style(f"{count_raw:<11}", count_color, enabled=c)
            meta = f"{entry.area} • {entry.title}" if entry.area else entry.title
            meta_str = TerminalUI.style(meta[:22], TerminalUI.DIM, TerminalUI.GRAY, enabled=c)
            print(f"  {num_badge} {key_str} {count_str} {meta_str}")

    print(TerminalUI.style(f"\n  {'─' * 76}", TerminalUI.DIM, TerminalUI.CYAN, enabled=c))
    print(
        "  "
        + TerminalUI.style("[ P]", TerminalUI.BOLD, TerminalUI.YELLOW, enabled=c)
        + TerminalUI.style(
            " 📋 Colar cards diretamente no terminal (JSON, Markdown ou Texto)",
            TerminalUI.BOLD,
            TerminalUI.WHITE,
            enabled=c,
        )
    )
    print(
        "  "
        + TerminalUI.style("[ A]", TerminalUI.BOLD, TerminalUI.GREEN, enabled=c)
        + " 🚀 Refinar TODOS os decks com notas existentes em lote"
    )
    print(
        "  "
        + TerminalUI.style("[ Q]", TerminalUI.BOLD, TerminalUI.RED, enabled=c)
        + " ✖  Cancelar e sair\n"
    )

    try:
        prompt_str = TerminalUI.style(
            "❯ Escolha [1..N, sigla ex: has/puerp, P = colar cards, A = todos, Q = sair]: ",
            TerminalUI.BOLD,
            TerminalUI.CYAN,
            enabled=c,
        )
        choice = input(prompt_str).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return "CANCEL", []

    if not choice or choice.lower() in {"q", "quit", "exit", "sair"}:
        return "CANCEL", []

    if choice.lower() in {"p", "paste", "colar", "v"}:
        return "PASTE", []

    if choice.lower() in {"a", "all", "todos", "*"}:
        return "DECKS", [e for e in catalog if e.notes_path.is_file()]

    if choice.isdigit():
        num = int(choice)
        if 1 <= num <= len(catalog):
            return "DECKS", [catalog[num - 1]]
        print(f"Erro: opção '{num}' fora do intervalo (1..{len(catalog)}).", file=sys.stderr)
        return "CANCEL", []

    resolved_key, _, resolved_title = resolve_deck_target(choice, project_root)
    for entry in catalog:
        if entry.key == resolved_key:
            return "DECKS", [entry]

    return "DECKS", [
        DeckCatalogEntry(
            key=resolved_key,
            title=resolved_title,
            notes_path=project_root / "data" / "decks" / f"{resolved_key}_notes.json",
        )
    ]


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="./refine",
        description=(
            "Refinador cirúrgico de flashcards médicos (Gemini 4 Argon).\n"
            "Exemplos rápidos:\n"
            "  ./refine                  (abre menu interativo com opção de colar ou escolher deck)\n"
            "  ./refine paste            (cola cards diretamente no terminal via JSON/Markdown/Texto)\n"
            "  ./refine puerperio        (refina, gera .apkg e sincroniza com Anki)\n"
            "  ./refine has              (resolve sigla -> hipertensao_arterial_sistemica)\n"
            "  ./refine meus_cards.json  (refina diretamente um arquivo JSON)\n"
            "  ./refine all              (refina todos os decks existentes)"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "target",
        nargs="?",
        default=None,
        help="Chave do deck, sigla médica (ex: has, ist), 'paste' (colar), 'all', ou caminho .json.",
    )
    parser.add_argument(
        "-p",
        "--paste",
        action="store_true",
        help="Abre o modo interativo para colar cards diretamente no terminal (JSON, Markdown ou Texto).",
    )
    parser.add_argument(
        "--merge",
        action="store_true",
        help="No modo colagem (--paste), mescla os cards colados com o deck existente preservando IDs FSRS.",
    )
    parser.add_argument(
        "-k",
        "--key",
        type=str,
        default=None,
        help="Chave identificadora do deck (ex: hipertensao_arterial_sistemica).",
    )
    parser.add_argument(
        "-i",
        "--input-json",
        type=Path,
        default=None,
        help="Caminho de arquivo JSON de entrada contendo as notas.",
    )
    parser.add_argument(
        "--stdin",
        action="store_true",
        help="Lê o JSON ou texto de entrada diretamente da entrada padrão (STDIN).",
    )
    parser.add_argument(
        "-o",
        "--output-json",
        type=Path,
        default=None,
        help="Caminho do arquivo JSON de saída.",
    )
    parser.add_argument(
        "-a",
        "--all",
        action="store_true",
        help="Refina todos os decks disponíveis em data/decks/.",
    )
    parser.add_argument(
        "--build-apkg",
        action="store_true",
        help="Compila o pacote .apkg em 01_Decks_Anki/ após o refinamento.",
    )
    parser.add_argument(
        "--no-apkg",
        action="store_true",
        help="Desativa a compilação automática do pacote .apkg no modo rápido.",
    )
    parser.add_argument(
        "--anki-sync",
        "--sync",
        dest="anki_sync",
        action="store_true",
        help="Sincroniza o deck diretamente com o Anki Desktop via AnkiConnect.",
    )
    parser.add_argument(
        "--no-sync",
        action="store_true",
        help="Desativa a sincronização automática com o Anki Desktop no modo rápido.",
    )
    parser.add_argument(
        "--no-audio",
        action="store_true",
        help="Desativa a síntese de áudio via edge-tts.",
    )
    parser.add_argument(
        "-c",
        "--check-only",
        action="store_true",
        help="Executa apenas a auditoria diagnóstica sem alterar arquivos.",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Imprime exclusivamente o JSON refinado puro na saída padrão (STDOUT).",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Autoriza aplicar o candidato sem pedir confirmação no terminal.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    refiner = CardRefiner()
    stdin_cards: list[dict[str, Any]] | None = None

    if args.stdin:
        raw_stdin = sys.stdin.read().strip()
        if not raw_stdin:
            print("Erro: STDIN vazio ao usar --stdin.", file=sys.stderr)
            return 2
        try:
            parsed_stdin = json.loads(raw_stdin)
            stdin_cards = refiner._extract_notes_list(parsed_stdin)
        except Exception:
            stdin_cards = parse_pasted_cards(raw_stdin)

    is_paste_mode = args.paste or (
        isinstance(args.target, str)
        and args.target.strip().lower() in {"paste", "colar"}
    )

    is_all_decks = args.all or (
        isinstance(args.target, str)
        and args.target.strip().lower() in {"all", "todos", "*"}
    )

    selected_entries: list[DeckCatalogEntry] = []
    used_ergonomic_shortcut = bool(args.target or args.all or is_paste_mode)

    if (
        not is_paste_mode
        and not is_all_decks
        and args.target is None
        and args.key is None
        and args.input_json is None
        and not args.stdin
    ):
        if sys.stdin.isatty() and not args.raw:
            used_ergonomic_shortcut = True
            mode, selected_entries = _prompt_interactive_deck_selection(refiner.project_root)
            if mode == "CANCEL":
                return 0
            if mode == "PASTE":
                is_paste_mode = True
        else:
            args.key = "deck_refinado"

    auto_productive_defaults = (
        used_ergonomic_shortcut and not args.raw and not args.check_only
    )
    if args.raw and is_paste_mode:
        parser.error("Use --stdin --raw para processar conteúdo colado sem prompts")
    if args.raw and (args.build_apkg or args.anki_sync or args.output_json):
        parser.error("--raw não pode ser combinado com publicação")
    should_build_apkg = (
        False
        if args.no_apkg
        else (args.build_apkg or auto_productive_defaults)
    )
    should_anki_sync = (
        False
        if args.no_sync
        else (args.anki_sync or (auto_productive_defaults and not args.no_apkg))
    )
    show_verbose_steps = bool(sys.stdout.isatty() and not args.raw)

    if args.apply and (args.raw or args.check_only):
        parser.error("--apply não pode ser combinado com --raw ou --check-only")

    def approve(
        before: list[dict[str, Any]],
        after: list[dict[str, Any]],
        mutations: list[MutationRecord],
    ) -> bool:
        if args.raw:
            return False
        show_preview(before, after, mutations)
        if args.apply:
            return True
        if sys.stdin.isatty() and not args.stdin:
            actions = "gravar o JSON"
            if should_build_apkg or should_anki_sync:
                actions += ", compilar o .apkg"
            if should_anki_sync:
                actions += " e importar no Anki"
            try:
                if input(f"Aplicar as mudanças, {actions}? [s/N] ").strip().lower() in {"s", "sim"}:
                    return True
            except (EOFError, KeyboardInterrupt):
                pass
        print("Prévia encerrada sem aplicar.")
        return False

    # Fluxo de colagem direta no terminal (`./refine paste`, `./refine -p` ou opção `[P]` do menu)
    if is_paste_mode:
        paste_result = _run_interactive_paste_flow(
            project_root=refiner.project_root,
            preset_key=args.key,
            merge_flag=args.merge,
        )
        if paste_result is None:
            return 1 if not sys.stdin.isatty() else 0
        pasted_key, pasted_title, pasted_cards, default_out_path = paste_result
        final_out_path = args.output_json or default_out_path

        if show_verbose_steps:
            print()

        refined_cards, report = refiner.run(
            deck_key=pasted_key,
            cards=pasted_cards,
            output_json=final_out_path,
            deck_title=pasted_title,
            enable_audio=not args.no_audio,
            build_apkg=should_build_apkg,
            anki_sync=should_anki_sync,
            check_only=args.check_only,
            persist=not args.raw,
            verbose=show_verbose_steps,
            approve=approve,
        )

        if args.raw:
            sys.stdout.write(
                json.dumps(refined_cards, ensure_ascii=False, indent=2) + "\n"
            )
        else:
            if show_verbose_steps:
                print()
            print(_format_surgical_report(report))

        if args.check_only and (
            report.linter_errors > 0 or bool(report.violations_before)
        ):
            return 1
        return 0 if report.linter_errors == 0 and not report.publication_error else 1

    if is_all_decks:
        selected_entries = [
            e
            for e in discover_available_decks(refiner.project_root)
            if e.notes_path.is_file()
        ]
        if not selected_entries:
            print("Erro: nenhum deck com notas encontrado em data/decks/.", file=sys.stderr)
            return 1

    if selected_entries and args.raw:
        parser.error("--raw requer um único deck ou arquivo de entrada")
    if selected_entries:
        overall_exit = 0
        for idx, entry in enumerate(selected_entries, start=1):
            if len(selected_entries) > 1 and not args.raw:
                print(
                    f"\n[{idx}/{len(selected_entries)}] Refinando '{entry.key}' ({entry.title})..."
                )
            elif show_verbose_steps:
                print()
            _, report = refiner.run(
                deck_key=entry.key,
                deck_title=entry.title,
                input_json=entry.notes_path if entry.notes_path.is_file() else None,
                output_json=args.output_json if len(selected_entries) == 1 else None,
                enable_audio=not args.no_audio,
                build_apkg=should_build_apkg,
                anki_sync=should_anki_sync,
                check_only=args.check_only,
                persist=True,
                verbose=show_verbose_steps,
                approve=approve,
            )
            if show_verbose_steps:
                print()
            print(_format_surgical_report(report))
            if args.check_only and (
                report.linter_errors > 0 or bool(report.violations_before)
            ):
                overall_exit = 1
            elif report.linter_errors > 0 or report.publication_error:
                overall_exit = 1
        return overall_exit

    # Resolução de alvo único (via argumento posicional `target` ou flags `--key` / `--input-json`)
    resolved_key = args.key or "deck_refinado"
    resolved_input_json = args.input_json
    resolved_title = ""

    if args.target:
        t_key, t_input_json, t_title = resolve_deck_target(
            args.target, refiner.project_root
        )
        if args.key is None:
            resolved_key = t_key
        if args.input_json is None and t_input_json is not None:
            resolved_input_json = t_input_json
        resolved_title = t_title
    elif args.key:
        t_key, _, t_title = resolve_deck_target(args.key, refiner.project_root)
        resolved_key = t_key
        resolved_title = t_title
    elif args.input_json is not None and args.key is None:
        stem = args.input_json.stem
        resolved_key = stem[: -len("_notes")] if stem.endswith("_notes") else stem

    persist_default = not args.raw

    if show_verbose_steps:
        print(TerminalUI.banner())
        print()

    refined_cards, report = refiner.run(
        deck_key=resolved_key,
        cards=stdin_cards,
        input_json=resolved_input_json,
        output_json=args.output_json,
        deck_title=resolved_title,
        enable_audio=not args.no_audio,
        build_apkg=should_build_apkg,
        anki_sync=should_anki_sync,
        check_only=args.check_only,
        persist=persist_default,
        verbose=show_verbose_steps,
        approve=approve,
    )

    if args.raw:
        sys.stdout.write(
            json.dumps(refined_cards, ensure_ascii=False, indent=2) + "\n"
        )
    else:
        if show_verbose_steps:
            print()
        print(_format_surgical_report(report))

    if args.check_only and (
        report.linter_errors > 0 or bool(report.violations_before)
    ):
        return 1

    return 0 if report.linter_errors == 0 and not report.publication_error else 1
