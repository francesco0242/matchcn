// Registries covered in v0. `indexUrl` was found by probing during recon
// (RECON.md); it is not always the same as the `{name}.json` per-item
// template shadcn's own registries.json publishes for each registry.
// `itemUrlTemplate` is that per-item template, used only for enrichment
// (src/enrich.ts) of components whose index description is missing or thin.

export interface RegistryConfig {
  name: string;
  indexUrl: string;
  itemUrlTemplate: string; // contains {name}
}

export const REGISTRIES: RegistryConfig[] = [
  {
    name: "react-bits",
    indexUrl: "https://reactbits.dev/r/registry.json",
    itemUrlTemplate: "https://reactbits.dev/r/{name}.json",
  },
  {
    name: "magicui",
    indexUrl: "https://magicui.design/registry.json",
    itemUrlTemplate: "https://magicui.design/r/{name}.json",
  },
  {
    name: "aceternity",
    indexUrl: "https://ui.aceternity.com/registry.json",
    itemUrlTemplate: "https://ui.aceternity.com/registry/{name}.json",
  },
  {
    name: "kokonutui",
    indexUrl: "https://kokonutui.com/r/registry.json",
    itemUrlTemplate: "https://kokonutui.com/r/{name}.json",
  },
  {
    name: "animate-ui",
    indexUrl: "https://animate-ui.com/r/registry.json",
    itemUrlTemplate: "https://animate-ui.com/r/{name}.json",
  },
  {
    name: "motion-primitives",
    indexUrl: "https://motion-primitives.com/c/registry.json",
    itemUrlTemplate: "https://motion-primitives.com/c/{name}.json",
  },
  // cult-ui excluded: blocked by a Vercel bot challenge on every index
  // fetch attempted during recon. See docs/DECISIONS.md #6.

  // Product-UI expansion, added after per-registry filter verification in
  // docs/REGISTRY_EXPANSION_STEP1_2.md. Three other candidates from the
  // same recon (shadcn-ui-blocks, plate, react-aria) were excluded for a
  // specific, evidenced defect each; see docs/ROADMAP.md.

  // shadcnblocks excluded here, 0.1.1: a real per-item availability check
  // (many of its blocks are pro/paywalled, 401/403 unauthenticated, see
  // ROADMAP.md) could not be completed cleanly. The 8-concurrent full-scale
  // check triggered the vendor's rate limiter into what looks like a broad
  // defensive block on this IP: the failure rate on later requests jumped
  // from an honest 48.7% (a clean small sample taken before the full run)
  // to an implausible 83.4%, evidence the later numbers reflect our own
  // block, not real per-item paywall status. Tagged data is preserved at
  // data/tags-raw/shadcnblocks.json, not lost. Re-add once a clean
  // full-scale check runs from an unblocked network, per ROADMAP.md.
  {
    name: "shadcn-dashboard",
    indexUrl: "https://shadcndashboard.dev/r/registry.json",
    itemUrlTemplate: "https://shadcndashboard.dev/r/{name}.json",
  },
  {
    name: "assistant-ui",
    indexUrl: "https://r.assistant-ui.com/registry.json",
    itemUrlTemplate: "https://r.assistant-ui.com/{name}.json",
  },
  {
    name: "bundui",
    indexUrl: "https://bundui.io/r/registry.json",
    itemUrlTemplate: "https://bundui.io/r/{name}.json",
  },

  // Second product-UI expansion. shadcnuikit and shadcn-space, evaluated
  // in the same recon pass, were both excluded: real per-item availability
  // checks (30-sample, low concurrency) found genuine paywalls on 40% and
  // 33.3% of their samples respectively, same shape as shadcnblocks/
  // shadcn-dashboard. Not worth the added complexity for this expansion.
  {
    name: "cnippet",
    indexUrl: "https://ui.cnippet.dev/r/registry.json",
    itemUrlTemplate: "https://ui.cnippet.dev/r/{name}.json",
  },
  {
    name: "uiable",
    indexUrl: "https://uiable.com/r/registry.json",
    itemUrlTemplate: "https://uiable.com/r/{name}.json",
  },

  // Third expansion: the two of the three candidates excluded in
  // REGISTRY_EXPANSION_STEP1_2.md for a fixable filter gap (plate,
  // react-aria) once their filters were written (filterPlate,
  // filterReactAria) and a real per-item availability check found no
  // paywall on either.
  {
    name: "plate",
    indexUrl: "https://platejs.org/r/registry.json",
    itemUrlTemplate: "https://platejs.org/r/{name}.json",
  },
  {
    name: "react-aria",
    indexUrl: "https://react-aria.adobe.com/registry/registry.json",
    itemUrlTemplate: "https://react-aria.adobe.com/registry/{name}.json",
  },

  // shadcn-ui-blocks was evaluated once already (see the third-expansion
  // comment above, and README Limitations) against its full registry.json,
  // which mixes free and "-pro-" paid blocks: a per-item check found 82%
  // of that combined index (3,198/3,903) return 401 unauthenticated, so it
  // was excluded entirely. The registry's own maintainer (Vaedros) later
  // reached out and pointed at a separate, curated free-only index the
  // vendor publishes at this URL, distinct from the mixed one. A fresh
  // per-item availability check against this URL's own 626 items found
  // 626/626 (100%) genuinely installable unauthenticated, zero "-pro-"
  // named items, zero registry:item (OG-image) pollution. Uses the same
  // filterShadcnUiBlocks() filter (which only drops registry:item; not
  // reached in practice here since this index has none).
  {
    name: "shadcn-ui-blocks",
    indexUrl: "https://www.shadcn-ui-blocks.com/r/free-registry.json",
    itemUrlTemplate: "https://www.shadcn-ui-blocks.com/r/{name}.json",
  },
];
