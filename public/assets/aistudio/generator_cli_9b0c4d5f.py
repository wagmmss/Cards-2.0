from __future__ import annotations

import argparse
import sys
from pathlib import Path

from criador_cards import generator


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="cards-auto",
        description="Pipeline End-to-End: extrai mídias, gera cards via arquitetura híbrida (Flash 3.8 + Argon 4), valida e entrega o deck pronto no Anki.",
    )
    parser.add_argument(
        "pdf",
        help="Caminho do arquivo PDF médico ou tema para busca direta (ex.: 'asma', 'apendicite')",
    )
    parser.add_argument("--deck", help="Chave identificadora do deck (snake_case)")
    parser.add_argument(
        "--title", help="Título hierárquico no Anki, ex.: '5º Ano::Clínica::Tema'"
    )
    parser.add_argument(
        "--mode",
        choices=["flash", "hybrid", "argon"],
        default="flash",
        help="Arquitetura de execução de IA: 'flash' (padrão: 100%% Flash 3.8 High), 'hybrid' (Flash Draft + Flash Preceptor)",
    )
    parser.add_argument(
        "--budget",
        choices=["low", "medium", "high"],
        default="high",
        help="Budget de raciocínio do Argon (padrão: high)",
    )
    parser.add_argument(
        "--max-images",
        type=int,
        default=15,
        help="Máximo de figuras a extrair do PDF (padrão: 15)",
    )
    parser.add_argument(
        "--no-images", action="store_true", help="Desativa a extração de figuras do PDF"
    )
    parser.add_argument(
        "--tts",
        action="store_true",
        help="Gera micro-áudios neurais para cards estratégicos",
    )
    parser.add_argument(
        "-a",
        "--all-docs",
        action="store_true",
        help="Seleciona e mescla todos os documentos encontrados no baralho",
    )
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Seleciona automaticamente o documento sem confirmação",
    )
    parser.add_argument(
        "--no-sync",
        action="store_true",
        help="Não sincroniza com o Anki Desktop após o build",
    )
    parser.add_argument(
        "--no-telegram", action="store_true", help="Não envia notificação no Telegram"
    )

    args = parser.parse_args(argv)

    pdf_candidate = Path(args.pdf)
    if not pdf_candidate.is_file() and (generator.ROOT / "02_Capítulos_PDF").is_dir():
        rel_cand = generator.ROOT / "02_Capítulos_PDF" / args.pdf
        if rel_cand.is_file():
            pdf_candidate = rel_cand

    if pdf_candidate.is_file() and pdf_candidate.suffix.lower() == ".pdf":
        target_pdfs = [pdf_candidate]
    else:
        # Busca semântica
        print(f'🔍 Pesquisando documentos em 02_Capítulos_PDF/ para: "{args.pdf}"...')
        matches = generator.search_pdf_documents(args.pdf, generator.ROOT / "02_Capítulos_PDF", top_k=5)
        if not matches:
            print(
                f"\n❌ Nenhum documento PDF encontrado para o tema '{args.pdf}' em 02_Capítulos_PDF/.",
                file=sys.stderr,
            )
            return 1
        target_pdfs = generator.select_pdf_interactively(
            matches,
            args.pdf,
            generator.ROOT / "02_Capítulos_PDF",
            auto_yes=args.yes,
            all_docs=args.all_docs,
        )
        if not target_pdfs:
            print("Operação cancelada pelo usuário.")
            return 0

    try:
        report = generator.run_pipeline(
            pdf_paths=target_pdfs,
            deck_key=args.deck,
            deck_title=args.title,
            mode=args.mode,
            tts=args.tts,
            max_images=args.max_images,
            no_images=args.no_images,
            budget=args.budget,
            anki_sync=not args.no_sync,
            send_telegram=not args.no_telegram,
        )
        print("\n" + "=" * 65)
        print(f"🎉 DECK ENTREGUE COM SUCESSO: {report.deck_title}")
        print(
            f"   • Notas: {report.total_notes} ({report.cloze_count} Cloze | {report.basic_count} Basic)"
        )
        print(
            f"   • Imagens: {report.linked_images} vinculadas ({report.extracted_images} extraídas)"
        )
        print(f"   • Áudios neurais: {report.generated_audios}")
        print(f"   • Arquivo: {report.apkg_path}")
        print(
            f"   • Anki Desktop: {'Sincronizado' if report.anki_synced else 'Pendente (salvo em disco)'}"
        )
        print("=" * 65 + "\n")
        return 0
    except Exception as exc:
        print(f"\n❌ [ERRO] {exc}", file=sys.stderr)
        return 1
