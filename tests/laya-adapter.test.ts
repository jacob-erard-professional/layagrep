import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LayaAdapter, ProviderError, buildRequestPayload, normalizeResponse, type EvaluationBatch } from '../src/evaluation/laya.ts';

const batch: EvaluationBatch = { query: 'Where is auth checked?', items: [
  { id: 'one', path: 'src/auth.ts', startLine: 1, endLine: 2, text: 'export function auth() {}' },
] };

test('Laya receives one excerpt as state and one Noul relevance question', () => {
  const body = buildRequestPayload(batch, 'convaiinnovations/laya');
  assert.equal(body.model, 'convaiinnovations/laya');
  assert.equal(body.state.excerpt, batch.items[0]!.text);
  assert.equal(body.questions['one']?.type, 'noul');
  assert.ok(body.questions['one']?.criteria.true.includes('concrete evidence'));
});

test('the local adapter sends no credential and validates the returned probability', async () => {
  let authorization: string | undefined;
  const adapter = new LayaAdapter({ baseUrl: 'http://127.0.0.1:8000', model: 'convaiinnovations/laya',
    transport: async (request) => {
      authorization = request.headers['authorization'];
      return { status: 200, headers: {}, text: JSON.stringify({ model: 'convaiinnovations/laya', answers: { one: { noul: 0.87 } } }) };
    } });
  const result = await adapter.evaluateBatch(batch);
  assert.equal(authorization, undefined);
  assert.equal(result.scores.get('one'), 0.87);
  assert.equal(result.usage.inputTokens, null);
});

test('invalid Laya answers never become scores', () => {
  const result = normalizeResponse({ answers: { one: { noul: 2 }, extra: { noul: 0.5 } } }, batch, 'convaiinnovations/laya', 10);
  assert.equal(result.scores.size, 0);
  assert.deepEqual(new Map(result.invalid.map((entry) => [entry.id, entry.reason])), new Map([['one', 'out_of_range'], ['extra', 'unexpected']]));
});

test('the local adapter reports an unavailable service without leaking a response body', async () => {
  const adapter = new LayaAdapter({ baseUrl: 'http://127.0.0.1:8000', model: 'convaiinnovations/laya',
    transport: async () => ({ status: 503, headers: {}, text: 'sensitive server detail' }) });
  await assert.rejects(adapter.evaluateBatch(batch), (cause: unknown) => cause instanceof ProviderError
    && cause.code === 'PROVIDER_UNAVAILABLE' && !cause.message.includes('sensitive'));
});
