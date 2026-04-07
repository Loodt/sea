/**
 * Shared filter for failure/success pattern files with optional YAML frontmatter.
 *
 * Pattern files may include frontmatter to scope their relevance:
 *   ---
 *   domains: [general, thermal-fluids]
 *   question_types: [mechanism, kill-check]
 *   ---
 *
 * Files without frontmatter are always included (backward compat).
 * "general" in domains or "all" in question_types means always relevant for that axis.
 */
export function isPatternRelevant(
  content: string,
  domain?: string,
  questionType?: string
): boolean {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return true;

  const fm = fmMatch[1];
  const domains = (fm.match(/domains:\s*\[([^\]]+)\]/)?.[1] ?? "general")
    .split(",")
    .map((s) => s.trim());
  const types = (fm.match(/question_types:\s*\[([^\]]+)\]/)?.[1] ?? "all")
    .split(",")
    .map((s) => s.trim());

  const domainMatch = domains.includes("general") || !domain || domains.includes(domain);
  const typeMatch = types.includes("all") || !questionType || types.includes(questionType);

  return domainMatch && typeMatch;
}
