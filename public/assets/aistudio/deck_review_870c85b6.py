"""Revisão editorial do conjunto de notas pelas frentes dos cards."""

from collections import defaultdict
from difflib import SequenceMatcher
from itertools import combinations
from typing import Any

from criador_cards import lint


def review_fronts(notes: list[dict[str, Any]]) -> str:
    """Agrupa objetivos por tópico e aponta semelhanças textuais para revisão."""
    topics: dict[str, list[str]] = defaultdict(list)
    fronts: list[tuple[int, str, tuple[str, ...]]] = []
    for note in notes:
        question = note["question"]
        front = lint.visible_text(question)
        targets = tuple(
            lint.visible_text(target.split("::")[0]).casefold()
            for _, target in lint.CLOZE.findall(question)
        )
        hidden = f" [lacuna: {', '.join(targets)}]" if targets else ""
        topics[note["topic"]].append(
            f"  #{note['id']} {front or '(frente com mídia)'}{hidden}"
        )
        fronts.append((note["id"], front.casefold(), targets))

    lines = ["Objetivos testados nas frentes"]
    for topic, entries in topics.items():
        lines.extend([f"{topic} ({len(entries)})", *entries])

    overlaps = []
    for (left_id, left, left_targets), (right_id, right, right_targets) in combinations(fronts, 2):
        if not left or not right or left_targets != right_targets:
            continue
        matcher = SequenceMatcher(None, left, right, autojunk=False)
        if matcher.quick_ratio() >= 0.85 and matcher.ratio() >= 0.85:
            overlaps.append(f"  #{left_id} e #{right_id}")
    if overlaps:
        lines.extend(["Possível sobreposição entre perguntas (revisão manual)", *overlaps])
    else:
        lines.append("Nenhuma pergunta sinalizada por semelhança textual.")
    return "\n".join(lines)
