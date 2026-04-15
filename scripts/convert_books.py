#!/usr/bin/env python3
"""Convert EPUB / MOBI / PDF books to markdown for the jarvis-architecture project.

Pipeline (do not bypass):
  EPUB        → markitdown directly (preserves headings, metadata)
  PDF         → markitdown; if extracted text < 500 chars OR <10% of pages had text,
                fall back to MAESTRO's ocr.py skill in --mode ocr
  MOBI        → mobi.extract() to a temp EPUB/HTML, then markitdown on that

Output: projects/jarvis-architecture/references/books/full/{slug}.md
Index:  projects/jarvis-architecture/references/books/INDEX.md
Dedup:  by the 32-hex content hash embedded in Anna's Archive filenames

Usage:
    python scripts/convert_books.py            # convert all (skip existing)
    python scripts/convert_books.py --force    # re-convert everything
    python scripts/convert_books.py --dry-run  # list only
    python scripts/convert_books.py --only PATTERN  # convert slugs matching PATTERN
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

# ---------- config ----------
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "projects" / "jarvis-architecture" / "references" / "books" / "full"
INDEX_PATH = OUT_DIR.parent / "INDEX.md"

MAESTRO_OCR = Path(r"C:/Users/mtlb/maestro/skills/ocr/ocr.py")

SOURCE_DIRS = [
    (Path(r"G:/My Drive/Jarvis/Christian Education Books"), "christian-education"),
    (Path(r"G:/My Drive/Jarvis/Educational Books"), "educational"),
    (Path(r"G:/My Drive/Jarvis/Eudcational Books -Entreprenerial"), "entrepreneurial"),
]

HASH_IN_NAME = re.compile(r"--\s*([0-9a-f]{32})\s*--", re.IGNORECASE)
MIN_BODY_CHARS = 500  # below this, treat extraction as failed


# ---------- model ----------
@dataclass
class BookSource:
    path: Path
    library: str  # christian-education | educational | entrepreneurial
    fmt: str  # epub | mobi | pdf
    file_hash: str

    @property
    def slug(self) -> str:
        title = self.path.stem.split(" -- ")[0]
        slug = re.sub(r"[^\w\s-]", "", title.lower())
        slug = re.sub(r"[\s_]+", "-", slug).strip("-")[:60]
        return f"{slug}-{self.file_hash[:8]}"


# ---------- discovery ----------
def collect_sources() -> list[BookSource]:
    out: list[BookSource] = []
    for src_dir, lib in SOURCE_DIRS:
        if not src_dir.exists():
            print(f"[WARN] source dir missing: {src_dir}", file=sys.stderr)
            continue
        for p in sorted(src_dir.iterdir()):
            ext = p.suffix.lower().lstrip(".")
            if ext not in {"epub", "mobi", "pdf"}:
                continue
            m = HASH_IN_NAME.search(p.name)
            file_hash = m.group(1).lower() if m else hashlib.sha256(p.name.encode()).hexdigest()
            out.append(BookSource(path=p, library=lib, fmt=ext, file_hash=file_hash))
    return out


def dedup(sources: list[BookSource]) -> list[BookSource]:
    seen: dict[str, BookSource] = {}
    for s in sources:
        if s.file_hash in seen:
            print(f"[DEDUP] {s.path.name[:70]}... duplicate of {seen[s.file_hash].path.name[:50]}...")
            continue
        seen[s.file_hash] = s
    return list(seen.values())


# ---------- extraction (markitdown is the backbone) ----------
def _markitdown_convert(path: Path) -> str:
    """Single source of truth for non-scanned conversion."""
    from markitdown import MarkItDown
    md = MarkItDown()
    result = md.convert(str(path))
    return result.text_content or ""


def extract_epub(p: Path) -> str:
    return _markitdown_convert(p)


def extract_pdf(p: Path) -> str:
    """Try markitdown (which uses pdfminer); if it returns no real text, OCR via MAESTRO skill."""
    text = _markitdown_convert(p)
    if len(text.strip()) >= MIN_BODY_CHARS:
        return text
    print(f"          [markitdown got {len(text.strip())} chars — invoking MAESTRO ocr.py --mode ocr]")
    return _ocr_pdf_via_maestro(p)


def extract_mobi(p: Path) -> str:
    """MOBI is not natively handled by markitdown; convert via the `mobi` lib first, then markitdown."""
    import mobi
    tmp_dir, file_path = mobi.extract(str(p))
    try:
        return _markitdown_convert(Path(file_path))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _ocr_pdf_via_maestro(p: Path) -> str:
    """Call MAESTRO's ocr.py skill in OCR mode and capture markdown to stdout."""
    if not MAESTRO_OCR.exists():
        raise RuntimeError(f"MAESTRO ocr.py not found at {MAESTRO_OCR}")
    cmd = [sys.executable, str(MAESTRO_OCR), str(p), "--mode", "ocr", "--dpi", "300"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"MAESTRO ocr.py exited {r.returncode}: {r.stderr.strip()[:500]}")
    return r.stdout


