import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  ConfigurationError, createDefaultConfiguration, doctorReport, loadConfiguration,
  renderDoctorReport, resolveCredential,
} from '../src/config.ts';
import { createWorkspace, withRemoteEnabled } from './helpers/search-workspace.ts';

/**
 * Trusted configuration and the local `doctor` state (LG-007).
 *
 * Everything here runs offline and without a credential: that is the point of the
 * issue. A repository must not be able to widen its own authorization, an optional
 * cap must stay disabled unless the operator enabled it, and `doctor` must be usable
 * before anything is ever sent.
 */
const workspaces: { cleanup(): void }[] = [];

function workspace(options: Parameters<typeof createWorkspace>[0] = {}): ReturnType<typeof createWorkspace> {
  const created = createWorkspace(options);
  workspaces.push(created);
  return created;
}

after(() => {
  for (const created of workspaces) {
    created.cleanup();
  }
});

test('a generated configuration starts with remote evaluation disabled and every cap off', () => {
  const space = workspace({ files: { 'src/a.ts': 'export const a = 1;\n' } });
  const { config } = space.loaded;
  assert.equal(config.remote_evaluation_enabled, false);
  for (const [key, value] of Object.entries(config.scan_caps)) {
    assert.equal(value, null, `${key} must be disabled by default`);
  }
  assert.equal(config.source.follow_links, false);
  assert.equal(config.logging.include_source, false);
  assert.equal(config.search.deadline_ms, 300_000);
  assert.equal(config.search.default_response_tokens, 4_000);
});

test('repository-local configuration is accepted only at .layagrep/config.json', () => {
  const space = workspace({ files: { 'src/a.ts': 'export const a = 1;\n' } });
  const inside = join(space.repositoryRoot, 'layagrep.config.json');
  writeFileSync(inside, `${JSON.stringify(createDefaultConfiguration(space.repositoryRoot.split('\\').join('/'), 'convaiinnovations/laya'))}\n`);
  assert.throws(
    () => loadConfiguration(inside, { env: space.env }),
    (error: unknown) => error instanceof ConfigurationError && error.code === 'INVALID_CONFIG'
      && /only accepted at/.test(error.detail),
  );
  const localDirectory = join(space.repositoryRoot, '.layagrep');
  mkdirSync(localDirectory);
  const local = join(localDirectory, 'config.json');
  writeFileSync(local, `${JSON.stringify(createDefaultConfiguration(space.repositoryRoot.split('\\').join('/'), 'convaiinnovations/laya'))}\n`);
  assert.equal(loadConfiguration(local, { env: space.env }).configPath, local);
});

test('unsupported options are refused instead of silently ignored', () => {
  const space = workspace({ files: { 'src/a.ts': 'export const a = 1;\n' } });
  const base = createDefaultConfiguration(space.repositoryRoot.split('\\').join('/'), 'convaiinnovations/laya');
  const cases: [string, unknown][] = [
    ['follow_links', { ...base, source: { ...base.source, follow_links: true } }],
    ['include_source', { ...base, logging: { ...base.logging, include_source: true } }],
    ['unknown key', { ...base, telemetry: { enabled: true } }],
    ['unsupported endpoint', { ...base, provider: { ...base.provider, base_url: 'https://evil.example.com' } }],
    ['usd cap without pricing', { ...base, scan_caps: { ...base.scan_caps, estimated_cost_usd: 1 } }],
    ['zero as unlimited', { ...base, search: { ...base.search, deadline_ms: 0 } }],
  ];
  for (const [label, candidate] of cases) {
    const path = join(space.root, `bad-${label.replace(/\W+/g, '-')}.json`);
    writeFileSync(path, `${JSON.stringify(candidate)}\n`);
    assert.throws(
      () => loadConfiguration(path, { env: space.env }),
      (error: unknown) => error instanceof ConfigurationError && error.code === 'INVALID_CONFIG',
      `${label} should be refused`,
    );
  }
});

