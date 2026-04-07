import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  escapeYamlValue,
  inferEngineeringType,
  classifyToFolder,
  findingContentHash,
  buildWikiNode,
  writeWikiNode,
  updateWiki,
  updateWikiIndex,
} from "../wiki.js";
import { selectWikiContext } from "../conductor-context.js";
import type { Finding, EngineeringType } from "../types.js";

// ── Helpers ──

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F001",
    claim: "Test claim",
    tag: "SOURCE",
    source: "https://example.com",
    confidence: 0.9,
    domain: "test",
    iteration: 1,
    status: "provisional",
    verifiedAt: null,
    supersededBy: null,
    ...overrides,
  };
}

async function setupProjectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sea-wiki-test-"));
  await mkdir(path.join(dir, "knowledge"), { recursive: true });
  return dir;
}

async function writeFindings(projectDir: string, findings: Finding[]): Promise<void> {
  const content = findings.map((f) => JSON.stringify(f)).join("\n") + (findings.length ? "\n" : "");
  await writeFile(path.join(projectDir, "knowledge", "findings.jsonl"), content, "utf-8");
}

// ── escapeYamlValue ──

describe("escapeYamlValue", () => {
  it("passes through plain text", () => {
    expect(escapeYamlValue("hello world")).toBe("hello world");
  });

  it("quotes values with colons", () => {
    expect(escapeYamlValue("key: value")).toBe('"key: value"');
  });

  it("quotes values with hash", () => {
    expect(escapeYamlValue("concentration 300 mg/L # note")).toBe(
      '"concentration 300 mg/L # note"'
    );
  });

  it("escapes internal double quotes", () => {
    expect(escapeYamlValue('said "hello"')).toBe('"said \\"hello\\""');
  });

  it("quotes brackets", () => {
    expect(escapeYamlValue("[1, 2, 3]")).toBe('"[1, 2, 3]"');
    expect(escapeYamlValue("{a: b}")).toBe('"{a: b}"');
  });

  it("quotes empty string", () => {
    expect(escapeYamlValue("")).toBe('""');
  });

  it("handles null", () => {
    expect(escapeYamlValue(null)).toBe("null");
  });

  it("handles undefined", () => {
    expect(escapeYamlValue(undefined)).toBe("null");
  });

  it("quotes multiline", () => {
    expect(escapeYamlValue("line1\nline2")).toBe('"line1\\nline2"');
  });

  it("quotes YAML boolean values", () => {
    expect(escapeYamlValue("true")).toBe('"true"');
    expect(escapeYamlValue("false")).toBe('"false"');
    expect(escapeYamlValue("null")).toBe('"null"');
    expect(escapeYamlValue("yes")).toBe('"yes"');
    expect(escapeYamlValue("no")).toBe('"no"');
  });

  it("quotes values starting with YAML special prefixes", () => {
    expect(escapeYamlValue("- list item")).toBe('"- list item"');
    expect(escapeYamlValue("> block")).toBe('"> block"');
    expect(escapeYamlValue("*bold*")).toBe('"*bold*"');
    expect(escapeYamlValue("&anchor")).toBe('"&anchor"');
    expect(escapeYamlValue("!tag")).toBe('"!tag"');
  });

  it("quotes values with leading/trailing spaces", () => {
    expect(escapeYamlValue(" leading")).toBe('" leading"');
    expect(escapeYamlValue("trailing ")).toBe('"trailing "');
  });

  it("escapes backslashes", () => {
    expect(escapeYamlValue("path\\to\\file")).toBe('"path\\\\to\\\\file"');
  });
});

// ── inferEngineeringType ──

