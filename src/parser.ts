/**
 * Shell command tokenizer.
 * Splits a command string into structured parts: program, subcommand, flags, args.
 * Handles pipes, &&, ||, subshells, and quoted strings.
 */

export interface ParsedCommand {
  program: string;
  subcommand: string | null;
  flags: string[];
  args: string[];
  raw: string;
}

/** Known commands that use subcommands */
const SUBCOMMAND_PROGRAMS = new Set([
  "git", "docker", "kubectl", "npm", "yarn", "pnpm", "aws", "az", "gcloud",
  "cargo", "go", "pip", "brew", "apt", "apt-get", "yum", "dnf", "snap",
  "systemctl", "journalctl", "docker-compose", "podman", "helm", "terraform",
  "pulumi", "sam", "cdk", "serverless", "firebase", "heroku", "flyctl",
  "vercel", "netlify", "gh", "hub", "svn", "hg", "conda", "poetry", "uv",
  "uvx", "npx", "bunx", "deno", "bun",
]);

/**
 * Tokenize a raw shell string into individual tokens,
 * respecting quotes and escape characters.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Split a command line on pipe and logical operators into individual commands.
 * Returns the raw string segments.
 */
export function splitCompound(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let depth = 0; // track $() and ()

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }

    if (inSingle || inDouble) {
      current += ch;
      continue;
    }

    if (ch === "(" || (ch === "$" && next === "(")) { depth++; current += ch; continue; }
    if (ch === ")") { depth = Math.max(0, depth - 1); current += ch; continue; }

    if (depth > 0) {
      current += ch;
      continue;
    }

    // Split on | (but not ||), &&, ||, ;
    if (ch === "|" && next !== "|") {
      segments.push(current.trim());
      current = "";
      continue;
    }
    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      segments.push(current.trim());
      current = "";
      i++; // skip next char
      continue;
    }
    if (ch === ";") {
      segments.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }
  const last = current.trim();
  if (last.length > 0) segments.push(last);
  return segments.filter(s => s.length > 0);
}

/**
 * Parse a single (non-compound) command string into structured parts.
 */
export function parseCommand(command: string): ParsedCommand {
  const raw = command.trim();
  const tokens = tokenize(raw);

  if (tokens.length === 0) {
    return { program: "", subcommand: null, flags: [], args: [], raw };
  }

  // Skip env var assignments at the start (e.g. FOO=bar cmd ...)
  let startIdx = 0;
  while (startIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[startIdx])) {
    startIdx++;
  }

  // Skip sudo/env prefixes
  while (startIdx < tokens.length && ["sudo", "env", "nohup", "time", "nice"].includes(tokens[startIdx])) {
    startIdx++;
  }

  if (startIdx >= tokens.length) {
    return { program: "", subcommand: null, flags: [], args: [], raw };
  }

  const program = tokens[startIdx];
  const rest = tokens.slice(startIdx + 1);

  let subcommand: string | null = null;
  const flags: string[] = [];
  const args: string[] = [];

  let subcommandFound = false;

  for (const token of rest) {
    if (token.startsWith("-")) {
      // Expand combined short flags like -rf into -r, -f
      // But NOT long-form single-dash flags like -name, -delete, -exec
      if (token.startsWith("-") && !token.startsWith("--") && token.length > 2) {
        // Heuristic: if the flag looks like a word (all lowercase letters), keep it as-is
        const body = token.slice(1);
        if (/^[a-z]{3,}$/.test(body)) {
          flags.push(token);
        } else {
          for (const ch of body) {
            flags.push(`-${ch}`);
          }
        }
      } else {
        flags.push(token);
      }
    } else if (!subcommandFound && SUBCOMMAND_PROGRAMS.has(program) && !token.includes("/") && !token.includes(".")) {
      subcommand = token;
      subcommandFound = true;
    } else {
      args.push(token);
    }
  }

  return { program, subcommand, flags, args, raw };
}
