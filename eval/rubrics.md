# Scoring Rubrics — Research & Synthesis

## Dimensions

### Accuracy (weight: 0.25)
How factually correct are the claims? Are sources cited properly?

| Score | Description |
|-------|-------------|
| 9-10  | All claims verifiable, sources cited precisely, no errors |
| 7-8   | Minor inaccuracies, most claims well-sourced |
| 5-6   | Some unsupported claims, occasional errors |
| 3-4   | Multiple factual errors, poor sourcing |
| 1-2   | Largely inaccurate or fabricated |

### Coverage (weight: 0.20)
How thoroughly are the relevant topics addressed?

| Score | Description |
|-------|-------------|
| 9-10  | All key aspects covered, including edge cases and nuances |
| 7-8   | Most important topics covered, minor gaps |
| 5-6   | Core topics covered but notable omissions |
| 3-4   | Significant gaps in coverage |
| 1-2   | Only scratches the surface |

### Coherence (weight: 0.15)
Is the output well-structured, logically flowing, and readable?

| Score | Description |
|-------|-------------|
| 9-10  | Crystal clear structure, smooth logical flow, easy to follow |
| 7-8   | Well-organized with minor flow issues |
| 5-6   | Adequate structure but some disjointed sections |
| 3-4   | Confusing organization, hard to follow |
| 1-2   | Incoherent or unstructured |

### Insight Quality (weight: 0.20)
Are there novel connections, deep analysis, and actionable findings?

| Score | Description |
|-------|-------------|
| 9-10  | Original insights, unexpected connections, highly actionable |
| 7-8   | Good analytical depth, some novel observations |
| 5-6   | Standard analysis, mostly restating sources |
| 3-4   | Shallow analysis, obvious conclusions only |
| 1-2   | No analysis, pure summarization |

### Process Compliance (weight: 0.20)
Were protocol artifacts produced? Are integrity constraints followed?

| Score | Description |
|-------|-------------|
| 9-10  | All artifacts present (trace, exp log, metrics). All claims tagged with epistemic basis. Knowledge store updated. Context budget respected. |
| 7-8   | Most artifacts present. Most claims tagged. Minor gaps in audit trail. |
| 5-6   | Some artifacts missing. Partial claim tagging. Knowledge store not updated. |
| 3-4   | Major artifacts missing. Few or no claim tags. No audit trail. |
| 1-2   | No protocol artifacts produced. Zero compliance. |

## Overall Score

Weighted average: `accuracy * 0.25 + coverage * 0.20 + coherence * 0.15 + insightQuality * 0.20 + processCompliance * 0.20`
