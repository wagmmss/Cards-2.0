import os
import sys
from typing import Any


class TerminalUI:
    """
    Utilitário de estilização ANSI e componentes visuais (Unicode Box-Drawing)
    para interface de terminal de alto acabamento (High-Polish CLI).
    """

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    ITALIC = "\033[3m"
    CYAN = "\033[38;5;39m"
    TEAL = "\033[38;5;43m"
    GREEN = "\033[38;5;41m"
    YELLOW = "\033[38;5;214m"
    RED = "\033[38;5;196m"
    MAGENTA = "\033[38;5;141m"
    WHITE = "\033[97m"
    GRAY = "\033[38;5;245m"

    @classmethod
    def supports_color(cls, stream: Any = None) -> bool:
        if os.environ.get("NO_COLOR"):
            return False
        if os.environ.get("FORCE_COLOR"):
            return True
        target = stream if stream is not None else sys.stdout
        return bool(hasattr(target, "isatty") and target.isatty())

    @classmethod
    def style(cls, text: str, *codes: str, enabled: bool | None = None) -> str:
        use_color = cls.supports_color() if enabled is None else enabled
        if not use_color or not codes:
            return text
        return f"{''.join(codes)}{text}{cls.RESET}"

    @classmethod
    def banner(cls, enabled: bool | None = None) -> str:
        c = cls.supports_color() if enabled is None else enabled
        width = 78
        top = cls.style(f"╭{'─' * width}╮", cls.CYAN, enabled=c)
        bottom = cls.style(f"╰{'─' * width}╯", cls.CYAN, enabled=c)
        sep = cls.style(f"├{'─' * width}┤", cls.CYAN, enabled=c)

        title_raw = "  ⚕️  CRIADOR DE CARDS • MOTOR CIRÚRGICO GEMINI 4 ARGON"
        sub_raw = "  Doutrina Internato-First & R1 High-Yield • FSRS Safe • Strict Linter Gate"

        title_padded = title_raw.ljust(width - 1)
        sub_padded = sub_raw.ljust(width)

        line1 = (
            cls.style("│", cls.CYAN, enabled=c)
            + cls.style(title_padded, cls.BOLD, cls.WHITE, enabled=c)
            + cls.style("│", cls.CYAN, enabled=c)
        )
        line2 = (
            cls.style("│", cls.CYAN, enabled=c)
            + cls.style(sub_padded, cls.DIM, cls.TEAL, enabled=c)
            + cls.style("│", cls.CYAN, enabled=c)
        )
        return "\n".join([top, line1, sep, line2, bottom])

    @classmethod
    def step(
        cls,
        step_num: int,
        total_steps: int,
        icon: str,
        title: str,
        detail: str = "",
        stream: Any = None,
    ) -> None:
        out = stream if stream is not None else sys.stdout
        c = cls.supports_color(out)
        badge = cls.style(f"[{step_num}/{total_steps}]", cls.BOLD, cls.CYAN, enabled=c)
        title_str = cls.style(title, cls.BOLD, cls.WHITE, enabled=c)
        detail_str = f" {cls.style(f'({detail})', cls.DIM, cls.GRAY, enabled=c)}" if detail else ""
        print(f"  {badge} {icon}  {title_str}{detail_str}", file=out, flush=True)
