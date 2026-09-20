import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBatches } from '../src/engine.ts';
import { buildRequestPayload, type EvaluationBatch } from '../src/evaluation/laya.ts';
import { batchLimits, scoreCachePolicy } from '../src/evaluation/policy.ts';
import type { PreparedFragment } from '../src/source/chunker.ts';

function fragment(index: number, text = 'export const value = 1;'): PreparedFragment {
  const path = `src/file-${String(index)}.ts`;
  return { id: path, path, text, startLine: 1, endLine: 1, byteStart: 0, byteEnd: Buffer.byteLength(text),
    byteCount: Buffer.byteLength(text), tokenCount: 6, sha256: 'snapshot', chunker: 'test', classification: 'line-window' };
}
const serialize = (batch: EvaluationBatch): string => JSON.stringify(buildRequestPayload(batch, 'convaiinnovations/laya'));

test('Laya batching sends exactly one fragment per request', () => {
  const batches = buildBatches([fragment(2), fragment(0), fragment(1)], 'Find value', { serialize });
  assert.deepEqual(batches.map((batch) => batch.items.map((item) => item.id)), [['src/file-0.ts'], ['src/file-1.ts'], ['src/file-2.ts']]);
  assert.equal(batchLimits().maxItems, 1);
});

test('oversized fragments are rejected by the Laya context policy', () => {
  assert.throws(() => buildBatches([fragment(0, 'value '.repeat(1_000))], 'Find value', { serialize }), /one question exceeds/);
});

test('Laya model cache reuse is explicitly short-lived', () => {
  assert.deepEqual(scoreCachePolicy('laya-local', 'convaiinnovations/laya', { enabled: true, ttl_seconds: 604_800 }), { mode: 'rolling', ttlSeconds: 900 });
  assert.equal(scoreCachePolicy('laya-local', 'other', { enabled: true, ttl_seconds: 604_800 }).mode, 'disabled');
});