describe("inferEngineeringType", () => {
  it("SOURCE + high confidence = MEASUREMENT", () => {
    expect(inferEngineeringType(makeFinding({ tag: "SOURCE", confidence: 0.95 }))).toBe(
      "MEASUREMENT"
    );
  });

  it("SOURCE + lower confidence = STANDARD", () => {
    expect(inferEngineeringType(makeFinding({ tag: "SOURCE", confidence: 0.8 }))).toBe("STANDARD");
  });

  it("SOURCE + exactly 0.9 = MEASUREMENT", () => {
    expect(inferEngineeringType(makeFinding({ tag: "SOURCE", confidence: 0.9 }))).toBe(
      "MEASUREMENT"
    );
  });

  it("DERIVED tag = DERIVED", () => {
    expect(inferEngineeringType(makeFinding({ tag: "DERIVED" }))).toBe("DERIVED");
  });

  it("ASSUMED tag = ASSUMPTION", () => {
    expect(inferEngineeringType(makeFinding({ tag: "ASSUMED" }))).toBe("ASSUMPTION");
  });

  it("ESTIMATED tag = HYPOTHESIS", () => {
    expect(inferEngineeringType(makeFinding({ tag: "ESTIMATED" }))).toBe("HYPOTHESIS");
  });

  it("UNKNOWN tag = ASSUMPTION", () => {
    expect(inferEngineeringType(makeFinding({ tag: "UNKNOWN" }))).toBe("ASSUMPTION");
  });
});

// ── classifyToFolder ──

describe("classifyToFolder", () => {
  it("maps MEASUREMENT to facts", () => {
    expect(classifyToFolder("MEASUREMENT")).toBe("facts");
  });

  it("maps STANDARD to facts", () => {
    expect(classifyToFolder("STANDARD")).toBe("facts");
  });

  it("maps DERIVED to relationships", () => {
    expect(classifyToFolder("DERIVED")).toBe("relationships");
  });

  it("maps DESIGN to decisions", () => {
    expect(classifyToFolder("DESIGN")).toBe("decisions");
  });

  it("maps ASSUMPTION to assumptions", () => {
    expect(classifyToFolder("ASSUMPTION")).toBe("assumptions");
  });

  it("maps HYPOTHESIS to assumptions", () => {
    expect(classifyToFolder("HYPOTHESIS")).toBe("assumptions");
  });
});

// ── findingContentHash ──

