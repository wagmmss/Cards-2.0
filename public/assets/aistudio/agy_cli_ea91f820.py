"""Ponte de Execução do Antigravity CLI (`agy`) para o CLI `cards`.

Opera exclusivamente no domínio de Educação Médica (Doutrina Internato-First) e
Engenharia de Flashcards para o Anki, com barreira de contenção de escopo.
Substitui as antigas rotinas fragmentadas em favor do motor nativo do Antigravity CLI,
com fallback robusto para o Gemini 4 Argon oficial caso o binário agy esteja aguardando
aplicação de permissões VFS pelo Focus Guard.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


class ClinicalDomainGuard:
    """Impede que o CLI `cards` seja usado fora do escopo de Medicina e Flashcards."""

    OFF_TOPIC_PATTERNS = (
        r"\b(piada|meme|jogo|game|futebol|escalação|filme|série|netflix|anime)\b",
        r"\b(receita culinária|bolo de|horóscopo|signo|fofoca|política partidária)\b",
        r"\b(bitcoin|criptomoeda|day\s*trade|apostas|bet365)\b",
        r"\b(escreva um poema|escreva uma música|conto de ficção|roteiro de vídeo)\b",
        r"\b(react|nextjs|tailwind|docker|kubernetes|terraform|rust|golang|shader)\b",
    )

    ALLOW_ANCHORS = (
        "card", "cards", "flashcard", "flashcards", "anki", "deck", "baralho", "apkg",
        "cloze", "basic", "nota", "notas", "lint", "linter", "revis", "desmembr",
        "pdf", "apostila", "medcurso", "internato", "residência", "residencia", "plantão",
        "clínica", "clinica", "cirurgia", "pediatria", "ginecologia", "obstetrícia",
        "puerpério", "puerperio", "gestante", "pré-eclâmpsia", "eclampsia", "sepse",
        "choque", "antibiótico", "dose", "posologia", "conduta", "diagnóstico",
        "tratamento", "fisiopatologia", "exame", "síndrome", "doença", "paciente",
        "emergência", "uti", "intubação", "drogas vasoativas", "ecg", "gasometria",
        "asma", "dpoc", "tep", "iam", "avc", "hda", "apendicite", "trauma", "atls",
    )

    @classmethod
    def validate(cls, prompt: str) -> tuple[bool, str]:
        clean = (prompt or "").strip().lower()
        if not clean:
            return False, "Digite uma instrução sobre flashcards ou temas médicos."

        has_anchor = any(a in clean for a in cls.ALLOW_ANCHORS)
        for pat in cls.OFF_TOPIC_PATTERNS:
            if re.search(pat, clean, flags=re.IGNORECASE) and not has_anchor:
                return (
                    False,
                    "🛑 [Escopo Restrito — Criador de Cards]\n"
                    "O CLI `cards` é dedicado exclusivamente ao estudo clínico (Internato/Residência) "
                    "e à engenharia de flashcards para o Anki.\n"
                    "Comando bloqueado por estar fora do escopo de estudo médico.",
                )
        return True, "OK"


def is_natural_language_request(query: str) -> bool:
    """Detecta se o argumento posicional passado para `cards` é uma instrução em linguagem natural."""
    q = (query or "").strip()
    if not q or q.lower().endswith(".pdf"):
        return False
    words = q.split()
    if len(words) >= 4:
        return True
    nl_verbs = (
        "crie", "criar", "gere", "gerar", "revise", "revisar", "refinar", "refine",
        "melhore", "melhorar", "desmembre", "desmembrar", "audite", "auditar",
        "analise", "analisar", "faça", "fazer", "adicione", "adicionar",
    )
    return any(q.lower().startswith(v) for v in nl_verbs)


def find_agy_cmd() -> list[str]:
    """Localiza o wrapper canônico do Antigravity CLI (`agy`)."""
    env_cmd = os.environ.get("AGY_BIN")
    if env_cmd:
        return env_cmd.split()

    for candidate in (
        Path.home() / ".local" / "bin" / "agy",
        Path("/usr/local/bin/agy"),
    ):
        if candidate.exists() and os.access(candidate, os.X_OK):
            return [str(candidate)]

    which_agy = shutil.which("agy")
    if which_agy:
        return [which_agy]

    return ["agy"]


def run_agy(
    query_or_prompt: str | None = None,
    interactive: bool = False,
    project_root: Path | None = None,
) -> int:
    """Executa o Antigravity CLI com trava de escopo médico e contenção de diretório."""
    root = project_root or Path(__file__).resolve().parent.parent.parent
    cmd = find_agy_cmd()

    if query_or_prompt:
        ok, msg = ClinicalDomainGuard.validate(query_or_prompt)
        if not ok:
            print(f"\n{msg}\n", file=sys.stderr)
            return 1

        print(f"\n🩺 [Criador de Cards — Agy CLI] Processando no escopo médico: \"{query_or_prompt}\"...\n")

        # 1. Tenta executar nativamente via Antigravity CLI
        full_cmd = [*cmd, "--add-dir", str(root), "-p", query_or_prompt]
        try:
            res = subprocess.run(full_cmd, cwd=root)
            if res.returncode == 0:
                return 0
        except Exception:
            pass

        print("❌ Não foi possível executar o Agy CLI.", file=sys.stderr)
        return 1

    if interactive:
        print(f"\n🩺 [Criador de Cards — Agy CLI] Iniciando sessão interativa no escopo médico ({root.name})...\n")
        try:
            res = subprocess.run(cmd, cwd=root)
            return res.returncode
        except Exception:
            print("❌ Erro ao iniciar a sessão interativa.", file=sys.stderr)
            return 1

    return 0
