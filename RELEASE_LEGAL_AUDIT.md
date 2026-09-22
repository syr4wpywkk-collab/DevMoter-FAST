# Release / legal hygiene audit

This is a project-maintenance record, not legal advice. It separates copyright/licensing, trademark/affiliation, and release-metadata checks so they can be reviewed independently.

Audit target: DevMoter FAST source tree on the current public `main` line.

## 1. Project license

**Decision:** DevMoter FAST is distributed under the MIT License.

Evidence in the repository:

- `LICENSE` contains the project license.
- `package.json` declares `"license": "MIT"`.
- `THIRD_PARTY_NOTICES.md` distinguishes DevMoter from separately installed upstream products.

Release rule: do not remove the license file or copyright notice from distributed source archives.

## 2. Runtime integrations and trademarks

DevMoter interoperates with products including OpenCode, OpenAI Codex, GitHub, and Tailscale.

**Decision:** use those names descriptively for compatibility/interoperability only. Do not describe DevMoter as official, endorsed, sponsored, or partnered unless that becomes factually authorized.

Current README already states that DevMoter FAST is an experimental, unofficial community project and is not affiliated with or endorsed by upstream providers.

Product names and trademarks remain the property of their respective owners.

## 3. Bundled visual assets

Current `public/` contains:

- `manifest.webmanifest`
- `sw.js`

No third-party logo, photograph, illustration, font file, or vendor icon asset is currently bundled there.

The application UI uses text, CSS, emoji/system glyphs, and inline interface SVG geometry authored as part of the project. No upstream provider logo is required for the current product surfaces.

**Decision:** keep provider identification textual by default. If a third-party logo or illustration is added later, record its source and license/brand-guideline basis here before release.

## 4. npm dependencies

Direct development dependencies currently declared in `package.json`:

- TypeScript
- Vite
- c8

These tools and their transitive dependencies remain subject to their own licenses.

**Decision:** `package-lock.json` remains the dependency inventory for reproducible installs. Before a tagged v1.0 release, generate/review an automated dependency-license report and investigate any unknown, custom, copyleft, or notice-requiring entry rather than assuming all transitive packages are MIT.

## 5. Upstream source-code reuse

DevMoter talks to separately installed OpenCode and Codex software. Their source is not bundled into this repository by that integration alone.

Issue #14 and related research issues reference external projects for product/UX ideas.

**Decision:** external repositories are research references unless the exact source file and license are verified compatible. Reimplement ideas independently by default. Do not copy AGPL/GPL/FSL/enterprise-only or otherwise incompatible source into DevMoter.

When MIT/Apache-2.0 source is intentionally adapted, preserve the copyright/license/NOTICE obligations that apply to that source.

## 6. Screenshots, docs, and private data

No release screenshot asset is currently bundled in `public/`.

**Release rule:** before adding screenshots/demo recordings:

- remove account names, private repository names, local absolute paths, tokens, Tailnet names, email addresses, and notification content;
- avoid reproducing third-party copyrighted material that is not necessary to explain interoperability;
- record the source/permission basis for non-DevMoter visual material.

## 7. Repository/release metadata

Before each major public launch, review metadata outside the source tree as well:

- GitHub repository description;
- social preview image;
- release title/body;
- screenshots/demo media;
- package/distribution metadata;
- website copy, if any.

**Decision:** use “DevMoter FAST” as the project identity and keep provider names subordinate/descriptive. Avoid “official”, “for OpenAI”, “OpenAI DevMoter”, or other phrasing that could imply source or endorsement.

## 8. Review checklist for new assets/dependencies

For every new third-party asset or copied source fragment, record:

1. upstream project/creator;
2. exact source URL or package;
3. copyright holder if provided;
4. license or brand-guideline basis;
5. whether attribution/NOTICE reproduction is required;
6. where that notice is preserved in DevMoter;
7. whether trademark permission is a separate question from the code/content license.

If the answer is unclear, do not ship the asset until it is resolved.
