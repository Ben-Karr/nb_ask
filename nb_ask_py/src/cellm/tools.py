import re
from pathlib import Path

import httpx
import trafilatura
from ddgs import DDGS

from .helpers import PROJECT_ROOT, file_iterator, safe_path, walk

MAX_DEPTH = 3
MAX_GREP_PER_FILE = 3
MAX_VIEW_LINES = 300
NOT_FOUND = "Not Found"
DEFAULT_EXCLUDE = [".venv", "venv", ".git", "__pycache__", "node_modules"]


def format_results(results):
    return "\n\n".join(
        f"[{i}] {r['title']}\n{r['href']}\n{r['body']}"
        for i, r in enumerate(results, 1)
    )


def web_search(
    query: str,  # Search query, 2-6 words
) -> str:
    "Search the web; returns title, URL, snippet per result. Snippets only, use web_fetch to read a page. Do not use if the answer is already in the conversation."
    results = DDGS().text(query, max_results=5)
    return format_results(results)


def web_fetch(
    url: str,  # Full URL including https://
) -> str:
    "Download one page and return its text. Use after web_search when snippets are not enough."
    r = httpx.get(url, timeout=10, follow_redirects=True)
    return (trafilatura.extract(r.text) or "")[:8000]


def tree(
    path: str = ".",  # Directory to list
    max_depth: int = 2,  # How many levels to descend, 3 at most
    exclude_folders: list[str]
    | None = None,  # Folder names to skip; default: .venv, venv, .git, __pycache__, node_modules. Pass [] to skip nothing
    include_suffix: list[str]
    | None = None,  # Only list files with these suffixes, e.g. ['.py', '.ipynb']. Default: all files
) -> str:
    "List the directory structure as a tree. Use first to get oriented in a project, before glob or grep."
    path = safe_path(path)
    max_depth = min(max_depth, MAX_DEPTH)
    root = Path(path)
    if not root.is_dir():
        return NOT_FOUND

    skip = set(DEFAULT_EXCLUDE if exclude_folders is None else exclude_folders)
    suffixes = {s.lower() for s in include_suffix} if include_suffix else None
    lines = [str(root) + "/"]

    walk(root, 1, lines, max_depth, suffixes, skip)
    return "\n".join(lines[:200])


def grep(
    pattern: str,  # Text or regex to search for (case-insensitive)
    path: str = ".",  # Folder or file to search
    exclude_folders: list[str]
    | None = None,  # Folder names to skip; default: .venv, venv, .git, __pycache__, node_modules. Pass [] to skip nothing
    include_suffix: list[str] | None = None,  # Only search these suffixes, e.g. ['.py']
    max_hits: int = 20,  # Maximum matching lines to return
) -> str:
    "Search file contents. Returns path:line: text, or NOT_FOUND. Use after tree to locate code, then view to read around a hit."
    root = safe_path(path)
    if root is None or not root.exists():
        return NOT_FOUND

    skip = set(DEFAULT_EXCLUDE if exclude_folders is None else exclude_folders)
    suffixes = {s.lower() for s in include_suffix} if include_suffix else None

    try:
        rx = re.compile(pattern, re.IGNORECASE)
    except re.error:
        rx = re.compile(re.escape(pattern), re.IGNORECASE)

    hits = []
    for p in file_iterator(root, suffixes, skip):
        if p.stat().st_size > 1_000_000:
            continue
        try:
            lines = p.read_text(encoding="utf-8").splitlines()
        except (UnicodeDecodeError, OSError):
            continue  # binary or unreadable
        rel, count = p.relative_to(PROJECT_ROOT).as_posix(), 0
        for n, line in enumerate(lines, 1):
            if rx.search(line):
                hits.append(f"{rel}:{n}: {line.strip()[:200]}")
                count += 1
                if count >= MAX_GREP_PER_FILE:
                    break
        if len(hits) >= max_hits:
            hits = hits[:max_hits] + ["… truncated, narrow with path or include_suffix"]
            break
    return "\n".join(hits) or NOT_FOUND


def view(
    path: str,  # File to read, relative to the project
    start_line: int = 1,  # First line to show (1-based)
    end_line: int
    | None = None,  # Last line to show; default: up to 300 lines from start_line
) -> str:
    "Read a file or line range with line numbers. Use after grep to read around a hit."
    p = safe_path(path)
    if p is None or not p.is_file() or not keep(p, None, set()):
        return NOT_FOUND
    if p.stat().st_size > 1_000_000:
        return "error: file too large, use grep to locate the part you need"
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
    except (UnicodeDecodeError, OSError):
        return NOT_FOUND
    n = len(lines)
    if not 1 <= start_line <= n:
        return f"error: start_line must be 1-{n}"
    end = min(end_line or n, n, start_line + MAX_VIEW_LINES - 1)
    out = [f"{i}: {l}" for i, l in enumerate(lines[start_line - 1 : end], start_line)]
    if end < n and (end_line is None or end < end_line):
        out.append(f"… {n - end} more lines, call again with start_line={end + 1}")
    return "\n".join(out)
