#!/usr/bin/env node

/**
 * cmd-explain CLI.
 * Usage:
 *   npx cmd-explain setup [--ide <name>] [--no-hooks] [--ollama <model>]
 *   npx cmd-explain uninstall
 */

import { argv, exit } from "node:process";
import { setup } from "./setup.js";
import { uninstall } from "./uninstall.js";

const args = argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
  cmd-explain — CLI Command Explainer

  Usage:
    npx cmd-explain setup              Auto-detect IDEs and install
    npx cmd-explain setup --ide kiro   Install for a specific IDE only
    npx cmd-explain setup --no-hooks   MCP server config only, no auto-explain hook
    npx cmd-explain setup --ollama <model>  Enable LLM tier with Ollama model
    npx cmd-explain uninstall          Remove all cmd-explain configs
    npx cmd-explain --help             Show this help
`);
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-hooks") {
      flags.noHooks = true;
    } else if (arg === "--ide" && args[i + 1]) {
      flags.ide = args[++i];
    } else if (arg === "--ollama" && args[i + 1]) {
      flags.ollamaModel = args[++i];
    } else if (arg === "--openai-key" && args[i + 1]) {
      flags.openaiKey = args[++i];
    }
  }
  return flags;
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    exit(0);
  }

  if (command === "setup") {
    const flags = parseFlags(args.slice(1));
    await setup({
      ide: flags.ide as string | undefined,
      noHooks: flags.noHooks as boolean | undefined,
      ollamaModel: flags.ollamaModel as string | undefined,
      openaiKey: flags.openaiKey as string | undefined,
    });
  } else if (command === "uninstall") {
    await uninstall();
  } else {
    console.error(`  Unknown command: ${command}`);
    printUsage();
    exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  exit(1);
});
