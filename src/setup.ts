/**
 * `cmd-explain setup` — auto-detect IDEs and install MCP config + hooks.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { detectIDEs, getIDEByName, getMCPEntry, type IDEConfig } from "./ide-configs.js";

const execFileAsync = promisify(execFile);

export interface SetupOptions {
  ide?: string;
  noHooks?: boolean;
  ollamaModel?: string;
  openaiKey?: string;
}

function log(symbol: string, msg: string) {
  console.log(`  ${symbol} ${msg}`);
}

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read a JSON file, or return an empty object if it doesn't exist.
 */
function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Merge the cmd-explain MCP entry into an existing config file.
 * Never overwrites existing keys other than "cmd-explain".
 */
function mergeMCPConfig(configPath: string, mcpEntry: Record<string, unknown>): boolean {
  ensureDir(configPath);
  const config = readJsonFile(configPath);

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  (config.mcpServers as Record<string, unknown>)["cmd-explain"] = mcpEntry;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return true;
}

function writeHookFile(hookPath: string, content: string): boolean {
  ensureDir(hookPath);
  writeFileSync(hookPath, content);
  return true;
}

function installIDE(ide: IDEConfig, cwd: string, options: SetupOptions): { mcp: boolean; hook: boolean } {
  const mcpEntry = getMCPEntry({ ollamaModel: options.ollamaModel, openaiKey: options.openaiKey });

  // Resolve MCP config path (could be absolute for user-level configs)
  const mcpPath = ide.mcpConfigPath.startsWith("/") || ide.mcpConfigPath.startsWith("~")
    ? ide.mcpConfigPath
    : join(cwd, ide.mcpConfigPath);

  const mcp = mergeMCPConfig(mcpPath, mcpEntry);

  let hook = false;
  if (!options.noHooks && ide.hookPath && ide.hookContent) {
    const hookFullPath = join(cwd, ide.hookPath);
    hook = writeHookFile(hookFullPath, ide.hookContent());
  }

  return { mcp, hook };
}

export async function setup(options: SetupOptions = {}) {
  const cwd = process.cwd();

  console.log("\n  cmd-explain — CLI Command Explainer\n");

  // Determine which IDEs to install for
  let ides: IDEConfig[];

  if (options.ide) {
    const ide = getIDEByName(options.ide);
    if (!ide) {
      console.error(`  ✗ Unknown IDE: ${options.ide}`);
      console.error(`  Supported: kiro, vscode, cursor, windsurf, claude`);
      process.exit(1);
    }
    ides = [ide];
    log("→", `Targeting ${ide.displayName}`);
  } else {
    console.log("  Detecting IDEs...");
    ides = detectIDEs(cwd);

    if (ides.length === 0) {
      console.log("  No supported IDE config directories found in this workspace.");
      console.log("  Use --ide <name> to target a specific IDE.");
      console.log("  Supported: kiro, vscode, cursor, windsurf, claude\n");
      process.exit(1);
    }

    for (const ide of ides) {
      log("✔", `Found ${ide.displayName}`);
    }
  }

  // Install MCP config
  console.log("\n  Installing MCP server config...");
  for (const ide of ides) {
    const result = installIDE(ide, cwd, options);
    if (result.mcp) {
      const configDisplay = ide.mcpConfigPath.startsWith("/")
        ? ide.mcpConfigPath
        : ide.mcpConfigPath;
      log("✔", `Updated ${configDisplay}`);
    }
  }

  // Install hooks
  if (!options.noHooks) {
    const hookableIDEs = ides.filter((ide) => ide.hookPath && ide.hookContent);
    if (hookableIDEs.length > 0) {
      console.log("\n  Installing pre-command hooks...");
      for (const ide of hookableIDEs) {
        log("✔", `Created ${ide.hookPath}`);
      }
    }
  }

  // Validate Ollama setup if requested
  if (options.ollamaModel) {
    console.log("\n  Checking Ollama setup...");

    // Check if ollama is installed
    let ollamaInstalled = false;
    try {
      await execFileAsync("which", ["ollama"], { timeout: 3000 });
      ollamaInstalled = true;
      log("✔", "Ollama found");
    } catch {
      log("✗", "Ollama not found. Install it first:");
      console.log("      brew install ollama");
      console.log("      brew services start ollama\n");
      console.log(`    Then pull the model:`);
      console.log(`      ollama pull ${options.ollamaModel}\n`);
      console.log(`    Then re-run:`);
      console.log(`      npx cmd-explain setup --ollama ${options.ollamaModel}\n`);
      process.exit(1);
    }

    // Check if the model is pulled
    if (ollamaInstalled) {
      try {
        const { stdout } = await execFileAsync("ollama", ["list"], { timeout: 5000 });
        const modelBase = options.ollamaModel.split(":")[0];
        if (stdout.includes(modelBase)) {
          log("✔", `Model ${options.ollamaModel} available`);
        } else {
          log("✗", `Model ${options.ollamaModel} not found. Pull it first:`);
          console.log(`      ollama pull ${options.ollamaModel}\n`);
          console.log(`    Then re-run:`);
          console.log(`      npx cmd-explain setup --ollama ${options.ollamaModel}\n`);
          process.exit(1);
        }
      } catch {
        log("⚠", "Could not verify model — make sure Ollama is running (`ollama serve`)");
      }
    }

    console.log(`\n  Local AI: Ollama (${options.ollamaModel})`);
  } else if (options.openaiKey) {
    console.log("\n  LLM: OpenAI (API key configured)");
  }

  console.log("\n  Done! Restart your IDE to activate.");
  console.log("  Every shell command will now show a one-line explanation before approval.\n");
}
