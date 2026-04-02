/**
 * Tier 2: Man page / --help fallback.
 * Attempts to extract a one-liner description from the system.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 5000;

/**
 * Try to get a one-line description for a program from man or --help.
 */
export async function lookupManPage(program: string): Promise<string | null> {
  // Try `man` first (not available on Windows)
  if (process.platform !== "win32") {
    const manResult = await tryMan(program);
    if (manResult) return manResult;
  }

  // Fall back to --help
  const helpResult = await tryHelp(program);
  if (helpResult) return helpResult;

  return null;
}

async function tryMan(program: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("whatis", [program], {
      timeout: TIMEOUT_MS,
    });

    // whatis can return multiple entries and macOS wraps lines unpredictably.
    // Flatten everything to one line, then find "program(section) - description".
    const flat = stdout.replace(/\n/g, " ").replace(/\s+/g, " ");
    const escaped = program.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escaped}\\s*\\([^)]+\\)\\s+-\\s+(.+?)(?=\\s+\\S+\\s*\\([^)]+\\)\\s+-|$)`);
    const match = flat.match(pattern);
    if (match) {
      return match[1].trim();
    }
  } catch {
    // whatis not available, timed out, or program not found
  }
  return null;
}

async function tryHelp(program: string): Promise<string | null> {
  // Try --help first, then -h
  for (const flag of ["--help", "-h"]) {
    try {
      const { stdout, stderr } = await execFileAsync(program, [flag], {
        timeout: TIMEOUT_MS,
        env: { ...process.env },
      });

      const output = stdout || stderr;
      return extractFirstLine(output);
    } catch (err: unknown) {
      // Some programs print help to stderr and exit non-zero
      if (err && typeof err === "object" && "stderr" in err) {
        const stderr = (err as { stderr: string }).stderr;
        if (stderr) {
          const line = extractFirstLine(stderr);
          if (line) return line;
        }
      }
    }
  }
  return null;
}

/**
 * Extract the first meaningful line from help output.
 * Skips blank lines, usage lines, version lines, and error messages.
 */
function extractFirstLine(output: string): string | null {
  const lines = output.split("\n").map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Skip usage/version/copyright lines
    if (/^(usage|version|copyright|\d+\.\d+)/i.test(line)) continue;
    // Skip lines that are just the program name
    if (line.length < 10) continue;
    // Skip error messages
    if (/\b(error|illegal|invalid|cannot|unknown|unrecognized|not found|no such|permission denied|fatal|failed|abort|refused|denied|unexpected)\b/i.test(line)) continue;
    // Skip lines that look like stack traces or paths
    if (/^\s*(at |\/|Error:|\w+Error)/.test(line)) continue;
    // Found a description-like line
    // Truncate to one sentence
    const sentence = line.replace(/\.\s.*$/, "").trim();
    if (sentence.length > 10 && sentence.length < 200) {
      return sentence;
    }
  }
  return null;
}
