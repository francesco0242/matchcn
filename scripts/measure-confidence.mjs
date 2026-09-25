// One-off measurement for issue #6, later reused for issue #9's
// before/after comparison. `visual_density` moved from a choice-ordered
// dimension to a noul (continuous probability) one in the #9 fix, so it
// no longer has a `.confidence` field to read here (see `domain` in
// `dimensions.ts` for how a noul answer's `.probability` maps to a
// comparable weight, `Math.abs(p - 0.5) * 2`, if a future measurement
// needs to include it). This script's CHOICE_DIMS intentionally covers
// only the dimensions that still carry a `.confidence` field.
// Zero classifier.dev cost: this reads already-tagged, already-committed
// data/tags/*.json, no new tagging.
import fs from "node:fs";

const CHOICE_DIMS = ["category", "motion", "interaction_model", "domain"];

function measure(name) {
  const records = JSON.parse(fs.readFileSync(`data/tags/${name}.json`, "utf8"));
  let total = 0;
  let under06 = 0;
  for (const r of records) {
    for (const dim of CHOICE_DIMS) {
      const conf = r.dimensions[dim]?.confidence;
      if (conf == null) continue;
      total++;
      if (conf < 0.6) under06++;
    }
  }
  return { name, components: records.length, total, under06, pct: (under06 / total) * 100 };
}

const cnippet = measure("cnippet");
const uiable = measure("uiable");
const combinedUnder06 = cnippet.under06 + uiable.under06;
const combinedTotal = cnippet.total + uiable.total;

for (const r of [cnippet, uiable]) {
  console.log(`${r.name}: ${r.components} components, ${r.total} choice-dimension answers, ${r.under06} under 0.6 (${r.pct.toFixed(1)}%)`);
}
console.log(`combined: ${combinedUnder06}/${combinedTotal} under 0.6 (${((combinedUnder06/combinedTotal)*100).toFixed(1)}%)`);
