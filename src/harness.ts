import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PiHarnessAction = 'install' | 'status' | 'uninstall';

export type PiHarnessOptions = {
  readonly action: PiHarnessAction;
  readonly cwd: string;
  readonly root?: string;
  readonly global: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly sourceUrl?: string;
};

export type PiHarnessResult = {
  readonly state: 'installed' | 'missing' | 'removed';
  readonly path: string;
  readonly changed: boolean;
};

const MANAGED_MARKER = 'Managed by LayaGrep';

function extensionSource(sourceUrl: string | undefined): string {
  const url = sourceUrl ?? new URL('../integrations/pi/layagrep.ts', import.meta.url).href;
  return readFileSync(fileURLToPath(url), 'utf8');
}

export function piExtensionPath(options: Pick<PiHarnessOptions, 'cwd' | 'root' | 'global' | 'env'>): string {
  if (options.global) {
    const agentDirectory = options.env['PI_CODING_AGENT_DIR']?.trim() || join(homedir(), '.pi', 'agent');
    return join(resolve(agentDirectory), 'extensions', 'layagrep.ts');
  }
  return join(resolve(options.cwd, options.root ?? '.'), '.pi', 'extensions', 'layagrep.ts');
}

export function managePiHarness(options: PiHarnessOptions): PiHarnessResult {
  const path = piExtensionPath(options);
  if (options.action === 'status') {
    return { state: existsSync(path) ? 'installed' : 'missing', path, changed: false };
  }
  if (options.action === 'uninstall') {
    if (!existsSync(path)) return { state: 'missing', path, changed: false };
    const current = readFileSync(path, 'utf8');
    if (!current.includes(MANAGED_MARKER)) {
      throw new Error(`refusing to remove unmanaged Pi extension at ${path}`);
    }
    rmSync(path);
    return { state: 'removed', path, changed: true };
  }

  const source = extensionSource(options.sourceUrl);
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8');
    if (current === source) return { state: 'installed', path, changed: false };
    if (!current.includes(MANAGED_MARKER)) {
      throw new Error(`refusing to overwrite unmanaged Pi extension at ${path}`);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
  return { state: 'installed', path, changed: true };
}
