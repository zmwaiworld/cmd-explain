/**
 * Tier 1: Local command dictionary lookup.
 * Curated explanations for common CLI commands.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ParsedCommand } from "./parser.js";

interface DictionaryEntry {
  description: string;
  flags?: Record<string, string>;
  subcommands?: Record<string, {
    description: string;
    flags?: Record<string, string>;
  }>;
}

type Dictionary = Record<string, DictionaryEntry>;

let dictionary: Dictionary | null = null;

async function loadDictionary(): Promise<Dictionary> {
  if (dictionary) return dictionary;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const dataPath = join(__dirname, "..", "data", "commands.json");

  const raw = await readFile(dataPath, "utf-8");
  dictionary = JSON.parse(raw) as Dictionary;
  return dictionary;
}

/**
 * Look up a parsed command in the local dictionary.
 * Returns a human-readable explanation or null if not found.
 */
export async function lookupDictionary(parsed: ParsedCommand): Promise<string | null> {
  const dict = await loadDictionary();
  const entry = dict[parsed.program];
  if (!entry) return null;

  // If there's a subcommand match, use that
  if (parsed.subcommand && entry.subcommands?.[parsed.subcommand]) {
    const sub = entry.subcommands[parsed.subcommand];
    let explanation = sub.description;

    // Append flag explanations
    const flagDescs = describeFlagList(parsed.flags, sub.flags ?? {}, entry.flags ?? {});
    if (flagDescs.length > 0) {
      explanation += ` (${flagDescs.join(", ")})`;
    }

    return explanation;
  }

  // Base command match
  let explanation = entry.description;

  // Append flag explanations
  const flagDescs = describeFlagList(parsed.flags, entry.flags ?? {});
  if (flagDescs.length > 0) {
    explanation += ` (${flagDescs.join(", ")})`;
  }

  return explanation;
}

function describeFlagList(flags: string[], ...flagMaps: Record<string, string>[]): string[] {
  const descs: string[] = [];
  for (const flag of flags) {
    for (const map of flagMaps) {
      if (map[flag]) {
        descs.push(map[flag]);
        break;
      }
    }
  }
  return descs;
}
