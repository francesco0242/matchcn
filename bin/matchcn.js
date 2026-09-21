#!/usr/bin/env node
// CLI/MCP entry point for the matchcn package. No build step in v0
// (docs/ROADMAP.md); this uses tsx's documented programmatic API
// (tsx/esm/api's register(), not the raw --loader hook, which Node
// rejects when loaded this way, see docs/DECISIONS.md) to enable
// on-the-fly TypeScript loading, then runs the real MCP server entry
// point directly from source. tsx is a runtime dependency, not a
// devDependency, specifically because this file needs it after install.

import { register } from "tsx/esm/api";

const unregister = register();
try {
  await import("../src/mcp-server.ts");
} finally {
  // mcp-server.ts's main() runs the stdio server indefinitely, so this
  // only actually fires if that import itself throws before starting it.
  unregister();
}
