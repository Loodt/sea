#!/usr/bin/env python3
"""SEA skill — universal document → Markdown converter.

Wraps Microsoft's `markitdown` library with two extensions:
  1. MOBI support (markitdown does not handle MOBI natively) — pre-converted
     via the `mobi` library to a temp EPUB, then fed to markitdown.
  2. Scanned-PDF fallback — when markitdown extracts <500 chars from a PDF,
     re-run via MAESTRO's `ocr.py --mode ocr` (Tesseract) for true OCR.

This is the canonical document-ingestion layer for SEA. Downstream code
(research experts, knowledge curation, reference library builds) should
never call format-specific extractors directly.

Usage:
    python skills/markitdown/convert.py INPUT [--output OUT] [--no-ocr-fallback]

Prints the converted markdown to stdout by default. With `--output PATH`,
writes to that path and prints a status line to stderr.

Exit codes:
    0  ok
    1  conversion failed
    2  bad arguments / missing input
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

MAESTRO_OCR = Path(r"C:/Users/mtlb/maestro/skills/ocr/ocr.py")
MIN_BODY_CHARS = 500


def convert(path: Path, *, allow_ocr: bool = True) -> str:
    ext = path.suffix.lower().lstrip(".")
    if ext == "mobi":
        return _mobi_to_md(path)
    text = _markitdown(path)
    if ext == "pdf" and allow_ocr and len(text.strip()) < MIN_BODY_CHARS:
        print(f"[markitdown got {len(text.strip())} chars; OCR fallback]", file=sys.stderr)
        text = _ocr_pdf(path)
    return text


def _markitdown(path: Path) -> str:
    from markitdown import MarkItDown
    md = MarkItDown()
    return md.convert(str(path)).text_content or ""


def _mobi_to_md(path: Path) -> str:
    import mobi
    tmp_dir, file_path = mobi.extract(str(path))
    try:
        return _markitdown(Path(file_path))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _ocr_pdf(path: Path) -> str:
    if not MAESTRO_OCR.exists():
        raise RuntimeError(f"MAESTRO ocr.py not found at {MAESTRO_OCR}")
    cmd = [sys.executable, str(MAESTRO_OCR), str(path), "--mode", "ocr", "--dpi", "300"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"MAESTRO ocr.py exit={r.returncode}: {r.stderr.strip()[:500]}")
    return r.stdout


def main() -> int:
    ap = argparse.ArgumentParser(description="Universal document → Markdown converter")
    ap.add_argument("input", type=Path, help="document path (PDF/EPUB/MOBI/DOCX/PPTX/XLSX/HTML/images/audio)")
    ap.add_argument("-o", "--output", type=Path, default=None, help="write markdown to this path (default: stdout)")
    ap.add_argument("--no-ocr-fallback", action="store_true", help="disable OCR fallback for low-text PDFs")
    args = ap.parse_args()

    if not args.input.exists():
        print(f"error: input not found: {args.input}", file=sys.stderr)
        return 2

    try:
        body = convert(args.input, allow_ocr=not args.no_ocr_fallback)
    except Exception as e:
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(body, encoding="utf-8")
        print(f"wrote {len(body):,} chars -> {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(body)

    return 0


if __name__ == "__main__":
    sys.exit(main())
