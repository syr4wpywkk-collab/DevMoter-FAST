# API Chat layout

API Chat follows a Gemini-like reading order: the answer is the page, the
composer is one field with its controls in a single foot row.

| Area | Element | Rule |
| --- | --- | --- |
| Transcript | `.api-message.assistant` | Full-width text, no bubble. |
| Transcript | `.api-message.user` | Right-aligned bubble, max 85% (90% on phones). |
| Composer | `#apiPrompt` | Single text field at the top of the composer. |
| Composer foot | `#apiAttachImage`, pickers, `#apiSend` | Line-icon SVG buttons (`aria-hidden` icon, `aria-label` + `title`); no font glyphs, which render as boxes on some devices. |

While a reply streams, `#apiSend` shows a stop icon labelled `common.stop`;
it returns to the send icon afterwards.

Verify with `node --test test/api-chat-composer-icons.test.mjs`.
