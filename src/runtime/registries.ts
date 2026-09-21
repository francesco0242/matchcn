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
  {
    name: "shadcnblocks",
    indexUrl: "https://shadcnblocks.com/r/registry.json",
    itemUrlTemplate: "https://shadcnblocks.com/r/{name}.json",
  },
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
];
