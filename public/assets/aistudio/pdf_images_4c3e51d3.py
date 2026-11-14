"""Extrai figuras de um PDF para a pasta de mídias de um deck.

Modos:
  # 1) imagens embutidas das páginas 12 e 14-15
  uv run cards-pdf "02_Capítulos_PDF/.../Apostila.pdf" -o "04_Mídias/puerperio" --pages 12,14-15
  # 2) página inteira renderizada
  uv run cards-pdf arquivo.pdf -o "04_Mídias/puerperio" --render-page 12 --name involucao_uterina
  # 3) recorte de uma área (coordenadas em pontos do PDF: pagina,x0,y0,x1,y1)
  uv run cards-pdf arquivo.pdf -o "04_Mídias/puerperio" --crop 12,40,90,560,420 --name balao_bakri

Use --name para dar um nome descritivo ao arquivo (sem extensão); sempre gera PNG.
"""

from __future__ import annotations

import argparse
import io
import math
import re
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageChops, ImageFilter, ImageStat


def is_clinically_informative_image(pil_img: Image.Image) -> bool:
    """Descarta ícones chapados, fundos quase uniformes ou banners sem textura clínica."""
    gray = pil_img.convert("L")
    stat = ImageStat.Stat(gray)
    # Imagens quase uniformes (std < 18) ou ícones vetoriais pobres em tons
    if stat.stddev[0] < 18.0:
        return False
    # Conta quantos níveis de cinza têm pelo menos 0.1% dos pixels
    hist = gray.histogram()
    total_px = gray.width * gray.height
    active_bins = sum(1 for count in hist if count > total_px * 0.001)
    return active_bins >= 12


def validate_page_number(page_no: int, max_page: int) -> int:
    if (
        isinstance(page_no, bool)
        or not isinstance(page_no, int)
        or page_no < 1
        or page_no > max_page
    ):
        raise ValueError(f"página {page_no} fora do intervalo válido (1..{max_page})")
    return page_no


def parse_pages(spec: str, max_page: int | None = None) -> list[int]:
    if not isinstance(spec, str) or not spec.strip():
        raise ValueError("especificação de páginas vazia")
    pages: list[int] = []
    for raw_part in spec.split(","):
        part = raw_part.strip()
        if not part:
            raise ValueError(f"especificação de páginas inválida: {spec!r}")
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
        if not m:
            raise ValueError(
                f"intervalo de páginas inválido: {part!r} (use inteiros >= 1, ex.: 3,5-7)"
            )
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) is not None else a
        if a < 1 or b < a:
            raise ValueError(
                f"intervalo de páginas inválido: {part!r} (exige 1 <= início <= fim)"
            )
        if max_page is not None and b > max_page:
            raise ValueError(f"página {b} fora do intervalo válido (1..{max_page})")
        pages.extend(range(a, b + 1))
    return pages


def parse_crop(
    spec: str, max_page: int
) -> tuple[int, tuple[float, float, float, float]]:
    parts = [p.strip() for p in (spec or "").split(",")]
    if len(parts) != 5 or not re.fullmatch(r"-?\d+", parts[0]):
        raise ValueError(
            "formato de --crop inválido: use pagina,x0,y0,x1,y1 com página inteira"
        )
    page_no = validate_page_number(int(parts[0]), max_page)
    coords = tuple(float(v) for v in parts[1:])
    x0, y0, x1, y1 = coords
    if (
        not all(math.isfinite(c) for c in coords)
        or x0 < 0
        or y0 < 0
        or x0 >= x1
        or y0 >= y1
    ):
        raise ValueError(
            "coordenadas de recorte inválidas: exige valores finitos >= 0 com x0 < x1 e y0 < y1"
        )
    return page_no, (x0, y0, x1, y1)


