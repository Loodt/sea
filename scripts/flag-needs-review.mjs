#!/usr/bin/env node
// One-shot: flag findings whose applied URL resolves but whose content doesn't
// fully match the claim (number mismatch, adjacent-topic paper, bundle attribution).
// These are blocked from auto-graduation by the needsReview guard in graduateFindings.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = path.resolve(process.argv[2] ?? ".");
const NOW = new Date().toISOString();

const flags = {
  "x-marketing-agent": {
    F041: "Buffer URL applied, but claim states '47% better' where Buffer's public figure is ~73.6% (Threads vs X). Verify the original Buffer study number.",
  },
  "herald-research": {
    F140: "Braze URL applied, but finding mis-attributes the Grubhub case to Salesforce and bundles three unrelated claims (McKinsey 60%+, Salesforce adoption, Grubhub 836% ROI). Split into separate findings per source.",
  },
  "sewage-gold": {
    F1045: "EPA URL applied, but claim's 14/43/42/1 disposal split doesn't match EPA 2022 data (56% land-applied / 16% incinerated / 24% landfilled / 3% monofill / 1% other). Update numbers or find the specific dataset that matches the claim.",
  },
  "total-value-recovery": {
    F912: "PMC8844229 URL applied, but that paper is about trace-metal soil enrichment near gold mine dumps — adjacent to but not the direct XRF basin-scale variability claim. Verify the exact source behind the SiO2/Al2O3/Fe2O3 numbers.",
  },
};

let total = 0;
for (const [project, byId] of Object.entries(flags)) {
  const file = path.join(REPO, "projects", project, "knowledge", "findings.jsonl");
  const raw = await readFile(file, "utf-8");
  const findings = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  let flagged = 0;
  for (const f of findings) {
    if (byId[f.id]) {
      f.needsReview = { reason: byId[f.id], flaggedAt: NOW };
      flagged++;
    }
  }

  const out = findings.map((f) => JSON.stringify(f)).join("\n") + "\n";
  await writeFile(file, out, "utf-8");
  console.log(`${project}: flagged ${flagged}`);
  total += flagged;
}

console.log(`\nTotal: ${total} findings flagged needs-review.`);
