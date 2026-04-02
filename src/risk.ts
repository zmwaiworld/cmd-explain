/**
 * Risk classification for CLI commands.
 *
 * Two layers:
 * 1. Segment-level: per-command heuristics (program + flags + args)
 * 2. Compound-level: patterns across the full raw command string
 *
 * The compound layer catches dangerous combinations that individual
 * segment analysis misses (e.g., curl | bash, sudo piped commands).
 */

import type { ParsedCommand } from "./parser.js";

export type RiskLevel = "low" | "medium" | "high" | "unknown";

// ─── Segment-level classification ────────────────────────────────

/** Programs that only read data */
const READ_ONLY = new Set([
  "ls", "cat", "head", "tail", "less", "more", "wc", "echo", "printf",
  "pwd", "whoami", "hostname", "uname", "date", "cal", "uptime", "which",
  "where", "whereis", "type", "file", "stat", "du", "df", "free",
  "top", "htop", "ps", "id", "groups", "env", "printenv", "locale",
  "man", "help", "info", "diff", "cmp", "md5sum", "sha256sum", "shasum",
  "tree", "realpath", "basename", "dirname", "seq", "true", "false",
  "test", "expr", "bc", "jq", "yq", "xargs",
]);

/** Programs that are destructive or irreversible */
const DESTRUCTIVE = new Set([
  "rm", "rmdir", "shred", "dd", "mkfs", "fdisk", "parted",
  "kill", "killall", "pkill", "reboot", "shutdown", "halt", "poweroff",
  "userdel", "groupdel", "iptables", "ip6tables",
  "ncat", "useradd", "usermod", "visudo", "passwd",
]);

/** Subcommands that are destructive */
const DESTRUCTIVE_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(["reset", "clean", "push"]),
  docker: new Set(["rm", "rmi", "prune", "system"]),
  kubectl: new Set(["delete", "drain", "cordon", "exec"]),
  npm: new Set(["uninstall"]),
  aws: new Set(["delete", "remove", "terminate", "destroy"]),
  brew: new Set(["uninstall", "remove"]),
  pip: new Set(["uninstall"]),
  cargo: new Set(["uninstall"]),
  terraform: new Set(["destroy", "apply"]),
  pulumi: new Set(["up", "destroy"]),
};

/** Subcommands that are read-only */
const READONLY_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(["status", "log", "diff", "show", "branch", "remote"]),
  docker: new Set(["ps", "images", "logs", "inspect", "stats", "top", "port"]),
  kubectl: new Set(["get", "describe", "logs", "top", "explain", "api-resources"]),
  npm: new Set(["ls", "list", "view", "info", "search", "outdated", "audit"]),
  aws: new Set(["describe", "list", "get"]),
  brew: new Set(["list", "info", "search", "outdated", "deps"]),
};

/** Flags that indicate destructive intent */
const DESTRUCTIVE_FLAGS = new Set([
  "-f", "--force", "--force-with-lease",
  "--hard", "--no-preserve-root",
  "--purge", "--all", "--prune",
  "-delete",
]);

/** Flags/args that signal dangerous values regardless of program */
const DANGEROUS_ARG_PATTERNS: Array<{ test: (parsed: ParsedCommand) => boolean; risk: RiskLevel }> = [
  // chmod 777 or chmod -R 777 — world-writable permissions
  { test: (p) => p.program === "chmod" && p.args.some(a => /^[0-7]*7[0-7]*$/.test(a) && a.includes("7")), risk: "high" },
  // chown/chmod on system paths
  { test: (p) => ["chmod", "chown"].includes(p.program) && p.args.some(a => a.startsWith("/etc") || a.startsWith("/usr") || a === "/"), risk: "high" },
  // Any command with --accept-data-loss, --drop, --destroy, --wipe
  { test: (p) => [...p.flags, ...p.args].some(a => /--(?:accept-data-loss|drop|destroy|wipe|nuke|reset-hard)/i.test(a)), risk: "high" },
  // sudo escalation
  { test: (p) => p.program === "sudo", risk: "high" },
  // eval with arbitrary input
  { test: (p) => p.program === "eval", risk: "high" },
];

