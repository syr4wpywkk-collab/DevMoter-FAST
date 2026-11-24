PDF.js browser build vendored from pdfjs-dist 4.2.67 (Apache-2.0)
https://github.com/mozilla/pdf.js
License copy: LICENSE (retained verbatim from the npm package).

Files (both the plain and minified legacy ESM builds are retained):
- pdf.mjs / pdf.min.mjs               — the viewer library. The app serves the
                                        minified build statically: src/office.ts
                                        imports /pdfjs/pdf.mjs at runtime (kept
                                        out of the JS bundle), which maps to
                                        public/pdfjs/pdf.mjs == pdf.min.mjs.
- pdf.worker.mjs / pdf.worker.min.mjs — the matching parser worker. The minified
                                        build is served at /pdfjs/pdf.worker.mjs
                                        (public/pdfjs/pdf.worker.mjs ==
                                        pdf.worker.min.mjs) and set as
                                        GlobalWorkerOptions.workerSrc.
                                        pdf.d.mts provides the type surface.

Keep the public/pdfjs copies byte-identical to the vendored minified builds
when updating.

Pinned to the same pdfjs-dist version DevMoter-FAST installs for the
server-side text extraction (see vendor/pdf/NOTICE.md and package.json).
