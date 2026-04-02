/**
 * 3-tier explanation engine.
 * Tier 1: Local dictionary → Tier 2: man/help → Tier 3: LLM (optional)
 */

import { parseCommand, splitCompound, type ParsedCommand } from "./parser.js";
import { lookupDictionary } from "./dictionary.js";
import { lookupManPage } from "./manpage.js";
import { explainWithLLM, isLLMAvailable } from "./llm.js";
import { classifyRisk, classifyCompoundRisk, type RiskLevel } from "./risk.js";

/**
 * Common shell patterns that appear in commands.
 * These aren't programs — they're syntax operators agents use frequently.
 */
const SHELL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /2>&1/, description: "redirect stderr to stdout" },
  { pattern: />\s*\/dev\/null\s+2>&1/, description: "suppress all output" },
  { pattern: /2>\s*\/dev\/null/, description: "suppress error output" },
  { pattern: />\s*\/dev\/null/, description: "suppress stdout" },
  { pattern: /\|\|?\s*true\b/, description: "ignore exit code" },
  { pattern: /\bset\s+-e\b/, description: "exit on error" },
  { pattern: /\bset\s+-x\b/, description: "print commands before execution" },
  { pattern: /\bset\s+-o\s+pipefail\b/, description: "fail on any pipe segment error" },
  { pattern: /<<-?\s*['"]?EOF/, description: "heredoc input" },
  { pattern: /\$\(.*\)/, description: "command substitution" },
  { pattern: /<\(.*\)/, description: "process substitution" },
];

function describeShellPatterns(raw: string): string[] {
  const found: string[] = [];
  for (const { pattern, description } of SHELL_PATTERNS) {
    if (pattern.test(raw)) {
      found.push(description);
    }
  }
  return found;
}

export interface ExplainResult {
  explanation: string;
  risk: RiskLevel;
  tier: 1 | 2 | 3;
  parsed: ParsedCommand;
}

export interface CompoundExplainResult {
  explanation: string;
  risk: RiskLevel;
  segments: ExplainResult[];
}

/**
 * Explain a single command segment.
 */
async function explainSingle(command: string): Promise<ExplainResult> {
  const parsed = parseCommand(command);
  const risk = classifyRisk(parsed);

  // Tier 1: Dictionary
  const dictResult = await lookupDictionary(parsed);
  if (dictResult) {
    const patterns = describeShellPatterns(command);
    const explanation = patterns.length > 0
      ? `${dictResult} [${patterns.join("; ")}]`
      : dictResult;
    return { explanation, risk, tier: 1, parsed };
  }

  // Tier 2: Man page / --help
  if (parsed.program) {
    const manResult = await lookupManPage(parsed.program);
    if (manResult) {
      const patterns = describeShellPatterns(command);
      const explanation = patterns.length > 0
        ? `${manResult} [${patterns.join("; ")}]`
        : manResult;
      return { explanation, risk, tier: 2, parsed };
    }
  }

  // Tier 3: LLM
  if (isLLMAvailable()) {
    const llmResult = await explainWithLLM(command);
    if (llmResult) {
      return { explanation: llmResult, risk, tier: 3, parsed };
    }
  }

  // Fallback: command not recognized by dictionary or system man pages
  const llmHint = isLLMAvailable()
    ? ""
    : ` For better coverage, enable local AI explanations: npx cmd-explain setup --ollama qwen2.5-coder:1.5b (requires Ollama, ~1GB one-time download)`;
  return {
    explanation: `'${parsed.program}' is not a standard system command — no description available.${llmHint}`,
    risk: risk === "medium" ? "unknown" as RiskLevel : risk,
    tier: 1,
    parsed,
  };
}

/**
 * Explain a full command string, handling pipes and compound operators.
 */
export async function explainCommand(command: string): Promise<CompoundExplainResult> {
  const segments = splitCompound(command);

  // Check compound-level risk patterns on the full raw command
  const compoundRisk = classifyCompoundRisk(command);

  if (segments.length === 1) {
    const result = await explainSingle(segments[0]);
    // Compound risk can escalate but never downgrade
    const risk = escalateRisk(result.risk, compoundRisk);
    return {
      explanation: result.explanation,
      risk,
      segments: [result],
    };
  }

  // Explain each segment in parallel
  const results = await Promise.all(segments.map(s => explainSingle(s)));

  // Combine explanations
  const explanation = results.map(r => r.explanation).join(", then ");

  // Overall risk is the highest of any segment or compound pattern
  const riskOrder: RiskLevel[] = ["low", "medium", "high"];
  let maxRisk = results.reduce<RiskLevel>((max, r) => {
    return riskOrder.indexOf(r.risk) > riskOrder.indexOf(max) ? r.risk : max;
  }, "low");
  maxRisk = escalateRisk(maxRisk, compoundRisk);

  return { explanation, risk: maxRisk, segments: results };
}

/** Escalate risk if compound analysis found something higher */
function escalateRisk(current: RiskLevel, compound: RiskLevel | null): RiskLevel {
  if (!compound) return current;
  const order: RiskLevel[] = ["unknown", "low", "medium", "high"];
  return order.indexOf(compound) > order.indexOf(current) ? compound : current;
}
