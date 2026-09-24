// One-off measurement for issue #6: full-scale confidence stats for
// cnippet and uiable, using the exact same methodology as the original
// catalog-wide baseline (24.4% under 0.6 across the four choice
// dimensions: category, motion, visual_density, interaction_model).
// Zero classifier.dev cost: this reads already-tagged, already-committed
// data/tags/*.json, no new tagging.
import fs from "node:fs";

const CHOICE_DIMS = ["category", "motion", "visual_density", "interaction_model"];

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