test('local Laya needs disclosure authorization but no credential', () => {
  const disabled = workspace({ files: { 'src/a.ts': 'export const a = 1;\n' } });
  assert.throws(
    () => resolveCredential(disabled.loaded, {}),
    (error: unknown) => error instanceof ConfigurationError && error.code === 'REMOTE_DISABLED',
  );

  const enabled = workspace({ files: { 'src/a.ts': 'export const a = 1;\n' }, configure: withRemoteEnabled });
  assert.equal(resolveCredential(enabled.loaded, {}), '');
});

test('doctor reports the useful state without a key and without printing the secret', () => {
  const space = workspace({ files: { 'src/a.ts': 'export const a = 1;\n' }, configure: withRemoteEnabled });
  const report = doctorReport(space.loaded, { LAYAGREP_LOCAL_TOKEN: 'super-secret-value' });
  const text = renderDoctorReport(report).join('\n');

  assert.equal(report.provider.credential, 'not_required');
  assert.equal(report.provider.adapter, 'laya-local');
  assert.ok(text.includes('laya-local'));
  assert.ok(!text.includes('super-secret-value'), 'doctor must never print the credential value');
  assert.ok(text.includes('credential         not required'));
  assert.ok(text.includes(space.repositoryRoot), 'doctor states the authorized root');
  assert.ok(text.includes('all disabled (null)'), 'doctor states that optional caps are off');
  assert.ok(text.includes('tiktoken@1.0.22/cl100k_base'), 'doctor names the response counter');
  assert.deepEqual(report.disabled_scan_caps.length, 7);
  assert.equal(report.pricing, null);

  const withoutKey = doctorReport(space.loaded, {});
  assert.equal(withoutKey.provider.credential, 'not_required');
});

test('doctor explains a disabled disclosure rather than reporting a missing key', () => {
  const space = workspace({ files: { 'src/a.ts': 'export const a = 1;\n' } });
  const report = doctorReport(space.loaded, {});
  assert.equal(report.provider.credential, 'not_required');
  assert.ok(report.problems.some((problem) => problem.includes('remote evaluation is disabled')));
  assert.ok(renderDoctorReport(report).join('\n').includes('no excerpt leaves this machine'));
});

test('an enabled cap is reported with its value, a disabled one stays null', () => {
  const space = workspace({
    files: { 'src/a.ts': 'export const a = 1;\n' },
    configure: (config) => ({ ...config, scan_caps: { ...config.scan_caps, request_attempts: 12 } }),
  });
  const report = doctorReport(space.loaded, {});
  assert.deepEqual(report.enabled_scan_caps, { request_attempts: 12 });
  assert.ok(!report.disabled_scan_caps.includes('request_attempts'));
  assert.ok(renderDoctorReport(report).join('\n').includes('request_attempts: 12'));
});

test('the cache directory is derived per root inside the repository runtime', () => {
  const space = workspace({ files: { 'src/a.ts': 'export const a = 1;\n' } });
  assert.ok(space.loaded.cacheDirectory.startsWith(join(space.repositoryRoot, '.layagrep', 'cache')));
  assert.ok(space.loaded.cacheDirectory.includes(space.loaded.fingerprint));

  const other = workspace({ files: { 'src/a.ts': 'export const a = 1;\n' } });
  assert.notEqual(space.loaded.fingerprint, other.loaded.fingerprint);
});

test('a missing or malformed configuration file is a configuration error, not a crash', () => {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'layagrep-config-')));
  const broken = join(directory, 'broken.json');
  writeFileSync(broken, '{ not json');
  try {
    assert.throws(
      () => loadConfiguration(join(directory, 'absent.json'), {}),
      (error: unknown) => error instanceof ConfigurationError && error.code === 'INVALID_CONFIG',
    );
    assert.throws(
      () => loadConfiguration(broken, {}),
      (error: unknown) => error instanceof ConfigurationError && /not valid JSON/.test(error.detail),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
