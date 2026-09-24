// Deterministic, zero-model-call filtering and composition_level derivation.
// Rules and evidence are documented in docs/FILTER_REPORT.md and
// docs/DECISIONS.md #7 and #9. Every rule here is scoped to the registry
// where its signal was actually confirmed; nothing is applied globally.

import type { RawRegistryItem } from "../runtime/types.js";
import type { CompositionLevel, Variant } from "../runtime/types.js";

export interface FilterDropped {
  registry: string;
  name: string;
  rule: string;
  reason: string;
}

export interface FilterKeptItem {
  item: RawRegistryItem;
  compositionLevel: CompositionLevel;
  variants?: Variant[];
}

export interface FilterResult {
  kept: FilterKeptItem[];
  dropped: FilterDropped[];
}

const REACT_BITS_VARIANT_SUFFIX = /-(JS|TS)-(CSS|TW)$/;
const REACT_BITS_STACK_PRIORITY = ["-TS-TW", "-TS-CSS", "-JS-TW", "-JS-CSS"];

function filterReactBits(items: RawRegistryItem[]): FilterResult {
  const dropped: FilterDropped[] = [];
  const kept: FilterKeptItem[] = [];
  const groups = new Map<string, RawRegistryItem[]>();

  for (const item of items) {
    const base = item.name.replace(REACT_BITS_VARIANT_SUFFIX, "");
    const group = groups.get(base) ?? [];
    group.push(item);
    groups.set(base, group);
  }

  for (const [base, group] of groups) {
    let canonical: RawRegistryItem | undefined;
    for (const suffix of REACT_BITS_STACK_PRIORITY) {
      canonical = group.find((i) => i.name.endsWith(suffix));
      if (canonical) break;
    }
    if (!canonical) canonical = group[0];

    const variants: Variant[] = group.map((i) => {
      const m = i.name.match(REACT_BITS_VARIANT_SUFFIX);
      const stack = m ? `${m[1]}-${m[2]}` : "unknown";
      return { stack, registryItemName: i.name };
    });

    kept.push({ item: canonical, compositionLevel: "composite", variants });

    for (const i of group) {
      if (i.name === canonical.name) continue;
      dropped.push({
        registry: "react-bits",
        name: i.name,
        rule: "variant-duplicate",
        reason: `duplicate variant of "${base}", canonical kept is "${canonical.name}"`,
      });
    }
  }

  return { kept, dropped };
}

function filterMagicui(items: RawRegistryItem[]): FilterResult {
  const dropped: FilterDropped[] = [];
  const kept: FilterKeptItem[] = [];
  for (const item of items) {
    if (item.type === "registry:example") {
      dropped.push({
        registry: "magicui",
        name: item.name,
        rule: "demo-type",
        reason: `type is "registry:example"; registryDependencies points to real component "${(item.registryDependencies ?? []).join(",")}"`,
      });
      continue;
    }
    if (item.type === "registry:style") {
      dropped.push(styleConfigDrop("magicui", item.name));
      continue;
    }
    const compositionLevel: CompositionLevel = item.type === "registry:ui" ? "primitive" : "utility-hook";
    kept.push({ item, compositionLevel });
  }
  return { kept, dropped };
}

// A registry:style entry (always named "index" in every registry seen so
// far) registers Tailwind/CSS-variable config for the whole registry. It
// has no name, description, or file content of its own to tag, confirmed
// empty on both magicui and animate-ui during the pilot run (see
// docs/DECISIONS.md #14). It is not a component and is dropped, not tagged
// as a zero-signal "utility-hook".
function styleConfigDrop(registry: string, name: string): FilterDropped {
  return {
    registry,
    name,
    rule: "style-config",
    reason: 'type is "registry:style", the registry\'s own theme/CSS-variable installer, not a component; has no name, description, or content to tag',
  };
}

