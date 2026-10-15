/* ============================================================
   NursePrep — Icon set
   ------------------------------------------------------------
   One stroke family (24px grid, 1.8 stroke, round caps) used
   everywhere an emoji used to stand in for an icon: subjects,
   achievements, leaderboard badges, insights.
   ============================================================ */

const PATHS = {
  book:        `<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5v-2z"/><path d="M8 7h7M8 11h5"/>`,
  books:       `<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9" y="4" width="5" height="16" rx="1"/><path d="M15.5 5.2l4.3-1.1 3 15.5-4.3 1.1z"/>`,
  cross:       `<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>`,
  baby:        `<circle cx="12" cy="9" r="5"/><path d="M10 8.5h.01M14 8.5h.01M10.5 11a2 2 0 0 0 3 0"/><path d="M7 21v-2a5 5 0 0 1 10 0v2"/>`,
  globe:       `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>`,
  stethoscope: `<path d="M5 3v5a5 5 0 0 0 10 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>`,
  brain:       `<path d="M9.5 3A2.5 2.5 0 0 0 7 5.5a3 3 0 0 0-3 3 3 3 0 0 0 .6 4.8A3 3 0 0 0 7 18a2.5 2.5 0 0 0 5 .5V5.5A2.5 2.5 0 0 0 9.5 3z"/><path d="M14.5 3A2.5 2.5 0 0 1 17 5.5a3 3 0 0 1 3 3 3 3 0 0 1-.6 4.8A3 3 0 0 1 17 18a2.5 2.5 0 0 1-5 .5"/>`,
  clipboard:   `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>`,
  pill:        `<path d="M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7z"/><path d="M8.5 8.5l7 7"/>`,
  users:       `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>`,
  pencil:      `<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>`,
  flame:       `<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1.2 2.5 2 2.5-1-3 0-6 1-8z"/>`,
  check:       `<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.5L16 9.5"/>`,
  target:      `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>`,
  trophy:      `<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>`,
  star:        `<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>`,
  crown:       `<path d="M3 7l4.5 4L12 5l4.5 6L21 7l-2 11H5z"/><path d="M5 21h14"/>`,
  timer:       `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4M12 2v3"/>`,
  cap:         `<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>`,
  hash:        `<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>`,
  layers:      `<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>`,
  gem:         `<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M12 21L8.5 9 11 3M12 21l3.5-12L13 3"/>`,
  medal:       `<circle cx="12" cy="15" r="6"/><path d="M8.5 10.2L5 3h4l3 6M15.5 10.2L19 3h-4l-3 6"/><path d="M12 12.5v5"/>`,
  zap:         `<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>`,
  alert:       `<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5h.01"/>`,
  lock:        `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
  sparkle:     `<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 17l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>`,
};

// Subject/category id → icon name (catalog ids and legacy subject keys).
export const SUBJECT_ICON_NAMES = {
  pnleSets: "books",
  foundation: "cross",
  fundamentals: "cross",
  maternalChild: "baby",
  maternal: "baby",
  community: "globe",
  medSurg: "stethoscope",
  psychiatric: "brain",
  allTopics: "clipboard",
  pharma: "pill",
  leadership: "users",
};

export function icon(name, size = 20, extraClass = "") {
  const body = PATHS[name] || PATHS.clipboard;
  const cls = extraClass ? ` class="${extraClass}"` : "";
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function subjectIcon(id, size = 20) {
  return icon(SUBJECT_ICON_NAMES[id] || "clipboard", size);
}

// Static markup: <span data-icon="trophy"></span> → inline SVG.
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (el.firstElementChild) return;
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.iconSize) || 20);
  });
}
