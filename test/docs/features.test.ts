import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const STATUSES = ['未着手', '実装済み', '検証済み'];
const INITIAL_PACKAGE = [1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 24, 26];

test('the feature tracker lists all 60 features with a valid status', async () => {
  const text = await readFile(new URL('../../docs/roadmap/features.md', import.meta.url), 'utf8');
  const rows = text
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => /^\d+$/.test(cells[1] ?? ''));
  assert.deepEqual(rows.map((cells) => Number(cells[1])), Array.from({ length: 60 }, (_, index) => index + 1));
  for (const cells of rows) {
    assert.ok(cells[2], `feature ${cells[1]} has no name`);
    assert.ok(STATUSES.includes(cells[4] ?? ''), `feature ${cells[1]} has invalid status "${cells[4]}"`);
    if (cells[4] !== '未着手') assert.ok(cells[5], `feature ${cells[1]} is ${cells[4]} but names no implementation`);
  }
  const initial = rows.filter((cells) => cells[3] === '●').map((cells) => Number(cells[1]));
  assert.deepEqual(initial, INITIAL_PACKAGE);
});
