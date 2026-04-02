#!/usr/bin/env node

/**
 * cmd-explain MCP server.
 * Exposes a single tool: explain_command
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { explainCommand } from "./explainer.js";

const server = new McpServer({
  name: "cmd-explain",
  version: "0.1.0",
});

server.tool(
  "explain_command",
  "Explains a CLI command in one sentence. Returns the explanation, risk level (low/medium/high), and parsed command structure.",
  {
    command: z.string().describe("The full CLI command to explain"),
  },
  async ({ command }) => {
    const result = await explainCommand(command);

    const parsed = result.segments.length === 1
      ? result.segments[0].parsed
      : undefined;

    const tierLabel = (tier: number) => {
      switch (tier) {
        case 1: return "built-in";
        case 2: return "system";
        case 3: return "ai-generated";
        default: return "unknown";
      }
    };

    const response: Record<string, unknown> = {
      explanation: result.explanation,
      risk: result.risk,
      source: result.segments.length === 1
        ? tierLabel(result.segments[0].tier)
        : "mixed",
    };

    if (parsed) {
      response.parsed = {
        program: parsed.program,
        subcommand: parsed.subcommand,
        flags: parsed.flags,
        args: parsed.args,
      };
    }

    if (result.segments.length > 1) {
      response.segments = result.segments.map(s => ({
        explanation: s.explanation,
        risk: s.risk,
        parsed: {
          program: s.parsed.program,
          subcommand: s.parsed.subcommand,
          flags: s.parsed.flags,
          args: s.parsed.args,
        },
      }));
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
