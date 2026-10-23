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
import { hintableLabels } from "./runtime/brief.js";

const server = new McpServer({
  name: "matchcn",
  version: "0.2.8",
});

// Built from REGISTRIES rather than hand-listed, so the tool description
// can never drift out of sync with what's actually indexed again (it
// previously named only 9 of 14 active registries after several were
// added without updating this string, see GitHub issue #26).
const registryNameList = REGISTRIES.map((r) => r.name);
const registryNames = registryNameList.join(", ");

// Hint enums are built from DIMENSIONS for the same reason: the labels an
// agent may send can never drift from the labels components were tagged with.
function labelEnum(key: string) {
  return z.enum(hintableLabels(key) as [string, ...string[]]);
}

server.registerTool(
  "pick_component",
  {
    title: "Pick a shadcn-format component",
    description:
      `Given a plain-language description of a UI need, finds the best-matching component across the indexed shadcn-format registries (${registryNames}). Returns one of three outcomes: confident (one clear winner), shortlist (several strong candidates with the differentiating dimension named), or no_match (nothing fits, closest candidates shown but marked rejected). Never a forced best guess. Fastest path: write the brief in English, fill in \`hints\` with your own read of what is needed, and set \`resolve: "caller"\`. matchcn then makes no model calls at all (ranking is local and deterministic) and, when there is no clear winner, returns a ranked shortlist with a summary per candidate for you to choose from.`,
    inputSchema: {
      brief: z.string().describe("Plain-language description of the component needed, any language"),
      registry: z
        .enum(registryNameList as [string, ...string[]])
        .optional()
        .describe("Restrict the search to one registry"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Max candidates to return for a shortlist or no_match outcome (default 3, or 8 with resolve: "caller")'),
      hints: z
        .object({
          category: labelEnum("category").optional().describe("What kind of component it is"),
          motion: labelEnum("motion").optional().describe("Strongest motion it should have, from none to always-animating"),
          interaction_model: labelEnum("interaction_model").optional().describe("Primary way the user interacts with it"),
          domain: labelEnum("domain").optional().describe('Task or subject it serves; "general-purpose" for plain UI primitives'),
          visual_density: z.enum(["sparse", "dense"]).optional().describe("One clear subject (sparse) or many things competing for attention (dense)"),
          needs_external_data: z.boolean().optional().describe("Does it need real data/state from the app to be useful?"),
          decorative_only: z.boolean().optional().describe("Is it a purely visual effect with no content of its own?"),
        })
        .optional()
        .describe(
          "Your own structured read of the brief. When any hint is given, matchcn skips its server-side brief parsing (a remote classifier call) and ranks on these instead; omit a field you are unsure about rather than guessing, omitted fields are simply not ranked on.",
        ),
      resolve: z
        .enum(["server", "caller"])
        .optional()
        .describe(
          'Who breaks a tie between close candidates. "server" (default): matchcn makes one remote classifier call. "caller": matchcn returns the ranked shortlist with summaries and you pick, which is faster and lets you use what you know about the project.',
        ),
    },
  },
  async ({ brief, registry, maxResults, hints, resolve }) => {
    const result = await pickComponent({ brief, registry, maxResults, hints, resolve });
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
