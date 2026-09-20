import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

import { managePiHarness, piExtensionPath } from '../src/harness.ts';

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; sourceUrl: string } {
  const root = mkdtempSync(join(tmpdir(), 'layagrep-harness-'));
  roots.push(root);
  const source = join(root, 'source.ts');
  writeFileSync(source, '// Managed by LayaGrep\nexport default function () {}\n', 'utf8');
  return { root, sourceUrl: pathToFileURL(source).href };
}

test('Pi project installation is idempotent and removable', () => {
  const { root, sourceUrl } = fixture();
  const options = { cwd: root, global: false, env: {}, sourceUrl } as const;
  const path = join(root, '.pi', 'extensions', 'layagrep.ts');

  assert.deepEqual(managePiHarness({ ...options, action: 'status' }), { state: 'missing', path, changed: false });
  assert.deepEqual(managePiHarness({ ...options, action: 'install' }), { state: 'installed', path, changed: true });
  assert.match(readFileSync(path, 'utf8'), /Managed by LayaGrep/);
  assert.deepEqual(managePiHarness({ ...options, action: 'install' }), { state: 'installed', path, changed: false });
  assert.deepEqual(managePiHarness({ ...options, action: 'uninstall' }), { state: 'removed', path, changed: true });
  assert.deepEqual(managePiHarness({ ...options, action: 'uninstall' }), { state: 'missing', path, changed: false });
});

test('Pi harness management refuses to overwrite or remove an unmanaged extension', () => {
  const { root, sourceUrl } = fixture();
  const options = { cwd: root, global: false, env: {}, sourceUrl } as const;
  const path = piExtensionPath(options);
  const directory = dirname(path);
  // The first install creates the parent directory portably.
  managePiHarness({ ...options, action: 'install' });
  writeFileSync(path, 'export default function unrelated() {}\n', 'utf8');
  assert.throws(() => managePiHarness({ ...options, action: 'install' }), /unmanaged/);
  assert.throws(() => managePiHarness({ ...options, action: 'uninstall' }), /unmanaged/);
  assert.equal(dirname(path), directory);
});

test('global Pi installation honors PI_CODING_AGENT_DIR', () => {
  const { root } = fixture();
  const path = piExtensionPath({ cwd: root, global: true, env: { PI_CODING_AGENT_DIR: join(root, 'pi-home') } });
  assert.equal(path, join(root, 'pi-home', 'extensions', 'layagrep.ts'));
});
