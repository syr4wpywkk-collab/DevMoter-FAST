// One header for every DevMoter sheet: title (+ optional one-line subtitle),
// an optional primary button and a close button, always in the same place and
// with the same look (styles: .dm-sheet-head in zcode-theme.css).
//
//   const head = createSheetHeader(document, {
//     title: "レビューとタスク",        // required
//     subtitle: "OpenCode-Pocket",     // optional, one line, ellipsis
//     titleId: "wfTitle",              // optional, for aria-labelledby
//     onClose: closeSheet,             // close button click
//     primary: { label: "更新", onClick: refresh }, // optional
//   });
//   sheet.prepend(head.element);
//   head.setTitle("…"); head.setSubtitle(""); head.setPrimary(null);
//
// Shape: three slots — title, primary (e.g. 新規), close — plus optional icon
// actions; the root carries data-sheet-header.
// Extra icon buttons (e.g. refresh) go in head.actions, between the title and
// the primary/close buttons. Sheets must not build their own header row.
// Loaded standalone by tests, so the close icon is inline SVG.

const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/**
 * @param {Document} doc
 * @param {{ title: string, subtitle?: string, titleId?: string, closeLabel?: string,
 *   onClose?: () => void, primary?: { label: string, onClick: () => void } | null }} options
 */
export function createSheetHeader(doc, { title, subtitle = "", titleId = "", closeLabel = "閉じる", onClose, primary = null } = {}) {
  const element = doc.createElement("header");
  element.className = "dm-sheet-head";
  // Same marker as the Office dialog's three-slot header (#509), so a header
  // laid out by hand there can be swapped for this one without CSS changes.
  element.dataset.sheetHeader = "";

  const heading = doc.createElement("div");
  heading.className = "dm-sheet-head-text";
  const titleEl = doc.createElement("h2");
  titleEl.className = "dm-sheet-head-title";
  if (titleId) titleEl.id = titleId;
  const subtitleEl = doc.createElement("p");
  subtitleEl.className = "dm-sheet-head-subtitle";
  heading.append(titleEl, subtitleEl);

  const actions = doc.createElement("div");
  actions.className = "dm-sheet-head-actions";

  const primaryButton = doc.createElement("button");
  primaryButton.type = "button";
  primaryButton.className = "dm-sheet-head-primary";
  let primaryHandler = null;
  primaryButton.addEventListener("click", () => primaryHandler?.());

  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "dm-sheet-head-close";
  closeButton.setAttribute("aria-label", closeLabel);
  closeButton.innerHTML = CLOSE_ICON;
  if (onClose) closeButton.addEventListener("click", () => onClose());

  element.append(heading, actions, primaryButton, closeButton);

  const setTitle = text => { titleEl.textContent = String(text ?? ""); };
  const setSubtitle = text => {
    subtitleEl.textContent = String(text ?? "");
    subtitleEl.hidden = !subtitleEl.textContent;
  };
  const setPrimary = next => {
    primaryHandler = next?.onClick ?? null;
    primaryButton.textContent = next?.label ?? "";
    primaryButton.hidden = !next;
  };
  setTitle(title);
  setSubtitle(subtitle);
  setPrimary(primary);

  return { element, titleEl, subtitleEl, actions, primaryButton, closeButton, setTitle, setSubtitle, setPrimary };
}