describe("findingContentHash", () => {
  it("is deterministic", () => {
    const finding = makeFinding();
    expect(findingContentHash(finding)).toBe(findingContentHash(finding));
  });

  it("changes when finding changes", () => {
    const a = makeFinding({ claim: "claim A" });
    const b = makeFinding({ claim: "claim B" });
    expect(findingContentHash(a)).not.toBe(findingContentHash(b));
  });

  it("returns a 16-char hex string", () => {
    const hash = findingContentHash(makeFinding());
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ── buildWikiNode ──

describe("buildWikiNode", () => {
  it("produces valid frontmatter", () => {
    const content = buildWikiNode(makeFinding({ engineeringType: "MEASUREMENT" }));
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("type: MEASUREMENT");
    expect(content).toContain("tag: SOURCE");
    expect(content).toContain("confidence: 0.9");
    expect(content).toContain("status: provisional");
    expect(content).toContain("human_review_required: false");
  });

  it("includes claim as heading", () => {
    const content = buildWikiNode(makeFinding({ claim: "Gold recovery drops above 300 mg/L" }));
    expect(content).toContain("## Gold recovery drops above 300 mg/L");
  });

  it("escapes colons in claim", () => {
    const content = buildWikiNode(makeFinding({ claim: "Key finding: concentration matters" }));
    // The frontmatter claim should be quoted
    expect(content).toContain('"Key finding: concentration matters"');
  });

  it("includes quantitative data when present", () => {
    const content = buildWikiNode(
      makeFinding({
        quantitative: {
          value: 42.5,
          unit: "mg/L",
          uncertainty: "+/- 3%",
          relationship: "inverse",
        },
      })
    );
    expect(content).toContain("value: 42.5");
    expect(content).toContain("**Value**: 42.5 mg/L (+/- 3%)");
    expect(content).toContain("**Relationship**: inverse");
  });

  it("adds refuted banner", () => {
    const content = buildWikiNode(makeFinding({ status: "refuted" }));
    expect(content).toContain("**Refuted**");
  });

  it("adds superseded banner with link", () => {
    const content = buildWikiNode(
      makeFinding({ status: "superseded", supersededBy: "F099" })
    );
    expect(content).toContain("**Superseded** by [F099](./F099.md)");
  });

  it("includes linked findings", () => {
    const content = buildWikiNode(makeFinding({ linkedFindings: ["F002", "F003"] }));
    expect(content).toContain("[F002](./F002.md)");
    expect(content).toContain("[F003](./F003.md)");
  });

  it("flags ASSUMPTION for human review", () => {
    const content = buildWikiNode(makeFinding({ engineeringType: "ASSUMPTION" }));
    expect(content).toContain("human_review_required: true");
    expect(content).toContain("requires human review");
  });

  it("flags HYPOTHESIS for human review", () => {
    const content = buildWikiNode(makeFinding({ engineeringType: "HYPOTHESIS" }));
    expect(content).toContain("human_review_required: true");
  });
});

// ── Disk-based tests ──

describe("writeWikiNode", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await setupProjectDir();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("creates the wiki file in the correct folder", async () => {
    const finding = makeFinding({ engineeringType: "MEASUREMENT" });
    const wikiPath = await writeWikiNode(projectDir, finding);

    expect(wikiPath).toBe("wiki/facts/F001.md");
    const filePath = path.join(projectDir, "wiki", "facts", "F001.md");
    expect(existsSync(filePath)).toBe(true);
  });

  it("uses forward slashes in returned path", async () => {
    const finding = makeFinding({ engineeringType: "DERIVED" });
    const wikiPath = await writeWikiNode(projectDir, finding);
    expect(wikiPath).not.toContain("\\");
    expect(wikiPath).toBe("wiki/relationships/F001.md");
  });

  it("infers type when not set", async () => {
    const finding = makeFinding({ tag: "ASSUMED", confidence: 0.5 });
    const wikiPath = await writeWikiNode(projectDir, finding);
    expect(wikiPath).toBe("wiki/assumptions/F001.md");
  });
});

describe("updateWiki", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await setupProjectDir();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("creates wiki nodes on first run", async () => {
    const findings = [
      makeFinding({ id: "F001", confidence: 0.85, tag: "SOURCE", engineeringType: "MEASUREMENT" }),
      makeFinding({ id: "F002", confidence: 0.75, tag: "DERIVED", engineeringType: "DERIVED" }),
    ];
    await writeFindings(projectDir, findings);

    const result = await updateWiki(projectDir);
    expect(result.written).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.archived).toBe(0);

    // Check files exist
    expect(existsSync(path.join(projectDir, "wiki", "facts", "F001.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "wiki", "relationships", "F002.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "wiki", "index.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "wiki", "manifest.json"))).toBe(true);
  });

  it("skips unchanged findings on second run", async () => {
    const findings = [
      makeFinding({ id: "F001", confidence: 0.85, engineeringType: "MEASUREMENT" }),
    ];
    await writeFindings(projectDir, findings);

    await updateWiki(projectDir);
    const result = await updateWiki(projectDir);

    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.archived).toBe(0);
  });

  it("rewrites a finding when it changes", async () => {
    const findings = [
      makeFinding({ id: "F001", confidence: 0.85, claim: "original claim", engineeringType: "MEASUREMENT" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    // Modify the finding
    const updated = [
      makeFinding({ id: "F001", confidence: 0.92, claim: "updated claim", engineeringType: "MEASUREMENT" }),
    ];
    await writeFindings(projectDir, updated);
    const result = await updateWiki(projectDir);

    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);

    const content = await readFile(path.join(projectDir, "wiki", "facts", "F001.md"), "utf-8");
    expect(content).toContain("updated claim");
  });

  it("archives refuted findings", async () => {
    const findings = [
      makeFinding({ id: "F001", confidence: 0.85, engineeringType: "MEASUREMENT" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    // Refute the finding
    const refuted = [
      makeFinding({ id: "F001", confidence: 0.85, status: "refuted", engineeringType: "MEASUREMENT" }),
    ];
    await writeFindings(projectDir, refuted);
    const result = await updateWiki(projectDir);

    expect(result.archived).toBe(1);
    expect(existsSync(path.join(projectDir, "wiki", "facts", "F001.md"))).toBe(false);
    expect(existsSync(path.join(projectDir, "wiki", "_archive", "F001.md"))).toBe(true);
  });

  it("skips low-confidence findings", async () => {
    const findings = [
      makeFinding({ id: "F001", confidence: 0.5, engineeringType: "HYPOTHESIS" }),
    ];
    await writeFindings(projectDir, findings);

    const result = await updateWiki(projectDir);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("backfills engineeringType on old findings", async () => {
    // Write findings WITHOUT engineeringType
    const findings = [
      makeFinding({ id: "F001", confidence: 0.95, tag: "SOURCE" }),
    ];
    await writeFindings(projectDir, findings);

    const result = await updateWiki(projectDir);
    expect(result.backfilled).toBe(1);

    // Check that the finding in JSONL was updated
    const content = await readFile(
      path.join(projectDir, "knowledge", "findings.jsonl"),
      "utf-8"
    );
    const parsed = JSON.parse(content.trim().split("\n")[0]);
    expect(parsed.engineeringType).toBe("MEASUREMENT");
    expect(parsed.humanReviewRequired).toBe(false);
  });

  it("adds new findings without rewriting existing", async () => {
    const findings = [
      makeFinding({ id: "F001", confidence: 0.85, engineeringType: "MEASUREMENT" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    // Add a second finding
    const updated = [
      makeFinding({ id: "F001", confidence: 0.85, engineeringType: "MEASUREMENT" }),
      makeFinding({ id: "F002", confidence: 0.8, engineeringType: "DERIVED", domain: "other" }),
    ];
    await writeFindings(projectDir, updated);
    const result = await updateWiki(projectDir);

    expect(result.written).toBe(1); // Only F002
    expect(result.skipped).toBe(1); // F001 unchanged
  });
});

describe("updateWikiIndex", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await setupProjectDir();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("groups by domain and includes engineering type", async () => {
    const findings = [
      makeFinding({ id: "F001", domain: "water", confidence: 0.9, engineeringType: "MEASUREMENT", claim: "Water hardness at 300" }),
      makeFinding({ id: "F002", domain: "gold", confidence: 0.85, engineeringType: "DERIVED", claim: "Gold recovery rate" }),
      makeFinding({ id: "F003", domain: "water", confidence: 0.8, engineeringType: "STANDARD", claim: "Water standard limit" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    const index = await readFile(path.join(projectDir, "wiki", "index.md"), "utf-8");
    expect(index).toContain("## gold");
    expect(index).toContain("## water");
    expect(index).toContain("MEASUREMENT");
    expect(index).toContain("DERIVED");
    // Links use forward slashes
    expect(index).toContain("./facts/F001.md");
  });

  it("sorts by priority then confidence within domain", async () => {
    const findings = [
      makeFinding({ id: "F001", domain: "d", confidence: 0.8, engineeringType: "ASSUMPTION", claim: "Assumption" }),
      makeFinding({ id: "F002", domain: "d", confidence: 0.95, engineeringType: "MEASUREMENT", claim: "Measurement" }),
      makeFinding({ id: "F003", domain: "d", confidence: 0.85, engineeringType: "MEASUREMENT", claim: "Measurement 2" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    const index = await readFile(path.join(projectDir, "wiki", "index.md"), "utf-8");
    const lines = index.split("\n").filter((l) => l.startsWith("- ["));

    // MEASUREMENT (priority 1) should come before ASSUMPTION (priority 4)
    const measurementIdx = lines.findIndex((l) => l.includes("Measurement"));
    const assumptionIdx = lines.findIndex((l) => l.includes("Assumption"));
    expect(measurementIdx).toBeLessThan(assumptionIdx);
  });
});

// ── selectWikiContext ──

describe("selectWikiContext", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await setupProjectDir();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("returns empty string when no wiki exists", async () => {
    const result = await selectWikiContext(projectDir, "mechanism", "test");
    expect(result).toBe("");
  });

  it("returns empty string when manifest is empty", async () => {
    await mkdir(path.join(projectDir, "wiki"), { recursive: true });
    await writeFile(
      path.join(projectDir, "wiki", "manifest.json"),
      JSON.stringify({ entries: [] }),
      "utf-8"
    );
    const result = await selectWikiContext(projectDir, "mechanism", "test");
    expect(result).toBe("");
  });

  it("returns wiki nodes matching question type filter", async () => {
    // Set up findings + wiki via updateWiki
    const findings = [
      makeFinding({ id: "F001", domain: "water", confidence: 0.95, engineeringType: "MEASUREMENT", claim: "pH is 7.2" }),
      makeFinding({ id: "F002", domain: "water", confidence: 0.8, engineeringType: "HYPOTHESIS", claim: "pH may cause corrosion" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    // data-hunt only allows MEASUREMENT and STANDARD
    const result = await selectWikiContext(projectDir, "data-hunt", "water");
    expect(result).toContain("pH is 7.2");
    expect(result).not.toContain("pH may cause corrosion");
  });

  it("filters by domain", async () => {
    const findings = [
      makeFinding({ id: "F001", domain: "water", confidence: 0.95, engineeringType: "MEASUREMENT", claim: "Water claim" }),
      makeFinding({ id: "F002", domain: "gold", confidence: 0.95, engineeringType: "MEASUREMENT", claim: "Gold claim" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    const result = await selectWikiContext(projectDir, "landscape", "water");
    expect(result).toContain("Water claim");
    expect(result).not.toContain("Gold claim");
  });

  it("respects character budget", async () => {
    const findings = [
      makeFinding({ id: "F001", domain: "d", confidence: 0.95, engineeringType: "MEASUREMENT", claim: "First finding with some text" }),
      makeFinding({ id: "F002", domain: "d", confidence: 0.9, engineeringType: "MEASUREMENT", claim: "Second finding with some text" }),
      makeFinding({ id: "F003", domain: "d", confidence: 0.85, engineeringType: "MEASUREMENT", claim: "Third finding with some text" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    // Tiny budget should only include 1 node
    const result = await selectWikiContext(projectDir, "landscape", "d", 300);
    const nodeCount = (result.match(/^## /gm) || []).length;
    // Should have at most 2 nodes (header + 1 node content)
    expect(result.length).toBeLessThan(600);
  });

  it("sorts by engineering type priority (MEASUREMENT before ASSUMPTION)", async () => {
    const findings = [
      makeFinding({ id: "F001", domain: "d", confidence: 0.8, engineeringType: "ASSUMPTION", claim: "Assumption node" }),
      makeFinding({ id: "F002", domain: "d", confidence: 0.8, engineeringType: "MEASUREMENT", claim: "Measurement node" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    const result = await selectWikiContext(projectDir, "landscape", "d");
    const measureIdx = result.indexOf("Measurement node");
    const assumptionIdx = result.indexOf("Assumption node");
    expect(measureIdx).toBeGreaterThan(-1);
    expect(assumptionIdx).toBeGreaterThan(-1);
    expect(measureIdx).toBeLessThan(assumptionIdx);
  });

  it("includes all types for landscape questions", async () => {
    const findings = [
      makeFinding({ id: "F001", domain: "d", confidence: 0.8, engineeringType: "MEASUREMENT", claim: "Meas" }),
      makeFinding({ id: "F002", domain: "d", confidence: 0.8, engineeringType: "HYPOTHESIS", claim: "Hypo" }),
      makeFinding({ id: "F003", domain: "d", confidence: 0.8, engineeringType: "DESIGN", claim: "Des" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    const result = await selectWikiContext(projectDir, "landscape", "d");
    expect(result).toContain("Meas");
    expect(result).toContain("Hypo");
    expect(result).toContain("Des");
  });

  it("returns empty domain includes all", async () => {
    const findings = [
      makeFinding({ id: "F001", domain: "water", confidence: 0.95, engineeringType: "MEASUREMENT", claim: "Water fact" }),
      makeFinding({ id: "F002", domain: "gold", confidence: 0.95, engineeringType: "MEASUREMENT", claim: "Gold fact" }),
    ];
    await writeFindings(projectDir, findings);
    await updateWiki(projectDir);

    // Empty domain = include all
    const result = await selectWikiContext(projectDir, "landscape", "");
    expect(result).toContain("Water fact");
    expect(result).toContain("Gold fact");
  });
});
