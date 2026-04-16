// One-shot repair: fix invalid JSON escapes in a jsonl file.
// Detects backslashes that aren't followed by a valid JSON escape char
// ("/bfnrtu or another backslash) and doubles them.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/repair-jsonl.mjs <file>");
  process.exit(2);
}

const VALID_ESCAPE = /["\\/bfnrtu]/;

function repairLine(line) {
  let out = "";
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && (i === 0 || line[i - 1] !== "\\" || isEscapedBackslash(line, i - 1))) {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch === "\\") {
      const next = line[i + 1];
      if (!next || !VALID_ESCAPE.test(next)) {
        out += "\\\\";
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function isEscapedBackslash(line, idx) {
  let count = 0;
  while (idx >= 0 && line[idx] === "\\") {
    count++;
    idx--;
  }
  return count % 2 === 0;
}

const lines = readFileSync(file, "utf-8").split(/\r?\n/);
let repaired = 0;
for (let i = 0; i < lines.length; i++) {
  if (!lines[i]) continue;
  try {
    JSON.parse(lines[i]);
  } catch {
    const fixed = repairLine(lines[i]);
    try {
      JSON.parse(fixed);
    } catch (err) {
      console.error(`line ${i + 1}: still bad after repair: ${err.message}`);
      process.exit(3);
    }
    lines[i] = fixed;
    repaired++;
    console.log(`line ${i + 1}: repaired`);
  }
}

if (repaired === 0) {
  console.log("no repairs needed");
  process.exit(0);
}

writeFileSync(file, lines.join("\n"), "utf-8");
console.log(`repaired ${repaired} line(s) in ${file}`);
