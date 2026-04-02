#!/usr/bin/env node

/**
 * Hook script for non-Kiro IDEs (VS Code Copilot, Cursor, Windsurf, Claude Code).
 * Reads tool invocation from stdin, explains the command, writes result to stdout.
 *
 * stdin:  { "tool_name": "bash", "tool_input": { "command": "rm -rf /tmp" } }
 * stdout: { "hookSpecificOutput": { "additionalContext": "..." } }
 */

import { explainCommand } from "./explainer.js";

const SHELL_TOOL_NAMES = new Set([
  "bash", "shell", "terminal", "run_command", "execute_command",
  "run_terminal_command", "executeBash",
]);

async function main() {
  let input = "";

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    process.exit(0);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
    return;
  }

  const toolName = data.tool_name as string | undefined;

  // Only explain shell/bash tools
  if (toolName && !SHELL_TOOL_NAMES.has(toolName)) {
    process.exit(0);
  }

  // Extract command string from various input shapes
  const toolInput = data.tool_input as Record<string, unknown> | undefined;
  const command = (toolInput?.command ?? toolInput?.cmd ?? toolInput?.script) as string | undefined;

  if (!command) {
    process.exit(0);
  }

  const result = await explainCommand(command);

  const riskEmoji = result.risk === "high" ? "🔴" : result.risk === "medium" ? "🟡" : "🟢";
  const context = `${riskEmoji} ${result.explanation} [risk: ${result.risk}]`;

  const output = {
    hookSpecificOutput: {
      additionalContext: context,
    },
  };

  process.stdout.write(JSON.stringify(output));
}

main().catch(() => process.exit(0));
