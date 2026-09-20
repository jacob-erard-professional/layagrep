import { countReferenceTokens } from '../response/token-counter.ts';
export type AdapterKind = 'laya-local';
export const DEFAULT_LAYA_MODEL = 'convaiinnovations/laya';
export const MAX_ROLLING_TTL_SECONDS = 900;
export type BatchLimits = { readonly totalTokens: number; readonly perQuestionTokens: number; readonly headroomRatio: number; readonly maxItems: number; readonly maxRequestBytes: number };
export function batchLimits(_adapter: AdapterKind = 'laya-local'): BatchLimits { return { totalTokens: 320, perQuestionTokens: 320, headroomRatio: 0.8, maxItems: 1, maxRequestBytes: 16_384 }; }
export function fitsSerializedBatch(body: string, limits: BatchLimits): boolean {
  if (Buffer.byteLength(body, 'utf8') > limits.maxRequestBytes) return false;
  const payload = JSON.parse(body) as { questions: Record<string, unknown> };
  return Object.keys(payload.questions).length <= limits.maxItems && countReferenceTokens(body) <= limits.totalTokens * limits.headroomRatio;
}
export function isPinnedModelRevision(_model: string): boolean { return false; }
export function isRollingModel(model: string): boolean { return model === DEFAULT_LAYA_MODEL; }
export function scoreCachePolicy(_adapter: AdapterKind, model: string, cache: { readonly enabled: boolean; readonly ttl_seconds: number; readonly rolling_ttl_seconds?: number }): { mode: 'pinned' | 'rolling' | 'disabled'; ttlSeconds: number } {
  if (!cache.enabled || !isRollingModel(model)) return { mode: 'disabled', ttlSeconds: 0 };
  const ttlSeconds = Math.min(cache.ttl_seconds, cache.rolling_ttl_seconds ?? MAX_ROLLING_TTL_SECONDS, MAX_ROLLING_TTL_SECONDS);
  return ttlSeconds > 0 ? { mode: 'rolling', ttlSeconds } : { mode: 'disabled', ttlSeconds: 0 };
}