function filterAnimateUi(items: RawRegistryItem[]): FilterResult {
  const dropped: FilterDropped[] = [];
  const kept: FilterKeptItem[] = [];
  for (const item of items) {
    if (item.name.startsWith("demo-")) {
      dropped.push({
        registry: "animate-ui",
        name: item.name,
        rule: "demo-prefix",
        reason: `name starts with "demo-"; registryDependencies points to real component "${(item.registryDependencies ?? []).join(",")}"`,
      });
      continue;
    }
    if (item.type === "registry:style") {
      dropped.push(styleConfigDrop("animate-ui", item.name));
      continue;
    }
    let compositionLevel: CompositionLevel = "primitive";
    if (item.name.startsWith("components-")) compositionLevel = "composite";
    else if (item.name.startsWith("primitives-") || item.name.startsWith("icons-")) compositionLevel = "primitive";
    else if (item.type === "registry:hook" || item.type === "registry:lib") compositionLevel = "utility-hook";
    kept.push({ item, compositionLevel });
  }
  return { kept, dropped };
}

function filterAceternity(items: RawRegistryItem[]): FilterResult {
  // No drops: the primitive/block join was attempted and found unreliable
  // (docs/DECISIONS.md #8). Both sides stay.
  const kept: FilterKeptItem[] = items.map((item) => ({
    item,
    compositionLevel: item.type === "registry:block" ? "page-template" : "primitive",
  }));
  return { kept, dropped: [] };
}

function filterKokonutui(items: RawRegistryItem[]): FilterResult {
  const kept: FilterKeptItem[] = items.map((item) => ({
    item,
    compositionLevel:
      item.type === "registry:hook" || item.type === "registry:lib" ? "utility-hook" : "composite",
  }));
  return { kept, dropped: [] };
}

function filterMotionPrimitives(items: RawRegistryItem[]): FilterResult {
  const kept: FilterKeptItem[] = items.map((item) => ({ item, compositionLevel: "primitive" }));
  return { kept, dropped: [] };
}

// Product-UI expansion (docs/REGISTRY_EXPANSION_STEP1_2.md, step 1). Each
// of these four passed manual inspection with no demo/duplicate pollution
// found: no registry:example/registry:style/demo- items beyond what the
// generic rules already catch correctly, and no undetected variant or
// name-collision pattern like react-aria's tailwind-/css-/hooks- triple
// publishing (which is why react-aria itself is excluded, not here).

function filterShadcnblocks(items: RawRegistryItem[]): FilterResult {
  // registry:block (page-level section designs, e.g. hero327, feature356)
  // and registry:component (smaller reusable pieces, e.g. input-standard-2)
  // are both real, distinct content; verified during step 1 that the large
  // numbered families (feature1..feature356, hero1..hero327) are genuinely
  // different designs, not the same component republished, so nothing is
  // collapsed. No registry:example/style/demo- items exist in this registry.
  const kept: FilterKeptItem[] = items.map((item) => ({
    item,
    compositionLevel: item.type === "registry:block" ? "page-template" : "composite",
  }));
  return { kept, dropped: [] };
}

function filterShadcnDashboard(items: RawRegistryItem[]): FilterResult {
  // Same shape as shadcnblocks: registry:block sections and
  // registry:component pieces, numbered families (label-01..label-06,
  // textarea-09) verified as genuinely different compositions, not
  // duplicates. No registry:example/style/demo- items exist.
  const kept: FilterKeptItem[] = items.map((item) => ({
    item,
    compositionLevel: item.type === "registry:block" ? "page-template" : "composite",
  }));
  return { kept, dropped: [] };
}

