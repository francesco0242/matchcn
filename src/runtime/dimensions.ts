// Canonical tag schema. This must match docs/DIMENSIONS.md exactly: label
// order is frozen (see that file for why), and this is the single place
// code reads dimension definitions from. If DIMENSIONS.md changes, this
// file changes in the same commit, never the other way around.

export type DimensionKind = "choice" | "choice-ordered" | "noul";

export interface DimensionDef {
  key: string;
  kind: DimensionKind;
  labels?: string[]; // absent for noul
  instructions: string;
}

export const DIMENSIONS: DimensionDef[] = [
  {
    key: "category",
    kind: "choice",
    labels: [
      "hero",
      "navigation",
      "card",
      "form-input",
      "button",
      "modal-overlay",
      "data-display",
      "chart",
      "media",
      "layout-section",
      "feedback-notification",
      "typography",
      "background-effect",
      "cursor",
      "transition-wrapper",
      "none of these",
    ],
    instructions:
      'Classify this UI component into the single category a developer would use when searching for it, using these definitions. "hero" is a large, top-of-page introductory section with a headline and/or call to action. "navigation" is a menu, navbar, sidebar, tabs, or breadcrumb used to move between views. "card" is a self-contained content block with a border or shadow boundary, typically showing one item (a product, a person, a post). "form-input" is a single input control (text field, select, checkbox, date picker, textarea) or a labeled group of them. "button" is a clickable action trigger, including icon buttons and button variants. "modal-overlay" is content that appears above the page and blocks or dims it (dialog, drawer, popover, tooltip, dropdown menu). "data-display" presents a set of records or values (table, list, badge count, stat tile) without being a chart. "chart" visualizes numeric data as a graph (bar, line, pie, gauge). "media" wraps an image, video, avatar, or carousel of media. "layout-section" is a structural page region (footer, grid, container, divider) that organizes other content rather than presenting content of its own; use this instead of "hero" when the section has no headline or call to action of its own. "feedback-notification" communicates status to the user (toast, alert, progress bar, skeleton loader, spinner). "typography" is a text-rendering effect (animated heading, text reveal, gradient text) where the text itself is the content, not a label on some other element. "background-effect" is a full-bleed or ambient visual effect behind other content (particles, gradients, noise) that is not itself a content container; use this instead of "layout-section" when the element has no structural role and exists purely as a visual backdrop. "cursor" is a custom mouse cursor or pointer replacement, including cursor trails, crosshairs, magnetic followers, and target or lock-on cursors; use this instead of "background-effect" when the effect specifically follows or replaces the user\'s pointer rather than existing independently on the page. "transition-wrapper" is a generic wrapper that applies an entrance, exit, hover, or scroll-triggered transition effect (fade, blur, pixel dissolve, glare, peel) to arbitrary child content the caller provides, where the wrapper itself has no fixed visual identity and the same effect could apply to any content passed into it; use this instead of "background-effect" when the effect is not ambient or full-bleed but tied to wrapping specific caller-provided content. If the component spans more than one of these, pick the category that names its primary visible purpose. If it is a low-level utility with no visual identity of its own (a hook, a config file), or truly fits none of the above, pick "none of these".',
  },
  {
    key: "motion",
    kind: "choice-ordered",
    labels: ["static", "subtle-transitions", "animated-on-interaction", "continuous-background-motion"],
    instructions:
      'Judge visual movement in the component\'s default and interactive states, from the description and any file/prop hints available. "static" has no animation. "subtle-transitions" has small transitions like fades or color changes on state change. "animated-on-interaction" has a clear, noticeable animation triggered by hover, click, or focus. "continuous-background-motion" animates on its own without user interaction (looping, auto-playing, particle or gradient effects). Pick the strongest form of motion the component exhibits at all, even if it is not the default state.',
  },
  {
    key: "visual_density",
    kind: "choice-ordered",
    labels: ["minimal", "moderate", "dense"],
    instructions:
      'Judge how the component would feel to someone looking at it, as an overall impression, not by counting elements (do not count, counting is unreliable for this kind of judgment; go with the first impression instead). "minimal" is one focal element with lots of empty space around it, nothing competes for attention, like motion-primitives\' text-shimmer: a single line of text with a shimmer effect and nothing else on screen. "moderate" is a few grouped elements with one clear primary and the rest supporting it rather than competing with it, like magicui\'s tweet-card: an avatar, a name, a handle, and the tweet text, all clearly reading as one grouped unit around the tweet itself. "dense" is many elements competing for attention at once, with no single obvious place for the eye to land first, like magicui\'s bento-grid: a full grid of simultaneous feature tiles, each pulling attention equally. If the component genuinely sits between two levels, pick whichever level matches the overall first impression, not a literal tally of parts.',
  },
  {
    key: "interaction_model",
    kind: "choice",
    labels: ["display-only", "hover", "click-toggle", "form-input", "drag-or-gesture", "none of these"],
    instructions:
      'Classify the primary way a user interacts with this component. "display-only" takes no direct interaction (a badge, a static hero). "hover" changes mainly in response to a mouse hover state. "click-toggle" responds to a click or tap that changes visible state (accordions, modals, tabs, dropdowns). "form-input" collects typed or selected user input (inputs, selects, checkboxes, date pickers). "drag-or-gesture" responds to drag, swipe, or similar gesture input. Pick the interaction that best represents normal use. If interaction does not apply or is unclear, pick "none of these".',
  },
  {
    key: "needs_external_data",
    kind: "noul",
    instructions:
      "Return the probability that this component requires the caller to supply real external data (fetched content, application state, a non-trivial prop) before it does anything useful, as opposed to being usable with default or placeholder content out of the box. A decorative background effect or a static hero section with built-in copy should score low. A data table, a chart, or a user avatar list should score high.",
  },
  {
    key: "decorative_only",
    kind: "noul",
    instructions:
      "Return the probability that this component is purely decorative, a visual or motion effect with no informational or functional content of its own (background animations, particle fields, gradient or blob effects, cursor trails). A component that displays real content (text, data, an image the caller provides) even if it is heavily animated should score low.",
  },
];

export const CHOICE_DIMENSIONS = DIMENSIONS.filter((d) => d.kind !== "noul");
export const NOUL_DIMENSIONS = DIMENSIONS.filter((d) => d.kind === "noul");