def get_visual_clusters(
    page: pymupdf.Page, merge_margin: float = 14.0
) -> list[pymupdf.Rect]:
    """Une retângulos de imagens embutidas com primitivas vetoriais (linhas, caixas, tabelas)
    via clustering espacial (margem de fusão de 14pt), ignorando fundos (> 80% da página)
    e linhas finas isoladas.
    """
    page_w, page_h = page.rect.width, page.rect.height
    total_page_area = page_w * page_h
    raw_rects: list[pymupdf.Rect] = []

    # 1. Imagens embutidas (bitmaps)
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        for r in page.get_image_rects(xref):
            if (
                r.width >= 40
                and r.height >= 30
                and (r.width * r.height) < total_page_area * 0.85
            ):
                raw_rects.append(pymupdf.Rect(r))

    # 2. Primitivas vetoriais (desenhos de tabelas, fluxogramas, caixas)
    try:
        drawings = page.get_drawings()
    except Exception:
        drawings = []

    for d in drawings:
        r = d.get("rect")
        if not r:
            continue
        rect = pymupdf.Rect(r)
        if rect.width < 12 and rect.height < 12:
            continue
        if (rect.width * rect.height) / total_page_area > 0.80:
            continue
        raw_rects.append(rect)

    if not raw_rects:
        return []

    # 3. Clustering espacial com margem de fusão
    clusters: list[pymupdf.Rect] = []
    for r in raw_rects:
        expanded_r = pymupdf.Rect(
            r.x0 - merge_margin,
            r.y0 - merge_margin,
            r.x1 + merge_margin,
            r.y1 + merge_margin,
        )
        merged = False
        for i, c in enumerate(clusters):
            expanded_c = pymupdf.Rect(
                c.x0 - merge_margin,
                c.y0 - merge_margin,
                c.x1 + merge_margin,
                c.y1 + merge_margin,
            )
            if expanded_r.intersects(expanded_c):
                clusters[i] = c | r
                merged = True
                break
        if not merged:
            clusters.append(pymupdf.Rect(r))

    changed = True
    while changed:
        changed = False
        new_clusters: list[pymupdf.Rect] = []
        skip: set[int] = set()
        for i in range(len(clusters)):
            if i in skip:
                continue
            ci = clusters[i]
            for j in range(i + 1, len(clusters)):
                if j in skip:
                    continue
                cj = clusters[j]
                exp_ci = pymupdf.Rect(
                    ci.x0 - merge_margin,
                    ci.y0 - merge_margin,
                    ci.x1 + merge_margin,
                    ci.y1 + merge_margin,
                )
                exp_cj = pymupdf.Rect(
                    cj.x0 - merge_margin,
                    cj.y0 - merge_margin,
                    cj.x1 + merge_margin,
                    cj.y1 + merge_margin,
                )
                if exp_ci.intersects(exp_cj):
                    ci = ci | cj
                    skip.add(j)
                    changed = True
            new_clusters.append(ci)
        clusters = new_clusters

    return [c for c in clusters if c.width >= 50 and c.height >= 40]


