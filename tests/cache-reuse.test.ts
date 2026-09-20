import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSearchEngine } from '../src/engine.ts';
import type { ProviderClient } from '../src/evaluation/laya.ts';
import { createWorkspace } from './helpers/search-workspace.ts';

test('local Laya scores are reused within the bounded rolling TTL', async () => {
  const space = createWorkspace({ files: { 'auth.ts': 'export function authenticate() { return true; }\n' } });
  let calls = 0;
  const provider: ProviderClient = { model: 'convaiinnovations/laya', async evaluateBatch(batch) {
    calls++;
    return { scores: new Map(batch.items.map((item) => [item.id, 0.9])), invalid: [], usage: { inputTokens: null, outputTokens: null },
      requestedModel: this.model, returnedModel: this.model, transmittedBytes: 10, requestId: null };
  } };
  try {
    await createSearchEngine({ configuration: space.loaded, provider }).search({ query: 'auth' });
    const second = (await createSearchEngine({ configuration: space.loaded, provider }).search({ query: 'auth' })).outcome;
    assert.equal(calls, 1);
    assert.ok('report' in second);
    assert.equal(second.report.fragments.cache_reused, 1);
  } finally { space.cleanup(); }
});
