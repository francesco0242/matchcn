// matchcn's demo: 3 briefs, clean terminal output, meant to be recorded.
// Calls the same pickComponent function the MCP tool in
// src/mcp-server.ts calls, so this is exactly what the MCP tool returns,
// formatted for a human reading a terminal instead of raw JSON.
//
// Usage: pnpm demo

import { pickComponent, type PickResult, type ComponentOutput } from "./runtime/pick.js";

const BRIEFS = [
  "custom cursor that follows the mouse with a trailing effect",
  "a dense bento grid for a landing page",
  "a date picker with range selection",
];

const OUTCOME_LABEL: Record<string, string> = {
  confident: "CONFIDENT",
  shortlist: "SHORTLIST",
  no_match: "NO MATCH",
};

function line(char: string, width = 70): string {
  return char.repeat(width);
}

function printComponent(c: ComponentOutput, marker: string) {
  console.log(`  ${marker} ${c.name}  (${c.registry})  confidence ${c.confidence}`);
  console.log(`    install: ${c.installCommand}`);
  if (c.variants && c.variants.length > 1) {
    console.log(`    variants: ${c.variants.map((v) => v.stack).join(", ")}`);
  }
  const matched = c.reasons.filter((r) => r.matched).map((r) => r.dimension);
  const notMatched = c.reasons.filter((r) => !r.matched).map((r) => r.dimension);
  console.log(`    matched:     ${matched.join(", ") || "(none)"}`);
  console.log(`    not matched: ${notMatched.join(", ") || "(none)"}`);
}

function printResult(brief: string, result: PickResult) {
  console.log();
  console.log(line("="));
  console.log(`BRIEF: ${brief}`);
  console.log(line("-"));
  console.log(`OUTCOME: ${OUTCOME_LABEL[result.outcome]}`);
  console.log(result.message);
  console.log();

  if (result.outcome === "confident" && result.chosen) {
    printComponent(result.chosen, "->");
  }

  if (result.outcome === "shortlist" && result.candidates) {
    if (result.differentiators && result.differentiators.length > 0) {
      console.log(`  differs on: ${result.differentiators.map((d) => d.dimension).join(", ")}`);
      console.log();
    }
    result.candidates.forEach((c, i) => printComponent(c, `${i + 1}.`));
  }

  if (result.outcome === "no_match" && result.candidates) {
    console.log("  closest (rejected, not a match):");
    result.candidates.forEach((c, i) => printComponent(c, `${i + 1}.`));
  }

  console.log();
  console.log(`resolve used: ${result.resolveUsed}   decisions spent: ${result.decisionsSpent}`);
}

async function main() {
  console.log(line("="));
  console.log("matchcn demo: pick_component against 3 briefs");
  console.log(line("="));

  let totalDecisions = 0;
  for (const brief of BRIEFS) {
    const result = await pickComponent({ brief });
    totalDecisions += result.decisionsSpent;
    printResult(brief, result);
  }

  console.log();
  console.log(line("="));
  console.log(`Total decisions spent: ${totalDecisions}`);
  console.log(line("="));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
