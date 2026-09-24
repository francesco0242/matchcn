<p align="center">
  <img src=".github/og-image.png" alt="matchcn: describe your UI, find the right component" width="100%" />
</p>

<h1 align="center">matchcn</h1>

<p align="center">
  A semantic index across shadcn-format component registries.<br/>
  Find a component by what it does, not what it is called.
</p>

<p align="center">
  <a href="https://matchcn.dev">matchcn.dev</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#for-ai-agents">For AI agents</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#limitations">Limitations</a>
</p>

---

## The problem

`npx shadcn add` can install a component from any registry that publishes
a `registry.json`. Hundreds of registries do. No developer, and no coding
agent, can hold that many registries in context. Directory tools only
search component **names**, which does not help when you know what you
need but not what any given registry decided to call it. "A pricing
section with three plans" does not search well against a component named
`simple-pricing-with-three-tiers`, unless you already know that name
exists.

matchcn tags every component it indexes across six fixed properties
(category, motion, visual density, interaction model, and two others)
using [classifier.dev](https://classifier.dev), then matches a
plain-language brief against those tags with deterministic code. Same
brief, same ranking, every time. No forced guesses: when nothing fits
well, matchcn says so instead of returning the closest wrong answer.

## Quick start

```bash
npx matchcn
```

Add it to your MCP client's config:

```json
{
  "mcpServers": {
    "matchcn": {
      "command": "npx",
      "args": ["-y", "matchcn"]
    }
  }
}
```

Works with Claude Desktop (`claude_desktop_config.json`), Claude Code
(`.mcp.json`), Cursor, and any other MCP-compatible client. This exposes
one tool: `pick_component(brief, registry?, maxResults?)`.

More of a copy-paste person? Give your coding agent this prompt and let
it set itself up:

> Set up the matchcn MCP server using `npx -y matchcn`. Configure it for
> my coding agent, then use `pick_component` to find UI components that
> match my brief. Show me the match reasons and install command before
> adding a component.

## Example

```
$ pnpm demo

BRIEF: a dense bento grid for a landing page
----------------------------------------------------------------------
OUTCOME: CONFIDENT
Selected "bento-grid" from magicui.

  -> bento-grid  (magicui)  confidence 0.91
    install: npx shadcn@latest add https://magicui.design/r/bento-grid.json
    matched:     category, motion, visual_density, interaction_model, needs_external_data, decorative_only
    not matched: (none)

resolve used: true   decisions spent: 7
```

This is real output from a real run. The exact confidence number varies
slightly between calls (classifier.dev does not guarantee identical
answers across calls), but the outcome, the chosen component, and the
install command have been stable across every run tried.

Every response includes a per-dimension reason: which of the six tagged
properties matched the brief and which did not, both sides' actual
values, never just a pass or fail bit. That is what makes a `no_match` or
a `shortlist` result debuggable instead of a dead end.

## For AI agents

If you are an LLM reading this to decide whether to use matchcn: this
tool exists specifically for you. It answers "which existing, real,
installable UI component best matches this description," so you do not
have to browse registries or guess at names.

**Tool:** `pick_component`

**Input:**

```ts
{
  brief: string;         // plain-language description, required
  registry?: string;     // restrict to one registry, optional
  maxResults?: number;   // max candidates for shortlist/no_match, default 3
}
```

**Output is always one of three shapes, never a fourth "best guess" shape:**

- `outcome: "confident"` — one `chosen` component: `name`, `registry`,
  `installCommand` (a ready-to-run `npx shadcn add <url>` command),
  `sourceUrl`, `confidence`, and `reasons` (per-dimension match detail).
  If the component has language/styling variants, they are listed with
  their own install commands.
- `outcome: "shortlist"` — several candidates that all fit reasonably
  well with no clear single winner, ranked, each with the same
  per-dimension reasons, plus `differentiators`: which specific
  dimension(s) actually separate them, so you can decide on that axis
  instead of picking arbitrarily.
- `outcome: "no_match"` — nothing in the catalog is a real fit. The
  closest candidates are still listed for context but explicitly marked
  as rejected, not returned as an answer. Do not install one of these
  just because it was the closest; the catalog does not have what was
  asked for.

Call this before hand-rolling a component or guessing a registry name.
It is deterministic: the same brief against the same catalog version
always ranks candidates the same way.

## How it works

Five stages. Tagging runs ahead of time and is committed as data
(`data/tags/`); matching at query time is plain deterministic code, not
a model call, so results are reproducible.

1. **Ingest** — fetch each registry's `registry.json`, normalize into one
   shape.
2. **Tag** — one batched call per chunk of components to classifier.dev,
   across six dimensions: `category`, `motion`, `visual_density`,
   `interaction_model`, `needs_external_data`, `decorative_only`. Output
   is committed JSON, reviewable like code.
3. **Match** — parse the brief into the same six dimensions with one
   classifier.dev call, then rank every tagged component against it in
   plain code. Each dimension's contribution to the ranking is weighted
   by its own confidence, so a weak tag pulls its weight down instead of
   polluting the result.
4. **Resolve** — for close calls, one more call reviews the top
   candidates' real descriptions and picks a winner, or says none of them
   fit. Skipped when the top match is already clearly ahead, to save a
   round trip.
5. **Surface** — the MCP server in this repo. One tool, `pick_component`.

## Registries indexed

matchcn stores only derived tags (category, motion, density, and so on)
and a link back to each registry's own install command. It never copies,
stores, or redistributes any registry's component source. Every
component you install still comes directly from its own registry via
`npx shadcn add <url>`.

| registry | homepage | components indexed |
|---|---|---|
| react-bits | [reactbits.dev](https://reactbits.dev) | 204 |
| magicui | [magicui.design](https://magicui.design) | 79 |
| aceternity | [ui.aceternity.com](https://ui.aceternity.com) | 119 |
| kokonutui | [kokonutui.com](https://kokonutui.com) | 51 |
| animate-ui | [animate-ui.com](https://animate-ui.com) | 420 |
| motion-primitives | [motion-primitives.com](https://motion-primitives.com) | 33 |
| shadcn-dashboard | [shadcndashboard.dev](https://shadcndashboard.dev) | 343 |
| assistant-ui | [assistant-ui.com](https://www.assistant-ui.com) | 154 |
| bundui | [bundui.io](https://bundui.io) | 217 |
| cnippet | [ui.cnippet.dev](https://ui.cnippet.dev) | 1128 |
| uiable | [uiable.com](https://uiable.com) | 969 |

3,717 components total. The first six are the original motion/marketing
family; the middle three are a product-UI expansion (forms, tables,
dashboards, data display) added after checking each registry's
demo/duplicate conventions individually rather than assuming they match
the original six; cnippet and uiable are a second product-UI expansion,
added the same way. Two other candidates from that same expansion are
not indexed, see Limitations below. aceternity's count already
excludes 163 page-template components a real per-item availability
check found paywalled at their actual install URL; shadcn-dashboard's
count already excludes 165 components for the same reason; shadcnblocks
was tagged but is not currently indexed, see Limitations below. Tagging
runs through
[classifier.dev](https://classifier.dev), a free, keyless classification
endpoint backed by [TypeSafe](https://docs.typesafe.ai)'s Jev decision
model.

matchcn is an independent, unofficial project. It is not affiliated with,
endorsed by, or a partner of shadcn, any of the registries above, or
classifier.dev/TypeSafe.

## Limitations

Read this before relying on matchcn for something important.

- **Some registries are partly or fully excluded for paywalled components,
  found by a real per-item availability check** (does `npx shadcn add`
  actually work unauthenticated, not just what the index claims):
  aceternity (163 of 282 tagged components, mostly page-template demo
  pages) and shadcn-dashboard (165 of 508) had the gated share filtered
  out before shipping. shadcnblocks was tagged (4,171 components) but is
  held back entirely: its own filter check got contaminated by the
  vendor's rate limiter, so it ships once a clean check runs rather than
  on bad data. shadcnuikit and shadcn-space were evaluated and skipped
  outright for the same reason (40% and 33.3% paywalled). cult-ui.com
  isn't indexed at all: its registry sits behind a bot challenge.
- **Tag confidence varies by registry and dimension, and the matcher
  already accounts for it.** `visual_density` is the weakest dimension
  overall. assistant-ui (agent/chat UI content, far from the schema's
  motion/marketing anchors) tags less confidently than the rest of the
  catalog. cnippet and uiable were measured at full scale after an
  earlier 20-item pre-tagging sample suggested they might be worse
  (35% under 0.6): they are not. Across their full 8,388 choice-dimension
  answers, 24.4% score under 0.6 confidence, matching the catalog-wide
  baseline almost exactly. A confidence-weighted matcher discounts all
  of this automatically, so a weak tag pulls its own weight down instead
  of producing a wrong confident answer, but a brief that leans heavily
  on visual density or assistant-ui-style content is the one most likely
  to get a shortlist or no-match instead of a clean pick. Separately,
  uiable's descriptions are still largely name-echoed templates ("Button
  component.") rather than hand-written text — a real data-quality gap,
  it just doesn't show up as measurably lower tag confidence.
- **Non-English briefs are known to be weaker.** Tested directly: an
  English brief and its translated equivalent were compared side by
  side, and English found a real, well-tagged match that the translated
  version did not. Do not assume non-English input works as well.
- **11 of 372+ shadcn-format registries are indexed.** This is not a
  comprehensive index of the ecosystem.

None of the above produces a wrong forced answer: when confidence is
genuinely low, `pick_component` returns a shortlist or an explicit
no-match, never a single silent guess. That is the actual point of the
tagging and ranking design, not a disclaimer bolted on afterward.

## Development

```bash
pnpm install
pnpm mcp                # run the MCP server directly, for local testing
pnpm demo               # run 3 briefs end to end with clean terminal output
pnpm typecheck
```

The ingest/tag pipeline that produces `data/tags/` is also in this repo:

```bash
pnpm ingest                          # fetch and normalize every registry.json in REGISTRIES
pnpm ingest --registry=magicui       # just one registry
pnpm tag                             # tag normalized components via classifier.dev, chunked and resumable
pnpm check-availability --registry=some-registry   # real per-item install-URL check, no classifier.dev cost
```

`pnpm tag` spends real classifier.dev decisions (free tier: 20,000/day,
3,000/min per IP, no API key needed). It checkpoints after every chunk, so
an interrupted run resumes without re-tagging anything already done.

## Contributing

Issues and PRs are welcome, on a separate branch, never directly to
`main`. Only [@whosfranki](https://github.com/whosfranki) merges; opening
a PR does not mean it lands, but every one gets read.

Good first contributions:

- **Fix a registry's filter.** `src/pipeline/filter.ts` has one function
  per registry (see [open issues](https://github.com/francesco0242/matchcn/issues)
  for known gaps, e.g. a non-component `type` the current filter doesn't
  drop). Run `pnpm ingest --registry=<name>` against the affected
  registry and check the normalized output by hand before proposing a fix.
- **Add a registry.** Add an entry to `src/runtime/registries.ts`, verify
  its filter is correct (no demo/duplicate/non-component pollution, the
  same manual check every existing registry got, not an assumption), run
  `pnpm check-availability` before shipping (a registry.json's index gives
  no signal about which components are actually paywalled), then `pnpm tag`.
  Do not add a registry and tag it in the same PR as an unrelated change.
- **Improve a tagging dimension's criteria.** `src/runtime/dimensions.ts`.
  Any wording change needs a before/after comparison on a real sample
  before it's proposed, not just a plausible-sounding rewrite; a prior
  attempt at a "make non-English briefs work" wording fix was tested this
  way and reverted for no measured benefit, which is the standard this
  project holds fixes to.
- **Runtime bugs** in `src/runtime/match.ts`, `pick.ts`, `resolve.ts`.

What a PR should include: what was measured before the change, what
changed, what was measured after. "This should help" without a before/
after comparison on a real brief or component sample will get sent back
for one.

## License

MIT, see [LICENSE](LICENSE).
