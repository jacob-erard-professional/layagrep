import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredProvider, configuredAdapter } from '../src/evaluation/provider.ts';
import type { LayaAdapterOptions, ProviderClient } from '../src/evaluation/laya.ts';
import { validConfiguration } from './fixtures/contracts.ts';

test('the provider factory selects the local Laya service', () => {
  let observed: LayaAdapterOptions | undefined;
  const fake: ProviderClient = { model: 'fake', evaluateBatch: async () => { throw new Error('unused'); } };
  assert.equal(configuredAdapter(validConfiguration), 'laya-local');
  assert.equal(createConfiguredProvider(validConfiguration, '', { local: (options) => { observed = options; return fake; } }), fake);
  assert.equal(observed?.baseUrl, 'http://127.0.0.1:8000');
  assert.equal(observed?.model, validConfiguration.provider.model);
});
