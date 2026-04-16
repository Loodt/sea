#!/usr/bin/env node
// One-shot data cleanup: apply researched URLs to SOURCE findings whose source
// was previously a bare label or bundle citation. Any remaining [SOURCE] without
// a valid http(s) URL will be demoted to [UNKNOWN] by enforceSourceUrls on the
// next conductor integration (or via `sea audit`).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = path.resolve(process.argv[2] ?? ".");

const updates = {
  "x-marketing-agent": {
    F040: "https://sproutsocial.com/insights/twitter-statistics/",
    F041: "https://buffer.com/resources/x-threads-bluesky-data/",
    F043: "https://backlinko.com/twitter-users",
    F044: "https://sproutsocial.com/insights/data/content-benchmarks/",
    F045: "https://www.pewresearch.org/journalism/2024/06/12/x-users-experiences-with-news/",
    F047: "https://buffer.com/resources/social-media-frequency-guide/",
    F048: "https://buffer.com/resources/links-on-x/",
    F050: "https://sproutsocial.com/insights/twitter-statistics/",
    F051: "https://sproutsocial.com/insights/social-media-benchmarks-by-industry/",
    F055: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12535035/",
  },
  "herald-research": {
    F133: "https://www.edelman.com/trust/2025/trust-barometer/special-report-health",
    F135: "https://www.warc.com/content/article/WARC-AWARDS-EFFECTIVENESS/CeraVe_Michael_CeraVe/158896",
    F140: "https://www.braze.com/customers/grubhub-onboarding-case-study",
  },
  "sewage-gold": {
    F1045: "https://www.epa.gov/system/files/documents/2025-01/draft-sewage-sludge-risk-assessment-pfoa-pfos.pdf",
  },
  "total-value-recovery": {
    F901: "https://www.saimm.co.za/Journal/v121n07p331.pdf",
    F902: "https://www.nature.com/articles/s41598-023-30219-5",
    F904: "https://www.sciencedirect.com/science/article/abs/pii/B978044463658400027X",
    F908: "https://www.nature.com/articles/s41598-023-30219-5",
    F909: "https://www.mdpi.com/2075-163X/10/5/448",
    F912: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8844229/",
    F1086: "https://www.researchgate.net/publication/238113097_Characterisation_of_cyanide_in_gold-mine_tailings_of_the_Witwatersrand",
  },
};

let totalApplied = 0;
let totalLeft = 0;

for (const [project, byId] of Object.entries(updates)) {
  const file = path.join(REPO, "projects", project, "knowledge", "findings.jsonl");
  const raw = await readFile(file, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);
  const findings = lines.map((l) => JSON.parse(l));

  let applied = 0;
  for (const f of findings) {
    if (byId[f.id]) {
      f.source = byId[f.id];
      applied++;
    }
  }

  // Count remaining bad SOURCE findings (will be demoted by enforceSourceUrls)
  const left = findings.filter(
    (f) => f.tag === "SOURCE" && (!f.source || f.source === "null" || !/^https?:\/\//.test(f.source))
  ).length;

  const out = findings.map((f) => JSON.stringify(f)).join("\n") + "\n";
  await writeFile(file, out, "utf-8");

  console.log(`${project}: ${applied} URLs applied, ${left} still lack valid URLs (will demote to [UNKNOWN])`);
  totalApplied += applied;
  totalLeft += left;
}

console.log(`\nTotal: ${totalApplied} URLs applied, ${totalLeft} left for [UNKNOWN] demotion.`);
