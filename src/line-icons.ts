// Static 16px line icons (stroke 1.5) for UI chrome. Values are constant SVG
// markup owned by this module; never interpolate user or network data here.
const svg = (body: string): string =>
  `<svg class="dm-line-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const icons: Record<string, string> = {
  office: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  projects: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  "mission-control": svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  knowledge: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>'),
  terminal: svg('<path d="M5 8l4 4-4 4M12 16h7"/>'),
  git: svg('<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10a6 6 0 0 1-6 6H8"/>'),
  review: svg('<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>'),
  agents: svg('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
  sessions: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  browser: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>'),
  automation: svg('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'),
  "developer-workflows": svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  tasks: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
  plugins: svg('<path d="M9 4h6v3a2 2 0 1 0 0 4h3v6h-3a2 2 0 1 0-4 0v3H5v-6h3a2 2 0 1 0 0-4H5V4z" transform="translate(0.5 0)"/>'),
  library: svg('<path d="M5 4v16M10 4v16M15 5l4 15"/>'),
  integrations: svg('<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
  tools: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  home: svg('<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};

export function lineIcon(id: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(icons, id) ? icons[id] : undefined;
}

/** Static icon markup for template literals; empty string for unknown ids. */
export function icon(id: string): string {
  return lineIcon(id) ?? "";
}
