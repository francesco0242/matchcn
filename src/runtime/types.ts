import { z } from "zod";

// Shape of one entry in a registry's registry.json `items` array. Fields
// vary per registry (see docs/RECON.md); everything is optional except
// name and type.
export const RawRegistryItemSchema = z.object({
  name: z.string(),
  type: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  files: z
    .array(
      z.object({
        path: z.string().optional(),
        type: z.string().optional(),
        target: z.string().optional(),
        content: z.string().optional(),
      }),
    )
    .optional(),
  dependencies: z.array(z.string()).optional(),
  registryDependencies: z.array(z.string()).optional(),
});
export type RawRegistryItem = z.infer<typeof RawRegistryItemSchema>;

export const RawRegistryIndexSchema = z.object({
  name: z.string().optional(),
  homepage: z.string().optional(),
  items: z.array(RawRegistryItemSchema),
});
export type RawRegistryIndex = z.infer<typeof RawRegistryIndexSchema>;

export const CompositionLevel = z.enum([
  "primitive",
  "composite",
  "page-template",
  "utility-hook",
]);
export type CompositionLevel = z.infer<typeof CompositionLevel>;

// One installable variant of a canonical component (react-bits publishes
// each component 4x, see docs/DECISIONS.md #7 and #11).
export const VariantSchema = z.object({
  stack: z.string(), // e.g. "TS-TW", "JS-CSS"
  registryItemName: z.string(),
});
export type Variant = z.infer<typeof VariantSchema>;

// One row of the normalized ingest record, written to
// .cache/normalized/<registry>.json. This is the input to both Filter and
// Tag; it is never committed as-is (tags are what gets committed).
export const NormalizedComponentSchema = z.object({
  registry: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  rawType: z.string(),
  compositionLevel: CompositionLevel,
  filePaths: z.array(z.string()),
  dependencies: z.array(z.string()),
  sourceUrl: z.string(),
  fetchedAt: z.string(),
  variants: z.array(VariantSchema).optional(),
  enrichedFromSource: z.boolean().default(false),
  // The text actually sent to classifier.dev as this item's input: title +
  // description, or title + description + trimmed source when enriched.
  // See src/enrich.ts.
  taggingText: z.string(),
});
export type NormalizedComponent = z.infer<typeof NormalizedComponentSchema>;

// classifier.dev's per-dimension answer shape (choice dimensions).
export const ChoiceAnswerSchema = z.object({
  label: z.string().nullable(),
  confidence: z.number().nullable(),
  scores: z.record(z.string(), z.number()).nullable().optional(),
  model: z.string().optional(),
  ms: z.number().optional(),
});
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;

// classifier.dev's per-dimension answer shape (noul dimensions): a bare
// probability, no confidence field (see docs/DIMENSIONS.md).
export const NoulAnswerSchema = z.object({
  probability: z.number().nullable(),
  model: z.string().optional(),
  ms: z.number().optional(),
});
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;

// One row of a committed data/tags/<registry>.json file.
export const TagRecordSchema = z.object({
  registry: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  compositionLevel: CompositionLevel,
  sourceUrl: z.string(),
  variants: z.array(VariantSchema).optional(),
  dimensions: z.object({
    category: ChoiceAnswerSchema,
    motion: ChoiceAnswerSchema,
    visual_density: ChoiceAnswerSchema,
    interaction_model: ChoiceAnswerSchema,
    needs_external_data: NoulAnswerSchema,
    decorative_only: NoulAnswerSchema,
  }),
  taggedAt: z.string(),
  inputCharCount: z.number(),
});
export type TagRecord = z.infer<typeof TagRecordSchema>;
