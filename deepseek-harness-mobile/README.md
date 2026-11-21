# DeepSeek Harness Mobile

A mobile-first PWA companion for DeepSeek: check the account balance, pick a
model, send a small test request to the DeepSeek API, and open a separately
running DeepSeek Harness (DSH) instance.

> **Scope (v0.2.1):** the app now calls the public DeepSeek API directly from
> the browser in addition to the original DSH connection shell. It still does
> not reimplement DSH's agent RPC protocol, execute tools, or handle DSH
> credentials. Agent conversations and runtime operations stay in the official
> DSH Web UI.

## Features

- iPhone-first layout with safe-area support and a bottom navigation bar.
- Installable PWA shell with offline-cached static assets.
- **Balance**: shows the DeepSeek account balance (`GET /user/balance`),
  split into topped-up and granted amounts, with an availability status.
- **Model selection**: fetches the models available to the API key
  (`GET /models`), caches the list on the device, and remembers the choice.
- **API test chat**: sends one message to `POST /chat/completions` and shows
  the response together with the returned token usage (input / output /
  total, cache hits, reasoning tokens when present).
- **On-device usage tally**: requests made from this device are totalled
  locally. The DeepSeek API exposes no account-wide usage history, so this
  tally is device-local by design.
- **DSH connection shell** (unchanged from v0.1): stores the configured DSH
  base URL, opens the DSH Web UI in a separate tab, and offers an optional
  reachability check using an unauthenticated `HEAD /` request. HTTPS is
  required for remote hosts; plain HTTP is accepted only for loopback
  development hosts.

## API key handling (security fix in v0.2.1)

The v0.2.0 release stored API keys in plaintext localStorage. This was
unsafe because scripts running on the same origin, including injected scripts
in an XSS incident, can read persistent browser storage.

- API keys are now held **only in the current page's JavaScript memory**.
  They are never written to localStorage, sessionStorage, IndexedDB, or
  service-worker caches.
- The user must re-enter the API key after a reload, PWA restart, or tab close.
- On loading the new version, the app **deletes the old plaintext
  `dsh-mobile.deepseek-api-key` localStorage entry** instead of restoring it.
- The API key is sent only to `https://api.deepseek.com` as the
  `Authorization: Bearer` header of balance, model and chat requests, never
  to this app's static host or to DSH. The UI displays only the last 4
  characters while the page remains open.
- This is a mitigation for **persistent credential storage**, not a complete
  XSS defense. A malicious script running while the page is active could
  still access the in-memory key. Do not load untrusted scripts.
- For securely remembered credentials in a future release, use a trusted
  authenticated backend with server-side secret storage rather than
  storing a reusable API key in browser JavaScript.
- If a key was previously exposed, revoke and rotate it in the DeepSeek
  console; removing localStorage alone cannot undo earlier disclosure.

DSH credentials are still never asked for, stored, or proxied.

## Run locally

Requires Node.js 20+ (no runtime dependencies).

```sh
cd deepseek-harness-mobile
npm run dev
```

Open the URL printed by the static server. To run the tests:

```sh
npm test
```

For an iPhone, deploy this folder behind HTTPS and open it in Safari, then use **共有 → ホーム画面に追加**. The DSH host itself must also be reachable from the iPhone (for example, through a private HTTPS Tailscale Serve endpoint).

## Use the DeepSeek API features

1. Create an API key in the DeepSeek platform console.
2. Open the settings screen and enter the key for this session (it is not saved).
3. The home screen shows the balance; the API screen fetches the model list
   and can send a test message.

## Connect to DSH

1. Start DSH on the host using its official instructions: https://github.com/deepseek-ai/deepseek-harness
2. Make the DSH Web UI reachable from the phone over a trusted network.
3. Enter its origin, for example `https://dsh.example-tailnet.ts.net`.
4. Save and open DSH.

The reachability check is advisory. A failed browser CORS check does not prove that the DSH host is offline. The app never asks for or forwards DSH credentials.

## Design

The UI follows the repository's Unslop UI Standard
(`.cursor/rules/unslop-ui.mdc`). Direction: a quiet, glanceable tool — the one
bold element is the balance figure itself; everything else is flat, bordered
and neutral. A light theme replaces the previous near-black + purple-gradient
look. Tokens: background `#F5F6F7`, surface `#FFFFFF`, ink `#171A1F`, muted
`#59636E`, line `#DEE2E7`, accent `#2F4BD7` (DeepSeek blue, darkened for WCAG
AA), plus ok / danger status colors. Typography is the native Japanese system
stack (no webfonts, so the PWA works offline); spacing is on a 4px grid
(8 / 16 / 24 / 32) and radii are 8px for controls and 12px for panels.

## Architecture

```text
iPhone Safari / installed PWA
          |
          | HTTPS (static assets)
          v
deepseek-harness-mobile
          |\
          | \  fetch with the session-only API key (this page only)
          |  v
          |  api.deepseek.com  (balance / models / chat completions)
          |
          | user-initiated navigation only
          v
DeepSeek Harness Web UI
          |
          v
DSH Host / Agent runtime
```

The mobile shell deliberately does not invent private DSH endpoints. DSH currently uses its generated Cordis/Typert remote API and multiplexed transport; a native mobile client must use the upstream protocol contracts rather than guessing REST routes. See the upstream [API Gateway documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/api-gateway.md).

## License and attribution

The mobile shell code in this directory is provided under the MIT License. DeepSeek Harness is a separate upstream project developed by DeepSeek AI; its original MIT notice is retained in [LICENSE](./LICENSE). This companion is not an official DeepSeek product and is not endorsed by DeepSeek AI.

- Upstream: https://github.com/deepseek-ai/deepseek-harness
- Upstream license: MIT, Copyright (c) 2026 DeepSeek
