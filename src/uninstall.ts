/**
 * `cmd-explain uninstall` — remove all cmd-explain configs from detected IDEs.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectIDEs, IDE_CONFIGS, type IDEConfig } from "./ide-configs.js";

function log(symbol: string, msg: string) {
  console.log(`  ${symbol} ${msg}`);
}

function removeMCPEntry(configPath: string): boolean {
  const fullPath = configPath.startsWith("/") ? configPath : join(process.cwd(), configPath);
  if (!existsSync(fullPath)) return false;

  try {
    const config = JSON.parse(readFileSync(fullPath, "utf-8"));
    if (config.mcpServers && "cmd-explain" in config.mcpServers) {
      delete config.mcpServers["cmd-explain"];
      writeFileSync(fullPath, JSON.stringify(config, null, 2) + "\n");
      return true;
    }
  } catch {
    // ignore parse errors
  }
  return false;
}

function removeHookFile(hookPath: string): boolean {
  const fullPath = join(process.cwd(), hookPath);
  if (existsSync(fullPath)) {
    unlinkSync(fullPath);
    return true;
  }
  return false;
}

export async function uninstall() {
  const cwd = process.cwd();

  console.log("\n  cmd-explain — Uninstalling\n");

  // Check all IDEs, not just detected ones (configs might exist even if IDE dir was removed)
  let removedAny = false;

  for (const ide of IDE_CONFIGS) {
    const mcpPath = ide.mcpConfigPath.startsWith("/")
      ? ide.mcpConfigPath
      : join(cwd, ide.mcpConfigPath);

    const removedMcp = removeMCPEntry(mcpPath);
    if (removedMcp) {
      log("✔", `Removed cmd-explain from ${ide.mcpConfigPath}`);
      removedAny = true;
    }

    if (ide.hookPath) {
      const removedHook = removeHookFile(ide.hookPath);
      if (removedHook) {
        log("✔", `Deleted ${ide.hookPath}`);
        removedAny = true;
      }
    }
  }

  if (!removedAny) {
    console.log("  No cmd-explain configs found to remove.\n");
  } else {
    console.log("\n  Done! cmd-explain has been removed.\n");
  }
}