export function classifyRisk(parsed: ParsedCommand): RiskLevel {
  const { program, subcommand, flags } = parsed;

  if (!program) return "low";

  // Check dangerous arg patterns first (highest priority)
  for (const { test, risk } of DANGEROUS_ARG_PATTERNS) {
    if (test(parsed)) return risk;
  }

  // Check read-only programs
  if (READ_ONLY.has(program)) {
    // Some "read-only" programs become dangerous with certain args
    // (compound patterns catch most, but flag nc/ncat here too)
    return "low";
  }

  // grep/find/awk/sed are read-only unless combined with destructive flags
  if (["grep", "egrep", "fgrep", "rg", "ag", "find", "fd", "awk", "sed"].includes(program)) {
    if (program === "sed" && (flags.includes("-i") || flags.some(f => f.startsWith("-i")))) {
      return "medium";
    }
    if (program === "find" && flags.includes("-delete")) {
      return "high";
    }
    return "low";
  }

  // curl: GET is low, POST/PUT/DELETE is medium
  if (["curl", "wget", "http", "httpie"].includes(program)) {
    if (flags.includes("-X") || flags.includes("--request")) return "medium";
    if (flags.includes("-d") || flags.includes("--data") || flags.includes("-F")) return "medium";
    return "low";
  }

  // nc/netcat: always at least medium (networking tool with dual-use)
  if (["nc", "netcat"].includes(program)) {
    if (flags.includes("-e") || flags.includes("--exec")) return "high";
    return "medium";
  }

  // Check destructive programs
  if (DESTRUCTIVE.has(program)) return "high";

  // Check subcommand-level classification
  if (subcommand) {
    const destructiveSubs = DESTRUCTIVE_SUBCOMMANDS[program];
    if (destructiveSubs?.has(subcommand)) return "high";

    const readonlySubs = READONLY_SUBCOMMANDS[program];
    if (readonlySubs?.has(subcommand)) return "low";
  }

  // Force flags on anything bump risk
  if (flags.some(f => DESTRUCTIVE_FLAGS.has(f))) return "high";

  // Default: state-changing but probably reversible
  return "medium";
}

// ─── Compound-level classification ───────────────────────────────

/**
 * Dangerous patterns that span the full raw command string.
 * These catch risks that per-segment analysis misses.
 */
