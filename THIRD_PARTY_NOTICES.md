# Third-Party Notices

DevMoter FAST is an independent open-source project.

## Runtime integrations

DevMoter FAST communicates with software installed and authenticated separately by the user:

- **OpenCode** — upstream project licensed under the MIT License.
- **OpenAI Codex CLI / app-server** — upstream project licensed under the Apache License 2.0.

DevMoter FAST does not bundle either upstream application's source code or credentials. Their names are used only to describe interoperability. OpenCode, OpenAI, Codex, and other referenced product names and marks belong to their respective owners. This project is not affiliated with or endorsed by those upstream projects or providers.

## JavaScript development dependencies

The project uses npm development dependencies including TypeScript, Vite, and c8, plus their transitive dependencies. Their respective license notices remain available in the packages distributed by their maintainers and in npm package metadata.

DevMoter FAST itself is licensed under the MIT License. See `LICENSE`.

## Bundled Markdown dependencies

The Codex browser UI bundles independently maintained libraries for parsing and sanitizing assistant Markdown:

- **Marked** — MIT, Copyright (c) 2018+, MarkedJS; Copyright (c) 2011-2018, Christopher Jeffrey. Source: https://github.com/markedjs/marked. Distributed license: [public/licenses/marked.txt](./public/licenses/marked.txt).
- **DOMPurify** — Apache-2.0 OR MPL-2.0, Copyright (c) Cure53 and other contributors. Source: https://github.com/cure53/DOMPurify. This distribution uses the Apache-2.0 option; see [public/licenses/dompurify.txt](./public/licenses/dompurify.txt). The library's copyright header is retained in the browser bundle.

Resolved versions are recorded in `package-lock.json`. The license copies are included in Vite's static output under `/licenses/`. jsdom is used only by development tests and is not bundled into the browser UI.

## Bundled visual assets

The current source tree does not bundle upstream provider logos, third-party photographs, illustrations, or font files. Provider names are presented textually for interoperability. See `RELEASE_LEGAL_AUDIT.md` for the review rule that applies before adding third-party visual assets.
