import sys
from pathlib import Path

NEVER_SHOW_NAMES = {".env", ".DS_Store"}
NEVER_SHOW_SUFFIXES = {".pem", ".key"}
NOISE_SUFFIXES = {".pyo", ".pyc"}


def _find_project_root() -> Path:
    prefix = Path(sys.prefix)
    if sys.prefix != sys.base_prefix and prefix.name in {".venv", "venv"}:
        return prefix.parent.resolve()
    else:
        raise NotImplementedError("Expected to run in a python project with a .venv")


PROJECT_ROOT = _find_project_root()


def safe_path(path: str) -> Path | None:
    "Resolve path inside the project, or return None if it escapes."
    p = (PROJECT_ROOT / path).resolve()
    return p if p.is_relative_to(PROJECT_ROOT) else None


def keep(e: Path, suffixes: set[str] | None, skip: set[str]) -> bool:
    if e.is_symlink() and not e.resolve().is_relative_to(PROJECT_ROOT):
        return False
    if e.is_dir():
        return e.name not in skip
    if (
        e.name in NEVER_SHOW_NAMES
        or e.suffix.lower() in NEVER_SHOW_SUFFIXES | NOISE_SUFFIXES
    ):
        return False
    return suffixes is None or e.suffix.lower() in suffixes


def walk(
    d: Path,
    depth: int,
    lines: list[str],
    max_depth: int,
    suffixes: set[str] | None,
    skip: set[str],
):
    entries = sorted(
        (e for e in d.iterdir() if keep(e, suffixes, skip)),
        key=lambda p: (p.is_file(), p.name),
    )
    for e in entries:
        lines.append(f"{' ' * depth}{e.name}{'/' if e.is_dir() else ''}")
        if e.is_dir():
            if depth < max_depth:
                walk(e, depth + 1, lines, max_depth, suffixes, skip)
            else:
                n = sum(1 for o in e.iterdir() if keep(o, suffixes, skip))
                lines.append(f"{'  ' * (depth + 1)}… ({n} items)")


def file_iterator(root: Path, suffixes: set[str] | None, skip: set[str]):
    "Yield files under root (or root itself), pruning excluded folders."
    if root.is_file():
        if keep(root, suffixes, skip):
            yield root
        return
    for dirpath, dirnames, filenames in root.walk():
        dirnames[:] = sorted(d for d in dirnames if keep(dirpath / d, None, skip))
        for f in sorted(filenames):
            p = dirpath / f
            if keep(p, suffixes, skip):
                yield p
