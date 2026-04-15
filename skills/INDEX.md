# SEA Skills Index

Reusable tools the SEA conductor and pipeline experts can invoke. Each skill is a self-contained CLI wrapper with a stable interface.

**Conventions:**
- Skills are CLI scripts. Invoke via `python skills/<name>/<script>.py [args]`.
- Each skill folder has its own `README.md` with usage and dependencies.
- Each skill writes to stdout by default; `--output <path>` writes to a file.
- New skills are added by: (1) creating `skills/<name>/`, (2) writing the script + README, (3) adding a row to the table below, (4) listing dependencies.

## Skills

| Skill | Purpose | Command | Dependencies |
|-------|---------|---------|--------------|
| `markitdown` | Convert any document (PDF/EPUB/MOBI/DOCX/PPTX/XLSX/HTML/images/audio) to Markdown | `python skills/markitdown/convert.py <input> [-o out.md]` | `markitdown[pdf,docx,outlook,audio-transcription]`, `mobi`, `pytesseract`+Tesseract (for scanned PDFs), MAESTRO `ocr.py` |

## When to use which

| You need to... | Use |
|---|---|
| Convert a single PDF/EPUB/MOBI/DOCX/HTML/image to markdown for ingestion | `markitdown` |
| OCR a scanned PDF specifically | `markitdown` (auto-falls-back to MAESTRO `ocr.py`) |

## Why this exists

Lesson from the jarvis-architecture book-extraction work (2026-04-13): SEA was rebuilding format-specific extraction pipelines instead of reaching for the universal converter. `markitdown` is the canonical doc → markdown layer; downstream code should never know what format the source was. Future skills (web fetcher, audio transcriber, etc.) follow the same single-interface principle.

## Reference: MAESTRO skills

Many higher-level skills already exist in MAESTRO's `~/maestro/skills/` (browser-use, pencilpusher, export-docx/pptx, outlook-draft, etc.). When SEA needs one of these, prefer to invoke the MAESTRO script directly via subprocess rather than re-implementing. See `C:/Users/mtlb/maestro/skills/INDEX.md` for the full list.
