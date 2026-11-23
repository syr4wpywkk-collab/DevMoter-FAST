// Line counts by category and language, with DevMoter Base's own code, its
// tests and the vendored engines kept apart.
//
//   node scripts/stats/code-stats.ts            print the report
//   node scripts/stats/code-stats.ts --write    regenerate docs/stats/code-stats.{json,md}
//   node scripts/stats/code-stats.ts --check    fail if the committed report is out of date
//   --full                                      with --write: recount the engines even if their pins are unchanged
//
// Engine counts are keyed by the pinned tree id from engines/manifest.json, so
// they are recounted only when a pin changes and can be checked without the
// engine sources on disk (CI does not check them out).
// Comment detection is a line-based approximation: it does not parse the
// language, so comment markers inside regex literals can be misread.

import { execFile } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseManifest } from '../upstream/verify.ts';

export interface Counts {
  files: number;
  lines: number;
  blank: number;
  comment: number;
  code: number;
}

export interface Group {
  total: Counts;
  languages: Record<string, Counts>;
}

export const CATEGORIES = ['own', 'tests', 'docs', 'config'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Report {
  schemaVersion: 1;
  summary: Record<Category | 'vendored' | 'total', Counts>;
  categories: Record<Category, Group>;
  engines: Record<string, Group & { tree: string }>;
}

type CommentStyle = 'c' | 'hash' | 'sql' | 'none';
interface Language {
  name: string;
  comments: CommentStyle;
}

const BY_EXTENSION: Record<string, Language> = {};
const BY_BASENAME: Record<string, Language> = {};
const define = (name: string, comments: CommentStyle, extensions: string[], basenames: string[] = []) => {
  for (const extension of extensions) BY_EXTENSION[extension] = { name, comments };
  for (const basename of basenames) BY_BASENAME[basename] = { name, comments };
};
define('TypeScript', 'c', ['ts', 'tsx', 'mts', 'cts']);
define('JavaScript', 'c', ['js', 'jsx', 'mjs', 'cjs']);
define('C', 'c', ['c']);
define('C/C++ header', 'c', ['h', 'hpp', 'hh', 'hxx', 'ipp']);
define('C++', 'c', ['cpp', 'cc', 'cxx']);
define('Yacc/Lex', 'c', ['y', 'l', 'yy', 'll', 'lemon']);
define('Java', 'c', ['java']);
define('Go', 'c', ['go']);
define('Rust', 'c', ['rs']);
define('Swift', 'c', ['swift']);
define('CSS', 'c', ['css']);
define('Python', 'hash', ['py']);
define('Shell', 'hash', ['sh', 'bash']);
define('Perl', 'hash', ['pl', 'pm']);
define('Tcl', 'hash', ['tcl']);
define('Ruby', 'hash', ['rb']);
define('R', 'hash', ['r']);
define('YAML', 'hash', ['yml', 'yaml']);
define('TOML', 'hash', ['toml']);
define('Build system', 'hash', ['cmake', 'mk', 'mak', 'build', 'in', 'am', 'ac', 'm4'], ['Makefile', 'GNUmakefile', 'CMakeLists.txt', 'Dockerfile', 'meson.build']);
define('SQL', 'sql', ['sql']);
define('Engine test script', 'hash', ['test', 'test_slow', 'test_coverage', 'spec', 'benchmark', 'out', 'data']);
define('JSON', 'none', ['json']);
define('Markdown', 'none', ['md']);
define('HTML', 'none', ['html', 'htm']);
define('XML/SGML', 'none', ['xml', 'sgml', 'xsl', 'svg']);
define('Text', 'none', ['txt', 'csv', 'tsv']);
const OTHER: Language = { name: 'Other', comments: 'none' };

export function languageOf(file: string): Language {
  const basename = file.slice(file.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  return BY_BASENAME[basename] ?? (dot > 0 ? BY_EXTENSION[basename.slice(dot + 1).toLowerCase()] : undefined) ?? OTHER;
}

/** Files that are generated or self-referential and would make the report unstable. */
const EXCLUDED = new Set(['package-lock.json', 'docs/stats/code-stats.json', 'docs/stats/code-stats.md']);

/** Category of a file outside `engines/<name>/`; undefined when it is not counted. */
export function categoryOf(file: string): Category | undefined {
  if (EXCLUDED.has(file)) return undefined;
  if (file.startsWith('test/')) return 'tests';
  if (file.startsWith('src/') || file.startsWith('scripts/')) return 'own';
  if (file.startsWith('docs/') || file.toLowerCase().endsWith('.md')) return 'docs';
  return 'config';
}

const STRINGS = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

export function countLines(text: string, style: CommentStyle): Omit<Counts, 'files'> {
  const counts = { lines: 0, blank: 0, comment: 0, code: 0 };
  if (text === '') return counts;
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const blockComments = style === 'c' || style === 'sql';
  const lineComment = style === 'c' ? '//' : style === 'sql' ? '--' : style === 'hash' ? '#' : undefined;
  let inBlock = false;
  for (const raw of lines) {
    counts.lines += 1;
    let line = raw.trim();
    if (line === '') {
      counts.blank += 1;
      continue;
    }
    let sawCode = false;
    if (blockComments && (inBlock || line.includes('/*'))) {
      if (!inBlock) line = line.replace(STRINGS, '""');
      for (;;) {
        if (inBlock) {
          const end = line.indexOf('*/');
          if (end === -1) break;
          inBlock = false;
          line = line.slice(end + 2).trim();
        } else {
          const start = line.indexOf('/*');
          const lineStart = lineComment ? line.indexOf(lineComment) : -1;
          if (start === -1 || (lineStart !== -1 && lineStart < start)) break;
          if (line.slice(0, start).trim() !== '') sawCode = true;
          inBlock = true;
          line = line.slice(start + 2);
        }
      }
      if (inBlock) line = '';
    }
    if (!sawCode && (line === '' || (lineComment !== undefined && line.startsWith(lineComment)))) counts.comment += 1;
    else counts.code += 1;
  }
  return counts;
}

const zero = (): Counts => ({ files: 0, lines: 0, blank: 0, comment: 0, code: 0 });
const emptyGroup = (): Group => ({ total: zero(), languages: {} });

function add(into: Counts, from: Counts): void {
  into.files += from.files;
  into.lines += from.lines;
  into.blank += from.blank;
  into.comment += from.comment;
  into.code += from.code;
}

export function addFile(group: Group, file: string, content: Uint8Array): void {
  const binary = content.subarray(0, 8192).includes(0);
  const language = binary ? { name: 'Binary', comments: 'none' as const } : languageOf(file);
  const counts: Counts = { files: 1, ...(binary ? { lines: 0, blank: 0, comment: 0, code: 0 } : countLines(new TextDecoder().decode(content), language.comments)) };
  add(group.total, counts);
  add((group.languages[language.name] ??= zero()), counts);
}

/** Languages by code lines, largest first; object key order is what makes the JSON deterministic. */
function sorted(group: Group): Group {
  const entries = Object.entries(group.languages).sort(([aName, a], [bName, b]) => b.code - a.code || b.files - a.files || aName.localeCompare(bName));
  return { total: group.total, languages: Object.fromEntries(entries) };
}

export function buildReport(categories: Record<Category, Group>, engines: Record<string, Group & { tree: string }>): Report {
  const summary = { own: zero(), tests: zero(), docs: zero(), config: zero(), vendored: zero(), total: zero() };
  for (const category of CATEGORIES) {
    add(summary[category], categories[category].total);
    add(summary.total, categories[category].total);
  }
  const sortedEngines: Report['engines'] = {};
  for (const name of Object.keys(engines).sort()) {
    const engine = engines[name];
    if (!engine) continue;
    add(summary.vendored, engine.total);
    add(summary.total, engine.total);
    sortedEngines[name] = { tree: engine.tree, ...sorted(engine) };
  }
  return {
    schemaVersion: 1,
    summary,
    categories: { own: sorted(categories.own), tests: sorted(categories.tests), docs: sorted(categories.docs), config: sorted(categories.config) },
    engines: sortedEngines,
  };
}

const LABELS: Record<Category | 'vendored' | 'total', string> = {
  own: '独自コード（`src/`、`scripts/`）',
  tests: 'テスト（`test/`）',
  docs: 'ドキュメント（`docs/`、`*.md`）',
  config: '設定・CI（上記以外）',
  vendored: '取り込んだエンジン（`engines/*/`）',
  total: '合計',
};
const number = (value: number) => value.toLocaleString('en-US');
const row = (label: string, counts: Counts) => `| ${label} | ${number(counts.files)} | ${number(counts.lines)} | ${number(counts.code)} | ${number(counts.comment)} | ${number(counts.blank)} |`;
const HEADER = ['| ファイル数 | 総行数 | コード行 | コメント行 | 空行 |', '|---|---:|---:|---:|---:|---:|'];

function languageTable(group: Group, limit: number): string[] {
  const entries = Object.entries(group.languages);
  const lines = [`| 言語 ${HEADER[0]}`, HEADER[1] ?? ''];
  for (const [name, counts] of entries.slice(0, limit)) lines.push(row(name, counts));
  const rest = zero();
  for (const [, counts] of entries.slice(limit)) add(rest, counts);
  if (entries.length > limit) lines.push(row(`その他 ${entries.length - limit} 言語`, rest));
  lines.push(row('**合計**', group.total));
  return lines;
}

export function renderMarkdown(report: Report): string {
  const out = [
    '# コード行数・言語別統計',
    '',
    '`npm run stats:update` が生成するファイルです。手で編集しないでください。`npm run stats:check`（`npm run check` に含まれます）が実際のソースとの一致を確認します。',
    '',
    'コメント行の判定は行単位の近似です。バイナリファイルはファイル数にだけ数えます。`package-lock.json` とこの統計ファイル自身は対象外です。',
    '',
    '## 概要',
    '',
    `| 区分 ${HEADER[0]}`,
    HEADER[1] ?? '',
  ];
  for (const key of [...CATEGORIES, 'vendored', 'total'] as const) out.push(row(key === 'total' ? '**合計**' : LABELS[key], report.summary[key]));
  for (const category of CATEGORIES) out.push('', `## ${LABELS[category]}`, '', ...languageTable(report.categories[category], 20));
  out.push('', `## ${LABELS.vendored}`, '', '上流コミットを固定したソースです（`engines/manifest.json`）。固定先が変わったときだけ数え直します。');
  for (const [name, engine] of Object.entries(report.engines)) out.push('', `### ${name}`, '', `ツリー ID: \`${engine.tree}\``, '', ...languageTable(engine, 8));
  return `${out.join('\n')}\n`;
}

const REPORT_JSON = 'docs/stats/code-stats.json';
const REPORT_MD = 'docs/stats/code-stats.md';

async function main(argv: string[]): Promise<number> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const git = (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    });
  const listFiles = async (args: string[]) => (await git(['ls-files', '-z', ...args])).split('\0').filter((file) => file !== '');
  const read = async (file: string): Promise<Uint8Array | undefined> => {
    const absolute = path.join(root, file);
    try {
      return (await lstat(absolute)).isFile() ? await readFile(absolute) : undefined;
    } catch {
      return undefined;
    }
  };

  const parsed = parseManifest(JSON.parse(await readFile(path.join(root, 'engines/manifest.json'), 'utf8')));
  if (!parsed.manifest) {
    console.error('engines/manifest.json is invalid; run npm run upstream:verify');
    return 1;
  }
  const engineDirectories = parsed.manifest.engines.map((engine) => `${engine.directory}/`);

  const categories: Record<Category, Group> = { own: emptyGroup(), tests: emptyGroup(), docs: emptyGroup(), config: emptyGroup() };
  const ownFiles = await listFiles(['--cached', '--others', '--exclude-standard', '--', '.', ...engineDirectories.map((directory) => `:(exclude)${directory}`)]);
  for (const file of [...new Set(ownFiles)].sort()) {
    const category = categoryOf(file);
    const content = category && (await read(file));
    if (category && content) addFile(categories[category], file, content);
  }

  let committed: Report | undefined;
  try {
    committed = JSON.parse(await readFile(path.join(root, REPORT_JSON), 'utf8')) as Report;
  } catch {
    committed = undefined;
  }

  const write = argv.includes('--write');
  const engines: Report['engines'] = {};
  const stale: string[] = [];
  for (const pin of parsed.manifest.engines) {
    const previous = committed?.engines?.[pin.name];
    if (previous?.tree === pin.tree && !(write && argv.includes('--full'))) {
      engines[pin.name] = previous;
      continue;
    }
    const group = emptyGroup();
    const files = await listFiles(['--', `${pin.directory}/`]);
    let missing = 0;
    for (const file of files.sort()) {
      const content = await read(file);
      if (content) addFile(group, file, content);
      else if (!(await lstat(path.join(root, file)).catch(() => undefined))) missing += 1;
    }
    if (files.length === 0 || missing > 0) {
      stale.push(`${pin.name}: the pin changed and ${pin.directory} is not fully checked out, so it cannot be recounted here`);
      if (previous) engines[pin.name] = previous;
      continue;
    }
    engines[pin.name] = { tree: pin.tree, ...group };
  }

  const report = buildReport(categories, engines);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);

  if (stale.length > 0) {
    for (const message of stale) console.error(`FAIL ${message}`);
    return 1;
  }
  if (write) {
    await writeFile(path.join(root, REPORT_JSON), json);
    await writeFile(path.join(root, REPORT_MD), markdown);
    console.log(`Wrote ${REPORT_JSON} and ${REPORT_MD}`);
    return 0;
  }
  if (argv.includes('--check')) {
    const currentMarkdown = await readFile(path.join(root, REPORT_MD), 'utf8').catch(() => '');
    if (!committed || `${JSON.stringify(committed, null, 2)}\n` !== json || currentMarkdown !== markdown) {
      console.error(`FAIL ${REPORT_JSON} / ${REPORT_MD} are out of date; run npm run stats:update and commit the result`);
      return 1;
    }
    console.log('OK: code statistics are up to date');
    return 0;
  }
  console.log(argv.includes('--json') ? json : markdown);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
