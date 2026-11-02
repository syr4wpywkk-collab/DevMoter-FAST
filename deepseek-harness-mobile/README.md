# DeepSeek Harness Mobile

A mobile-first PWA companion for a separately running DeepSeek Harness (DSH) instance.

> **Current scope:** this first milestone is a secure mobile launch and connection shell. It does not reimplement DSH's agent RPC protocol, execute tools, or proxy credentials. Agent conversations and runtime operations are opened in the official DSH Web UI until a versioned, supported mobile transport adapter is available.

## Features

- iPhone-first layout with safe-area support and a bottom navigation bar.
- Installable PWA shell with offline-cached static assets.
- Stores only the configured DSH base URL in local storage.
- Opens the configured DSH Web UI in a separate tab.
- Optional reachability check using an unauthenticated `HEAD /` request.
- HTTPS required for remote hosts; plain HTTP is accepted only for loopback development hosts.
- No API keys, cookies, passwords, or DSH session data are collected or stored.

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

## Connect to DSH

1. Start DSH on the host using its official instructions: https://github.com/deepseek-ai/deepseek-harness
2. Make the DSH Web UI reachable from the phone over a trusted network.
3. Enter its origin, for example `https://dsh.example-tailnet.ts.net`.
4. Save and open DSH.

The reachability check is advisory. A failed browser CORS check does not prove that the DSH host is offline. The app never asks for or forwards DSH credentials.

## Architecture

```text
iPhone Safari / installed PWA
          |
          | HTTPS (static assets)
          v
deepseek-harness-mobile
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
