"""Gera um micro-áudio (MP3, voz neural PT-BR) para um card. Máximo de 1 áudio por card.

  uv run cards-audio "Texto estilo passagem de plantão" -o "04_Mídias/puerperio/hpp_conduta.mp3"

No hint, use: <audio controls preload="none" class="med-audio"><source src="hpp_conduta.mp3" type="audio/mpeg"></audio>
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

VOICES = ["pt-BR-AntonioNeural", "pt-BR-FranciscaNeural"]


async def synthesize_speech(
    text: str, output: Path, voice: str = VOICES[0], rate: str = "+0%"
) -> None:
    import edge_tts

    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(".tmp.mp3")
    await edge_tts.Communicate(text=text.strip(), voice=voice, rate=rate).save(str(tmp))
    if tmp.stat().st_size == 0:
        raise RuntimeError("áudio gerado vazio")
    tmp.replace(output)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="cards-audio",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("text")
    parser.add_argument("-o", "--output", type=Path, required=True)
    parser.add_argument("--voice", choices=VOICES, default=VOICES[0])
    parser.add_argument("--rate", default="+0%", help="velocidade, ex.: +5%%")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args(argv)
    if args.output.exists() and not args.overwrite:
        print(f"❌ {args.output} já existe (use --overwrite)")
        return 1
    try:
        asyncio.run(synthesize_speech(args.text, args.output, args.voice, args.rate))
    except Exception as exc:
        print(f"❌ falha ao gerar áudio: {exc}")
        return 1
    print(f"✅ {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
