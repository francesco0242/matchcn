// Stage 5 (Surface), per docs/ARCHITECTURE.md. matchcn's one MCP tool,
// pick_component, over stdio. No web UI, per project scope.
//
// This is a thin wrapper: all the actual logic (Match, Resolve, the
// never-force-a-guess outcome rules) lives in src/runtime/pick.ts, which
// is also what src/pipeline/demo.ts calls directly to produce the
// test-brief report. This file only adapts that function to the MCP
// tool-call protocol.
//
// src/ is split into runtime/ (everything this file needs, shipped in
// the published package) and pipeline/ (ingest/tag/pilot/dev scripts,
// kept in the repo for development but not shipped). See
// docs/DECISIONS.md for why, and package.json's "files" field for the
// enforcement.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pickComponent } from "./runtime/pick.js";
import { REGISTRIES } from "./runtime/registries.js";

const server = new McpServer({
  name: "matchcn",
  version: "0.2.7",
});

// Built from REGISTRIES rather than hand-listed, so the tool description
// can never drift out of sync with what's actually indexed again (it
// previously named only 9 of 14 active registries after several were
// added without updating this string, see GitHub issue #26).
const registryNames = REGISTRIES.map((r) => r.name).join(", ");

server.registerTool(
  "pick_component",
  {
    title: "Pick a shadcn-format component",
    description:
      `Given a plain-language description of a UI need, finds the best-matching component across the indexed shadcn-format registries (${registryNames}). Returns one of three outcomes: confident (one clear winner), shortlist (several strong candidates with the differentiating dimension named), or no_match (nothing fits, closest candidates shown but marked rejected). Never a forced best guess.`,
    inputSchema: {
      brief: z.string().describe("Plain-language description of the component needed, any language"),
      registry: z
        .enum(REGISTRIES.map((r) => r.name) as [string, ...string[]])
        .optional()
        .describe("Restrict the search to one registry"),
      maxResults: z.number().int().min(1).max(10).optional().describe("Max candidates to return for a shortlist or no_match outcome (default 3)"),
    },
  },
  async ({ brief, registry, maxResults }) => {
    const result = await pickComponent({ brief, registry, maxResults });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