EXTRACTORS = {"pdf": extract_pdf, "epub": extract_epub, "mobi": extract_mobi}


# ---------- output ----------
def parse_filename_metadata(name: str) -> dict[str, str]:
    parts = [p.strip() for p in name.split(" -- ")]
    meta = {"title": parts[0] if parts else name}
    if len(parts) > 1: meta["author"] = parts[1]
    if len(parts) > 2: meta["publication"] = parts[2]
    if len(parts) > 3: meta["publisher"] = parts[3]
    for part in parts:
        if part.lower().startswith("isbn"):
            meta["isbn"] = part
    return meta


def _yaml_safe(s: str) -> str:
    return (s or "").replace('"', "'")


def write_markdown(src: BookSource, body: str) -> Path:
    meta = parse_filename_metadata(src.path.stem)
    out_path = OUT_DIR / f"{src.slug}.md"
    front = [
        "---",
        f'title: "{_yaml_safe(meta.get("title", ""))}"',
        f'author: "{_yaml_safe(meta.get("author", "unknown"))}"',
        f"library: {src.library}",
        f"source_format: {src.fmt}",
        f'source_filename: "{_yaml_safe(src.path.name)}"',
        f"file_hash: {src.file_hash}",
    ]
    if "publication" in meta: front.append(f'publication: "{_yaml_safe(meta["publication"])}"')
    if "publisher" in meta:   front.append(f'publisher: "{_yaml_safe(meta["publisher"])}"')
    if "isbn" in meta:        front.append(f'isbn: "{_yaml_safe(meta["isbn"])}"')
    front.append(f"chars: {len(body)}")
    front.append("converter: markitdown+maestro-ocr")
    front.append("---")
    out_path.write_text("\n".join(front) + "\n\n" + body, encoding="utf-8")
    return out_path


def write_index(converted: list[tuple[BookSource, Path, int]], failed: list[tuple[BookSource, str]]) -> None:
    by_lib: dict[str, list[tuple[BookSource, Path, int]]] = {}
    for src, out, n in converted:
        by_lib.setdefault(src.library, []).append((src, out, n))

    lines = ["# Book Reference Library — Index", "",
             f"Total: {len(converted)} books across {len(by_lib)} libraries",
             "Converter: Microsoft markitdown (primary) + MAESTRO ocr.py (scanned PDF fallback)", ""]
    for lib in ("christian-education", "educational", "entrepreneurial"):
        items = by_lib.get(lib, [])
        if not items:
            continue
        lines.append(f"## {lib} ({len(items)})")
        lines.append("")
        for src, out, n in sorted(items, key=lambda x: x[1].name):
            meta = parse_filename_metadata(src.path.stem)
            lines.append(f"- [{meta.get('title','?')} — {meta.get('author','?')}](full/{out.name}) "
                         f"`{src.fmt}` `{n:,} chars`")
        lines.append("")

    if failed:
        lines.append("## Conversion failures")
        lines.append("")
        for src, err in failed:
            lines.append(f"- {src.path.name}: `{err}`")
        lines.append("")

    INDEX_PATH.write_text("\n".join(lines), encoding="utf-8")


# ---------- main ----------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="re-convert even if output exists")
    ap.add_argument("--only", default="", help="substring filter on slug")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sources = dedup(collect_sources())
    if args.only:
        sources = [s for s in sources if args.only.lower() in s.slug.lower()]
    if args.limit:
        sources = sources[: args.limit]
    print(f"[INFO] {len(sources)} books to process")

    converted: list[tuple[BookSource, Path, int]] = []
    failed: list[tuple[BookSource, str]] = []

    for i, src in enumerate(sources, 1):
        out_path = OUT_DIR / f"{src.slug}.md"
        if out_path.exists() and not args.force:
            n = len(out_path.read_text(encoding="utf-8", errors="replace"))
            print(f"[{i:02d}/{len(sources)}] SKIP {src.slug} ({n:,} chars on disk)")
            converted.append((src, out_path, n))
            continue
        if args.dry_run:
            print(f"[{i:02d}/{len(sources)}] DRY  {src.fmt:4s} {src.slug}")
            continue
        try:
            print(f"[{i:02d}/{len(sources)}] CONV {src.fmt:4s} {src.slug}", flush=True)
            body = EXTRACTORS[src.fmt](src.path)
            if not body or len(body.strip()) < MIN_BODY_CHARS:
                raise RuntimeError(f"body too short ({len(body.strip())} chars)")
            out = write_markdown(src, body)
            converted.append((src, out, len(body)))
            print(f"          -> {out.name}  ({len(body):,} chars)")
        except Exception as e:
            failed.append((src, str(e)))
            print(f"          !! FAIL: {e}", file=sys.stderr)

    if not args.dry_run:
        write_index(converted, failed)

    print(f"\n[DONE] converted={len(converted)} failed={len(failed)}")
    if failed:
        print("\nFAILURES:")
        for src, err in failed:
            print(f"  - {src.path.name[:80]}: {err}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