const COMPOUND_PATTERNS: Array<{ pattern: RegExp; risk: RiskLevel; reason: string }> = [
  // === Remote code execution ===
  // curl/wget piped to shell
  { pattern: /\b(curl|wget)\b.*\|\s*(sudo\s+)?(bash|sh|zsh|dash|fish|python|python3|perl|ruby|node)\b/, risk: "high", reason: "downloads and executes remote code" },
  // curl/wget piped to anything via sudo
  { pattern: /\|.*\bsudo\b/, risk: "high", reason: "piping to sudo" },
  // curl output saved and executed
  { pattern: /\b(curl|wget)\b.*-[oO]\s+\S+.*&&.*\b(chmod|bash|sh|\.\/)\b/, risk: "high", reason: "download and execute pattern" },

  // === Reverse shells ===
  { pattern: /\/dev\/tcp\//, risk: "high", reason: "bash reverse shell via /dev/tcp" },
  { pattern: /\bnc\b.*-e\s+\/bin/, risk: "high", reason: "netcat reverse shell" },
  { pattern: /\bncat\b.*--exec/, risk: "high", reason: "ncat reverse shell" },
  { pattern: /\bsocket\b.*\bconnect\b/i, risk: "high", reason: "socket-based reverse shell" },
  { pattern: /\bpty\.spawn\b/, risk: "high", reason: "PTY spawn (shell upgrade)" },
  { pattern: /\bnc\b.*-lvnp/, risk: "high", reason: "netcat listener (reverse shell receiver)" },

  // === Data exfiltration ===
  { pattern: /\bcat\b.*\.(ssh|aws|gnupg|env)\b.*\|\s*\b(curl|wget|nc|netcat|ncat)\b/, risk: "high", reason: "credential exfiltration" },
  { pattern: /\bcat\b.*\b(id_rsa|id_ed25519|credentials|shadow|master\.passwd|secring\.gpg)\b/, risk: "high", reason: "reading sensitive credential file" },
  { pattern: /\bcat\b.*(?:\/etc\/passwd|\/etc\/shadow).*\|\s*\b(nc|netcat|ncat|curl|wget)\b/, risk: "high", reason: "system file exfiltration" },
  { pattern: /\bcat\b.*\.env\b/, risk: "high", reason: "reading environment secrets file" },
  { pattern: /\benv\b.*\|.*\b(curl|wget|nc|netcat)\b/, risk: "high", reason: "environment variable exfiltration" },
  { pattern: /\btar\b.*\|\s*\b(curl|wget|nc)\b/, risk: "high", reason: "archive exfiltration" },
  { pattern: /\bbase64\b.*\b(shadow|passwd|id_rsa|credentials|\.env)\b/, risk: "high", reason: "encoding sensitive data" },
  { pattern: /\bstrings\b.*\/proc\/.*\/environ/, risk: "high", reason: "reading process environment (credential theft)" },

  // === System destruction ===
  { pattern: />\s*\/dev\/sd[a-z]/, risk: "high", reason: "writing directly to disk device" },
  { pattern: />\s*\/dev\/nvme/, risk: "high", reason: "writing directly to disk device" },
  { pattern: />\s*\/etc\/|>\s*\/usr\/|>\s*\/sys\/|>\s*\/proc\//, risk: "high", reason: "writing to system path" },
  { pattern: /\b(mkfs|fdisk|parted|dd)\b.*\/(dev|sd[a-z]|nvme)/, risk: "high", reason: "disk operation" },
  { pattern: /\/dev\/urandom.*>.*\/dev\//, risk: "high", reason: "overwriting disk with random data" },
  { pattern: /-[rR]\w*\s+\/([\s;|&]|$)/, risk: "high", reason: "recursive operation on root" },
  { pattern: /--no-preserve-root/, risk: "high", reason: "no-preserve-root flag" },

  // === Fork bomb ===
  { pattern: /:\(\)\s*\{.*\|.*&\s*\}\s*;?\s*:/, risk: "high", reason: "fork bomb" },

  // === Privilege escalation ===
  { pattern: /\bchmod\b.*u\+s\b/, risk: "high", reason: "setting SUID bit" },
  { pattern: /\bchmod\b.*\+s\b/, risk: "high", reason: "setting SUID/SGID bit" },
  { pattern: /\/etc\/sudoers/, risk: "high", reason: "modifying sudoers" },
  { pattern: /NOPASSWD/, risk: "high", reason: "adding passwordless sudo" },
  { pattern: /\buseradd\b.*-u\s*0\b/, risk: "high", reason: "creating root-equivalent user" },

  // === SSH manipulation ===
  { pattern: />>\s*~?\/?\.ssh\/authorized_keys/, risk: "high", reason: "adding SSH authorized key" },
  { pattern: /\bssh\b.*-R\s+\d+/, risk: "high", reason: "SSH reverse tunnel" },

  // === Cron persistence ===
  { pattern: /\bcrontab\b.*-$/, risk: "high", reason: "replacing crontab from stdin" },
  { pattern: /\bcrontab\b.*\|.*\bcrontab\b/, risk: "high", reason: "modifying crontab" },
  { pattern: /\becho\b.*\bcrontab\b/, risk: "high", reason: "injecting cron job" },
  { pattern: /\bcurl\b.*\bcrontab\b|\bcrontab\b.*\bcurl\b/, risk: "high", reason: "remote cron injection" },

  // === Log tampering ===
  { pattern: />\s*\/var\/log\//, risk: "high", reason: "overwriting log file" },
  { pattern: /\brm\b.*\/var\/log\//, risk: "high", reason: "deleting log file" },
  { pattern: /\bhistory\s+-c\b/, risk: "high", reason: "clearing shell history" },

  // === Firewall / network manipulation ===
  { pattern: /\biptables\b.*-F\b/, risk: "high", reason: "flushing firewall rules" },
  { pattern: /\biptables\b.*-P\b.*ACCEPT/, risk: "high", reason: "setting permissive firewall policy" },
  { pattern: /\bufw\s+disable\b/, risk: "high", reason: "disabling firewall" },
  { pattern: /\bip_forward\b.*=\s*1/, risk: "high", reason: "enabling IP forwarding" },

  // === Docker escape / abuse ===
  { pattern: /\bdocker\b.*--privileged/, risk: "high", reason: "privileged container" },
  { pattern: /\bdocker\b.*-v\s+\/:\//,  risk: "high", reason: "mounting host root into container" },
  { pattern: /\bnsenter\b/, risk: "high", reason: "namespace enter (container escape)" },
  { pattern: /\bchroot\b.*\/host/, risk: "high", reason: "chroot into host filesystem" },

  // === SQL destructive keywords ===
  { pattern: /\b(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE)\b/i, risk: "high", reason: "destructive SQL" },

  // === Argument injection patterns ===
  { pattern: /\bgit\s+show\b.*--output=/, risk: "high", reason: "git show output redirect (argument injection)" },
  { pattern: /\brg\b.*--pre\b/, risk: "high", reason: "ripgrep pre-processor (argument injection)" },
  { pattern: /\bgo\s+test\b.*-exec\b/, risk: "high", reason: "go test exec (argument injection)" },

  // === Sensitive file writes ===
  { pattern: />\s*~?\/?\.ssh\//, risk: "high", reason: "writing to SSH directory" },
  { pattern: />\s*~?\/?\.aws\//, risk: "high", reason: "writing to AWS credentials" },
  { pattern: />\s*~?\/?\.gnupg\//, risk: "high", reason: "writing to GPG directory" },
];

/**
 * Classify risk for a full compound command string.
 * Returns the highest risk found, or null if no compound patterns match.
 */
export function classifyCompoundRisk(rawCommand: string): RiskLevel | null {
  let highest: RiskLevel | null = null;
  const riskOrder: RiskLevel[] = ["low", "medium", "high"];

  for (const { pattern, risk } of COMPOUND_PATTERNS) {
    if (pattern.test(rawCommand)) {
      if (!highest || riskOrder.indexOf(risk) > riskOrder.indexOf(highest)) {
        highest = risk;
      }
    }
  }

  return highest;
}
