import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addFile, buildReport, categoryOf, countLines, languageOf, renderMarkdown, type Group } from '../../scripts/stats/code-stats.ts';

const bytes = (text: string) => new TextEncoder().encode(text);
const group = (): Group => ({ total: { files: 0, lines: 0, blank: 0, comment: 0, code: 0 }, languages: {} });

test('languageOf maps extensions and well-known file names', () => {
  assert.equal(languageOf('src/logging/logger.ts').name, 'TypeScript');
  assert.equal(languageOf('engines/sqlite/src/main.c').name, 'C');
  assert.equal(languageOf('engines/duckdb/src/main.CPP').name, 'C++');
  assert.equal(languageOf('engines/valkey/src/Makefile').name, 'Build system');
  assert.equal(languageOf('engines/duckdb/CMakeLists.txt').name, 'Build system');
  assert.equal(languageOf('.gitignore').name, 'Other');
  assert.equal(languageOf('LICENSE').name, 'Other');
});

test('categoryOf separates own code, tests, docs and configuration', () => {
  assert.equal(categoryOf('src/logging/logger.ts'), 'own');
  assert.equal(categoryOf('scripts/deps/check.ts'), 'own');
  assert.equal(categoryOf('test/deps/check.test.ts'), 'tests');
  assert.equal(categoryOf('docs/roadmap/features.md'), 'docs');
  assert.equal(categoryOf('README.md'), 'docs');
  assert.equal(categoryOf('engines/UPSTREAM.md'), 'docs');
  assert.equal(categoryOf('package.json'), 'config');
  assert.equal(categoryOf('.github/workflows/ci.yml'), 'config');
  assert.equal(categoryOf('package-lock.json'), undefined);
  assert.equal(categoryOf('docs/stats/code-stats.md'), undefined);
});

test('countLines splits code, comment and blank lines', () => {
  const source = ['// header', '', 'const a = 1; // trailing', '/* one line */', '/*', ' * block', ' */', 'const b = 2; /* open', 'still comment */ const c = 3;', ''].join('\n');
  assert.deepEqual(countLines(source, 'c'), { lines: 9, blank: 1, comment: 5, code: 3 });
});

test('countLines handles a missing trailing newline and empty input', () => {
  assert.deepEqual(countLines('', 'c'), { lines: 0, blank: 0, comment: 0, code: 0 });
  assert.deepEqual(countLines('a\nb', 'c'), { lines: 2, blank: 0, comment: 0, code: 2 });
  assert.deepEqual(countLines('a\nb\n', 'c'), { lines: 2, blank: 0, comment: 0, code: 2 });
  assert.deepEqual(countLines('\n\n', 'none'), { lines: 2, blank: 2, comment: 0, code: 0 });
});

test('comment markers inside strings do not start a comment', () => {
  const source = ['const glob = "test/**/*.test.ts";', 'const next = 1;', "const other = 'a /* b';", 'const last = 2;'].join('\n');
  assert.deepEqual(countLines(source, 'c'), { lines: 4, blank: 0, comment: 0, code: 4 });
  assert.deepEqual(countLines('x = 1; // see /* here\ny = 2;', 'c'), { lines: 2, blank: 0, comment: 0, code: 2 });
});

test('each comment style only recognises its own markers', () => {
  assert.deepEqual(countLines('# note\nx = 1\n// not a comment', 'hash'), { lines: 3, blank: 0, comment: 1, code: 2 });
  assert.deepEqual(countLines('-- note\nSELECT 1;\n/* block\nmore */\n# code', 'sql'), { lines: 5, blank: 0, comment: 3, code: 2 });
  assert.deepEqual(countLines('# heading\n// text\n/* text', 'none'), { lines: 3, blank: 0, comment: 0, code: 3 });
});

test('binary files count as files but not as lines', () => {
  const target = group();
  addFile(target, 'engines/duckdb/data/x.parquet', new Uint8Array([80, 65, 82, 49, 0, 1, 2, 10, 10]));
  addFile(target, 'src/a.ts', bytes('const a = 1;\n'));
  assert.deepEqual(target.total, { files: 2, lines: 1, blank: 0, comment: 0, code: 1 });
  assert.deepEqual(target.languages.Binary, { files: 1, lines: 0, blank: 0, comment: 0, code: 0 });
});

test('buildReport totals categories and engines separately and deterministically', () => {
  const own = group();
  addFile(own, 'src/b.ts', bytes('const b = 1;\n'));
  addFile(own, 'scripts/run.sh', bytes('#!/bin/sh\necho 1\necho 2\n'));
  const tests = group();
  addFile(tests, 'test/b.test.ts', bytes('// t\nassert(1);\n'));
  const engine = group();
  addFile(engine, 'engines/sqlite/src/main.c', bytes('int main(){\n  return 0;\n}\n'));
  const report = buildReport({ own, tests, docs: group(), config: group() }, { zeta: { tree: 'f'.repeat(40), ...group() }, sqlite: { tree: 'a'.repeat(40), ...engine } });

  assert.equal(report.summary.own.code, 3);
  assert.equal(report.summary.tests.code, 1);
  assert.equal(report.summary.vendored.code, 3);
  assert.deepEqual(report.summary.total, { files: 4, lines: 9, blank: 0, comment: 2, code: 7 });
  assert.deepEqual(Object.keys(report.categories.own.languages), ['Shell', 'TypeScript']);
  assert.deepEqual(Object.keys(report.engines), ['sqlite', 'zeta']);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /\| 独自コード（`src\/`、`scripts\/`） \| 2 \| 4 \| 3 \| 1 \| 0 \|/);
  assert.match(markdown, /### sqlite\n\nツリー ID: `a{40}`/);
  assert.equal(renderMarkdown(report), markdown);
});
