import type { Configuration } from '../contracts.ts';
import { LayaAdapter, buildRequestPayload, type EvaluationBatch, type LayaAdapterOptions, type ProviderClient } from './laya.ts';
export type ProviderAdapterKind = 'laya-local';
export type ProviderFactories = { readonly local: (options: LayaAdapterOptions) => ProviderClient };
const defaultFactories: ProviderFactories = { local: (options) => new LayaAdapter(options) };
export function configuredAdapter(_config: Configuration): ProviderAdapterKind { return 'laya-local'; }
export function serializeConfiguredBatch(config: Configuration, batch: EvaluationBatch): string { return JSON.stringify(buildRequestPayload(batch, config.provider.model)); }
export function createConfiguredProvider(config: Configuration, _credential = '', factories: ProviderFactories = defaultFactories): ProviderClient {
  return factories.local({ baseUrl: config.provider.base_url, model: config.provider.model });
}