def autocrop(img: Image.Image, padding: int = 12, threshold: int = 18) -> Image.Image:
    """Remove margens uniformes amostrando a mediana das 4 bordas com Sanity Check anti-overcrop."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    if w < 40 or h < 40:
        return img

    border_pixels = (
        [rgb.getpixel((x, 0)) for x in range(0, w, max(1, w // 20))]
        + [rgb.getpixel((x, h - 1)) for x in range(0, w, max(1, w // 20))]
        + [rgb.getpixel((0, y)) for y in range(0, h, max(1, h // 20))]
        + [rgb.getpixel((w - 1, y)) for y in range(0, h, max(1, h // 20))]
    )
    r_med = sorted(p[0] for p in border_pixels)[len(border_pixels) // 2]
    g_med = sorted(p[1] for p in border_pixels)[len(border_pixels) // 2]
    b_med = sorted(p[2] for p in border_pixels)[len(border_pixels) // 2]

    bg = Image.new("RGB", rgb.size, (r_med, g_med, b_med))
    diff = ImageChops.difference(rgb, bg).convert("L")
    mask = diff.point(lambda v: 255 if v > threshold else 0).filter(ImageFilter.MaxFilter(3))
    box = mask.getbbox()
    if not box:
        return img

    x0, y0, x1, y1 = box
    cropped = img.crop(
        (
            max(0, x0 - padding),
            max(0, y0 - padding),
            min(w, x1 + padding),
            min(h, y1 + padding),
        )
    )
    if (cropped.width * cropped.height) < 0.15 * (w * h) or cropped.width < 120 or cropped.height < 90:
        return img
    return cropped


def save_png(img: Image.Image, path: Path, overwrite: bool, crop: bool) -> None:
    if path.exists() and not overwrite:
        raise FileExistsError(f"{path} já existe (use --overwrite)")
    path.parent.mkdir(parents=True, exist_ok=True)
    if crop:
        img = autocrop(img)
    img.save(path, "PNG", optimize=True)
    print(f"✅ {path}  ({img.width}x{img.height})")


def pixmap_to_image(pix: pymupdf.Pixmap) -> Image.Image:
    return Image.open(io.BytesIO(pix.tobytes("png")))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="cards-pdf",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("pdf", type=Path)
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="pasta de destino (04_Mídias/<deck>)",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--pages",
        help="páginas para extrair imagens embutidas, ex.: 3,5-7 (padrão: todas)",
    )
    mode.add_argument("--render-page", type=int, help="renderiza a página inteira")
    mode.add_argument(
        "--crop", help="recorta uma área: pagina,x0,y0,x1,y1 (pontos do PDF)"
    )
    parser.add_argument("--name", help="nome do arquivo de saída, sem extensão")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument(
        "--min-size",
        type=int,
        default=150,
        help="ignora imagens embutidas menores que isso (px)",
    )
    parser.add_argument(
        "--no-autocrop", action="store_true", help="não remove margens brancas"
    )
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args(argv)

    try:
        if args.dpi <= 0:
            raise ValueError("--dpi deve ser maior que zero")
        with pymupdf.open(args.pdf) as doc:
            stem = args.name or args.pdf.stem.replace(" ", "_")
            crop = not args.no_autocrop
            if args.render_page is not None or args.crop is not None:
                if args.crop is not None:
                    page_no, coords = parse_crop(args.crop, doc.page_count)
                    page = doc[page_no - 1]
                    clip = pymupdf.Rect(*coords) & page.rect
                    if clip.is_empty or clip.width < 1 or clip.height < 1:
                        raise ValueError("área de recorte vazia ou fora da página")
                    pix = page.get_pixmap(clip=clip, dpi=args.dpi)
                    name = args.name or f"{stem}_p{page_no}_recorte"
                else:
                    page_no = validate_page_number(args.render_page, doc.page_count)
                    pix = doc[page_no - 1].get_pixmap(dpi=args.dpi)
                    name = args.name or f"{stem}_p{page_no}"
                save_png(
                    pixmap_to_image(pix),
                    args.output / f"{name}.png",
                    args.overwrite,
                    crop,
                )
                return 0

            pages = (
                parse_pages(args.pages, doc.page_count)
                if args.pages is not None
                else list(range(1, doc.page_count + 1))
            )
            seen: set[int] = set()
            count = 0
            for page_no in pages:
                page = doc[page_no - 1]
                for index, info in enumerate(page.get_images(full=True), 1):
                    xref = info[0]
                    if xref in seen:
                        continue
                    seen.add(xref)
                    pix = pymupdf.Pixmap(doc, xref)
                    if pix.n - pix.alpha >= 4:  # CMYK -> RGB
                        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                    if (
                        min(pix.width, pix.height) < args.min_size
                        or max(pix.width, pix.height)
                        / max(1, min(pix.width, pix.height))
                        > 12
                    ):
                        continue
                    suffix = f"_{count + 1}" if args.name else f"_p{page_no}_{index}"
                    save_png(
                        pixmap_to_image(pix),
                        args.output / f"{stem}{suffix}.png",
                        args.overwrite,
                        crop,
                    )
                    count += 1
            print(f"{count} imagem(ns) extraída(s).")
            return 0
    except (OSError, ValueError, RuntimeError, IndexError) as exc:
        print(f"❌ {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
