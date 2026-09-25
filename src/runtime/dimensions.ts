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
      'Classify this UI component into the single category a developer would use when searching for it, using these definitions. "hero" is a large, top-of-page introductory section with a headline and/or call to action, built as an actual section (a background or container holding that content, not just the heading text on its own); use "typography" instead when the component is only an animated heading or text effect with no surrounding section layout, even if the wording alone reads like a hero headline. "navigation" is a menu, navbar, sidebar, tabs, or breadcrumb used to move between views. "card" is a self-contained content block with a border or shadow boundary, typically showing one item (a product, a person, a post). "form-input" is a single input control (text field, select, checkbox, date picker, textarea) or a labeled group of them. "button" is a clickable action trigger, including icon buttons and button variants. "modal-overlay" is content that appears above the page and blocks or dims it (dialog, drawer, popover, tooltip, dropdown menu). "data-display" presents a set of records or values (table, list, badge count, stat tile) without being a chart. "chart" visualizes numeric data as a graph (bar, line, pie, gauge). "media" wraps an image, video, avatar, or carousel of media. "layout-section" is a structural page region (footer, grid, container, divider) that organizes other content rather than presenting content of its own; use this instead of "hero" when the section has no headline or call to action of its own. "feedback-notification" communicates status to the user (toast, alert, progress bar, skeleton loader, spinner). "typography" is a text-rendering effect (animated heading, text reveal, gradient text) where the text itself is the content, not a label on some other element; this includes a bare animated headline with no surrounding section structure, even when its wording alone would otherwise read as a hero headline — see "hero" above for the deciding factor. "background-effect" is a full-bleed or ambient visual effect behind other content (particles, gradients, noise) that is not itself a content container; use this instead of "layout-section" when the element has no structural role and exists purely as a visual backdrop. "cursor" is a custom mouse cursor or pointer replacement, including cursor trails, crosshairs, magnetic followers, and target or lock-on cursors; use this instead of "background-effect" when the effect specifically follows or replaces the user\'s pointer rather than existing independently on the page. "transition-wrapper" is a generic wrapper that applies an entrance, exit, hover, or scroll-triggered transition effect (fade, blur, pixel dissolve, glare, peel) to arbitrary child content the caller provides, where the wrapper itself has no fixed visual identity and the same effect could apply to any content passed into it; use this instead of "background-effect" when the effect is not ambient or full-bleed but tied to wrapping specific caller-provided content. If the component spans more than one of these, pick the category that names its primary visible purpose. If it is a low-level utility with no visual identity of its own (a hook, a config file), or truly fits none of the above, pick "none of these".',
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
    kind: "noul",
    instructions:
      'Return the probability that this component would feel visually DENSE to someone looking at it. Anchor low (sparse): motion-primitives\' text-shimmer (a single line of text, nothing else on screen) and magicui\'s tweet-card (an avatar, name, handle, and text, all clearly one grouped unit around a single subject). Anchor high (dense): magicui\'s bento-grid (a full grid of simultaneous feature tiles, each pulling attention equally) and any dashboard-style layout with several distinct cards, charts, or panels visible together. The deciding question: is there one clear subject the whole component is organized around (low probability), or do several independent things share attention at once (high probability)? Judge the overall first impression, not a literal count of parts.',
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
  {
    key: "domain",
    kind: "choice",
    labels: [
      "auth",
      "scheduling",
      "commerce",
      "messaging",
      "analytics",
      "content",
      "settings",
      "search",
      "marketing",
      "general-purpose",
    ],
    instructions:
      'Classify what real-world task or subject matter this component is FOR, independent of its visual shape (a form, a card, and a modal can all serve the same task). "auth" is signing in, signing up, password reset, or account verification. "scheduling" is calendars, date/time pickers, bookings, or event/agenda views. "commerce" is pricing, checkout, cart, product listings, or payment. "messaging" is chat, comments, direct messages, or notification feeds. "analytics" is dashboards, stats, metrics, or data-heavy displays whose subject is numbers/performance. "content" is articles, blog posts, docs, or media galleries whose subject is written or visual content itself. "settings" is account/app preferences or configuration panels. "search" is search bars, filters, or command palettes for finding things. "marketing" is landing-page sections meant to persuade or introduce a product (hero sections, testimonials, feature highlights, CTAs), not a specific task the user performs. "general-purpose" is a low-level UI primitive (a generic button, badge, tooltip, layout wrapper) with no specific task or subject tied to it — pick this whenever the component could equally serve any of the above.',
  },
];

export const CHOICE_DIMENSIONS = DIMENSIONS.filter((d) => d.kind !== "noul");
export const NOUL_DIMENSIONS = DIMENSIONS.filter((d) => d.kind === "noul");