function filterAssistantUi(items: RawRegistryItem[]): FilterResult {
  const dropped: FilterDropped[] = [];
  const kept: FilterKeptItem[] = [];
  for (const item of items) {
    if (item.type === "registry:style") {
      dropped.push(styleConfigDrop("assistant-ui", item.name));
      continue;
    }
    let compositionLevel: CompositionLevel = "composite";
    if (item.type === "registry:hook" || item.type === "registry:lib") compositionLevel = "utility-hook";
    else if (item.type === "registry:ui") compositionLevel = "primitive";
    // registry:page and registry:item (verified in step 1: ai-sdk-backend,
    // ai-sdk-backend-resumable, eve-chat) are real standalone installable
    // artifacts, not demos of another entry, so they are kept as
    // page-template rather than dropped.
    else if (item.type === "registry:page" || item.type === "registry:item") compositionLevel = "page-template";
    kept.push({ item, compositionLevel });
  }
  return { kept, dropped };
}

function filterBundui(items: RawRegistryItem[]): FilterResult {
  // All registry:component. Numbered/suffixed families (alert-default,
  // alert-with-icon, alert-with-dismiss) verified in step 1 as genuinely
  // different compositions, not stack-variant duplicates. No
  // registry:example/style/demo- items exist.
  const kept: FilterKeptItem[] = items.map((item) => ({ item, compositionLevel: "composite" }));
  return { kept, dropped: [] };
}

// Second product-UI expansion (step 1 recon, cnippet/uiable/shadcnuikit/
// shadcn-space). shadcnuikit and shadcn-space were excluded entirely for
// confirmed real paywalls found by the per-item availability check; only
// cnippet and uiable are filtered here.

function filterCnippet(items: RawRegistryItem[]): FilterResult {
  const dropped: FilterDropped[] = [];
  const kept: FilterKeptItem[] = [];
  for (const item of items) {
    if (item.type === "registry:style") {
      dropped.push(styleConfigDrop("cnippet", item.name));
      continue;
    }
    let compositionLevel: CompositionLevel = "composite";
    if (item.type === "registry:ui") compositionLevel = "primitive";
    else if (item.type === "registry:font" || item.type === "registry:lib" || item.type === "registry:hook") {
      compositionLevel = "utility-hook";
    }
    kept.push({ item, compositionLevel });
  }
  return { kept, dropped };
}

// uiable's 17 registry:theme items (uiable-preset-2..uiable-preset-18) are
// theme presets ("UIAble preset-N theme preset"), not installable UI
// components, the same shape as the registry:style drop already applied
// elsewhere. Everything else (registry:ui, registry:block) passed step 1
// with no demo/duplicate pollution found; its near-name-echo description
// quality is a known limitation, not a filter defect, so it ships as is.
function filterUiable(items: RawRegistryItem[]): FilterResult {
  const dropped: FilterDropped[] = [];
  const kept: FilterKeptItem[] = [];
  for (const item of items) {
    if (item.type === "registry:theme") {
      dropped.push({
        registry: "uiable",
        name: item.name,
        rule: "theme-preset",
        reason: 'type is "registry:theme", a color/theme preset, not a component; has no visual identity of its own to tag',
      });
      continue;
    }
    const compositionLevel: CompositionLevel = item.type === "registry:ui" ? "primitive" : "composite";
    kept.push({ item, compositionLevel });
  }
  return { kept, dropped };
}

export function applyFilter(registry: string, items: RawRegistryItem[]): FilterResult {
  switch (registry) {
    case "react-bits":
      return filterReactBits(items);
    case "magicui":
      return filterMagicui(items);
    case "animate-ui":
      return filterAnimateUi(items);
    case "aceternity":
      return filterAceternity(items);
    case "kokonutui":
      return filterKokonutui(items);
    case "motion-primitives":
      return filterMotionPrimitives(items);
    case "shadcnblocks":
      return filterShadcnblocks(items);
    case "shadcn-dashboard":
      return filterShadcnDashboard(items);
    case "assistant-ui":
      return filterAssistantUi(items);
    case "bundui":
      return filterBundui(items);
    case "cnippet":
      return filterCnippet(items);
    case "uiable":
      return filterUiable(items);
    default:
      throw new Error(`No filter rule defined for registry "${registry}". See docs/FILTER_REPORT.md.`);
  }
}
