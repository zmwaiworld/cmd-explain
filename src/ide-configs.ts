/**
 * IDE detection and config path resolution.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface IDEConfig {
  name: string;
  displayName: string;
  /** Directory that indicates this IDE is in use (workspace-relative) */
  detectDir: string;
  /** Path to the MCP config file */
  mcpConfigPath: string;
  /** Path to the hook file to generate */
  hookPath: string | null;
  /** Hook content generator */
  hookContent: (() => string) | null;
}

function home(...segments: string[]): string {
  return join(homedir(), ...segments);
}

export const IDE_CONFIGS: IDEConfig[] = [
  {
    name: "kiro",
    displayName: "Kiro",
    detectDir: ".kiro",
    mcpConfigPath: ".kiro/settings/mcp.json",
    hookPath: ".kiro/hooks/cmd-explain.kiro.hook",
    hookContent: () => JSON.stringify({
      enabled: true,
      name: "cmd-explain",
      description: "Before running any shell command, calls the cmd-explain MCP server to show the command explanation and risk level to the user.",
      version: "1",
      when: {
        type: "preToolUse",
        toolTypes: ["shell"],
      },
      then: {
        type: "askAgent",
        prompt: "Before running this shell command, call the explain_command tool from the cmd-explain MCP server with the command string. You MUST display the explanation and risk level to the user as a single line (e.g. '🟢 git status — Show the working tree status. Risk: low') before proceeding with the command. Never skip displaying the explanation.",
      },
    }, null, 2) + "\n",
  },
  {
    name: "vscode",
    displayName: "VS Code Copilot",
    detectDir: ".vscode",
    mcpConfigPath: ".vscode/mcp.json",
    hookPath: ".github/hooks/cmd-explain.json",
    hookContent: () => JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            type: "command",
            command: "node ./node_modules/cmd-explain/dist/hook-script.js",
          },
        ],
      },
    }, null, 2) + "\n",
  },
  {
    name: "cursor",
    displayName: "Cursor",
    detectDir: ".cursor",
    mcpConfigPath: ".cursor/mcp.json",
    hookPath: ".cursor/hooks.json",
    hookContent: () => JSON.stringify({
      version: 1,
      hooks: {
        beforeShellExecution: [
          {
            command: "node ./node_modules/cmd-explain/dist/hook-script.js",
          },
        ],
      },
    }, null, 2) + "\n",
  },
  {
    name: "windsurf",
    displayName: "Windsurf",
    detectDir: ".windsurf",
    mcpConfigPath: home(".codeium", "windsurf", "mcp_config.json"),
    hookPath: ".windsurf/hooks.json",
    hookContent: () => JSON.stringify({
      hooks: {
        pre_run_command: [
          {
            command: "node ./node_modules/cmd-explain/dist/hook-script.js",
            show_output: true,
          },
        ],
      },
    }, null, 2) + "\n",
  },
  {
    name: "claude",
    displayName: "Claude Code",
    detectDir: ".claude",
    mcpConfigPath: home(".claude", "settings.json"),
    hookPath: ".claude/settings.json",
    hookContent: () => JSON.stringify({
      hooks: [
        {
          matcher: "Bash",
          event: "PreToolUse",
          type: "command",
          command: "node ./node_modules/cmd-explain/dist/hook-script.js",
        },
      ],
    }, null, 2) + "\n",
  },
];

export function detectIDEs(cwd: string): IDEConfig[] {
  return IDE_CONFIGS.filter((ide) => existsSync(join(cwd, ide.detectDir)));
}

export function getIDEByName(name: string): IDEConfig | undefined {
  return IDE_CONFIGS.find((ide) => ide.name === name.toLowerCase());
}

export function getMCPEntry(options?: { ollamaModel?: string; openaiKey?: string }): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: "npx",
    args: ["-y", "cmd-explain"],
  };

  const env: Record<string, string> = {};
  if (options?.ollamaModel) {
    env.OLLAMA_MODEL = options.ollamaModel;
  }
  if (options?.openaiKey) {
    env.OPENAI_API_KEY = options.openaiKey;
  }
  if (Object.keys(env).length > 0) {
    entry.env = env;
  }

  return entry;
}
