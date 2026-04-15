# skill: markitdown

Universal document → Markdown conversion. Single interface for PDF, EPUB, MOBI, DOCX, PPTX, XLSX, HTML, images, audio.

## Why

Microsoft's [`markitdown`](https://github.com/microsoft/markitdown) is a one-library answer to the "extract text from anything" problem. SEA standardises on it for every document-ingestion path so downstream code never sees raw formats.

Two thin extensions are layered on top:

1. **MOBI pre-conversion** — markitdown doesn't handle MOBI natively. We use the `mobi` library to extract MOBI to a temp EPUB, then feed that to markitdown.
2. **Scanned-PDF OCR fallback** — when markitdown returns <500 chars from a PDF (image-only scan), the script re-runs the file through MAESTRO's `ocr.py --mode ocr` (Tesseract @ 300 DPI). Reuses the existing MAESTRO skill rather than reimplementing OCR.

## Install

```bash
pip install 'markitdown[pdf,docx,outlook,audio-transcription]' mobi pytesseract Pillow
winget install UB-Mannheim.TesseractOCR  # only needed for scanned PDFs
```

The MAESTRO `ocr.py` skill is expected at `C:/Users/mtlb/maestro/skills/ocr/ocr.py`. If you move MAESTRO, edit `MAESTRO_OCR` at the top of `convert.py`.

## Usage

```bash
# To stdout
python skills/markitdown/convert.py path/to/book.epub

# To a file
python skills/markitdown/convert.py path/to/scan.pdf -o output.md

# Disable OCR fallback (fast-fail on scanned PDFs)
python skills/markitdown/convert.py path/to/doc.pdf --no-ocr-fallback
```

## Programmatic use

```python
from pathlib import Path
import sys
sys.path.insert(0, "skills/markitdown")
from convert import convert

text = convert(Path("path/to/doc.pdf"))
```

## Exit codes

- `0` — ok
- `1` — conversion failed (read stderr for details)
- `2` — bad arguments / input not found

## What this is *not*

- Not for batch conversion — call once per file. Use a higher-level script for batching (see `scripts/convert_books.py` for an example pattern).
- Not a parser — output is plain markdown. Structure (headings, tables, lists) is preserved as markitdown produces it; semantic extraction is downstream.
- Not a search index — write the output to a file or store and let the consumer index it.

## Provenance

Created 2026-04-13 during the `jarvis-architecture` project's reference library build. Lesson: SEA was rebuilding per-format extractors instead of reaching for an existing universal layer. This skill prevents recurrence.
