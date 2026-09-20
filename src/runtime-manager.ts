import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  statSync, writeFileSync,
} from 'node:fs';
import { arch, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDefaultConfiguration, type Configuration } from './contracts.ts';
import { DEFAULT_LAYA_MODEL } from './evaluation/policy.ts';
import { AuthorizedRoot } from './source/authorization.ts';

export const RUNTIME_DIRECTORY = '.layagrep';
const HEALTH_TIMEOUT_MS = 30_000;

export type RuntimePaths = {
  readonly root: string;
  readonly home: string;
  readonly config: string;
  readonly uv: string;
  readonly python: string;
  readonly runtime: string;
  readonly server: string;
  readonly log: string;
  readonly metadata: string;
  readonly token: string;
  readonly hfHome: string;
};

export type RuntimeMetadata = {
  readonly schema_version: 1;
  readonly pid: number;
  readonly port: number;
  readonly started_at: string;
  readonly instance: string;
};

export type RuntimeStatus = {
  readonly state: 'running' | 'stopped' | 'stale';
  readonly paths: RuntimePaths;
  readonly metadata?: RuntimeMetadata;
  readonly detail?: string;
};

function executable(root: string, unixName: string): string {
  return join(root, process.platform === 'win32' ? `${unixName}.exe` : unixName);
}

export function runtimePaths(rootPath: string): RuntimePaths {
  const root = AuthorizedRoot.open(resolve(rootPath)).path;
  const home = join(root, RUNTIME_DIRECTORY);
  return {
    root,
    home,
    config: join(home, 'config.json'),
    uv: executable(join(home, 'bin'), 'uv'),
    python: process.platform === 'win32'
      ? join(home, 'venv', 'Scripts', 'python.exe')
      : join(home, 'venv', 'bin', 'python'),
    runtime: join(home, 'runtime'),
    server: join(home, 'runtime', 'server.py'),
    log: join(home, 'logs', 'server.log'),
    metadata: join(home, 'run', 'server.json'),
    token: join(home, 'run', 'control-token'),
    hfHome: join(home, 'huggingface'),
  };
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (lstatSync(path).isSymbolicLink() || !statSync(path).isDirectory()) throw new Error(`${path} is not a real directory`);
}

function ensureRuntimeDirectories(paths: RuntimePaths): void {
  ensureDirectory(paths.home);
  for (const child of ['bin', 'python', 'venv', 'runtime', 'logs', 'run', 'huggingface', 'uv-cache', 'cache']) {
    ensureDirectory(join(paths.home, child));
  }
}

function bundledRuntimeDirectory(): string {
  return fileURLToPath(new URL('../runtime/', import.meta.url));
}

function copyRuntime(paths: RuntimePaths): void {
  const source = bundledRuntimeDirectory();
  for (const name of ['pyproject.toml', 'uv.lock', 'server.py']) copyFileSync(join(source, name), join(paths.runtime, name));
}

function runtimeEnvironment(paths: RuntimePaths, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    HF_HOME: paths.hfHome,
    UV_CACHE_DIR: join(paths.home, 'uv-cache'),
    UV_PYTHON_INSTALL_DIR: join(paths.home, 'python'),
    UV_PROJECT_ENVIRONMENT: join(paths.home, 'venv'),
    PYTHONUTF8: '1',
    USE_TF: '0',
  };
}

function run(command: string, args: readonly string[], paths: RuntimePaths): void {
  const result = spawnSync(command, [...args], {
    cwd: paths.root,
    env: runtimeEnvironment(paths),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(-2_000);
    throw new Error(`${basename(command)} failed${detail.length === 0 ? '' : `: ${detail}`}`);
  }
}

async function installUv(paths: RuntimePaths): Promise<void> {
  if (existsSync(paths.uv)) return;
  const windows = process.platform === 'win32';
  const url = windows ? 'https://astral.sh/uv/install.ps1' : 'https://astral.sh/uv/install.sh';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not download the uv installer (HTTP ${String(response.status)})`);
  const installer = join(paths.home, 'run', windows ? 'install-uv.ps1' : 'install-uv.sh');
  writeFileSync(installer, await response.text(), { mode: 0o700 });
  const env = { ...runtimeEnvironment(paths), UV_INSTALL_DIR: dirname(paths.uv), UV_NO_MODIFY_PATH: '1' };
  const command = windows ? 'powershell.exe' : 'sh';
  const args = windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer] : [installer];
  const result = spawnSync(command, args, { cwd: paths.root, env, encoding: 'utf8', windowsHide: true });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 || !existsSync(paths.uv)) {
    throw new Error(`uv installation failed: ${(result.stderr || result.stdout).trim().slice(-2_000)}`);
  }
}

function writeConfiguration(paths: RuntimePaths, port: number): void {
  let config: Configuration;
  if (existsSync(paths.config)) {
    config = JSON.parse(readFileSync(paths.config, 'utf8')) as Configuration;
  } else {
    config = createDefaultConfiguration(paths.root, DEFAULT_LAYA_MODEL);
  }
  const next = {
    ...config,
    repository_root: paths.root,
    remote_evaluation_enabled: true,
    provider: { ...config.provider, base_url: `http://127.0.0.1:${String(port)}` },
    source: {
      ...config.source,
      extra_deny_globs: [...new Set([...config.source.extra_deny_globs, '.layagrep/**'])],
    },
  } satisfies Configuration;
  writeFileSync(paths.config, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(paths.home, '.gitignore'), '*\n', { mode: 0o600 });
}

export async function setupRuntime(root: string, port: number, progress: (stage: string) => void = () => {}): Promise<RuntimePaths> {
  const paths = runtimePaths(root);
  const current = await runtimeStatus(root);
  if (current.state === 'running' || (current.state === 'stale' && current.metadata !== undefined && alive(current.metadata.pid))) {
    throw new Error("stop the active Laya server before updating its runtime");
  }
  progress('preparing .layagrep runtime directories');
  ensureRuntimeDirectories(paths);
  copyRuntime(paths);
  writeConfiguration(paths, port);
  progress('installing repository-private uv');
  await installUv(paths);
  progress('installing pinned Python 3.11 dependencies');
  run(paths.uv, ['sync', '--project', paths.runtime, '--locked', '--no-install-project', '--python', '3.11'], paths);
  progress('downloading and validating convaiinnovations/laya');
  run(paths.python, [paths.server, '--preload'], paths);
  return paths;
}

function readMetadata(paths: RuntimePaths): RuntimeMetadata | undefined {
  if (!existsSync(paths.metadata)) return undefined;
  try {
    const value = JSON.parse(readFileSync(paths.metadata, 'utf8')) as Partial<RuntimeMetadata>;
    if (value.schema_version !== 1 || !Number.isSafeInteger(value.pid) || !Number.isSafeInteger(value.port)
      || typeof value.started_at !== 'string' || typeof value.instance !== 'string' || value.instance.length < 16) return undefined;
    return value as RuntimeMetadata;
  } catch {
    return undefined;
  }
}

async function healthy(port: number, instance: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const body = await response.json() as { service?: unknown; instance?: unknown };
    return body.service === 'layagrep' && body.instance === instance;
  } catch {
    return false;
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function runtimeStatus(root: string): Promise<RuntimeStatus> {
  const paths = runtimePaths(root);
  const metadata = readMetadata(paths);
  if (metadata === undefined) return { state: 'stopped', paths };
  if (await healthy(metadata.port, metadata.instance)) return { state: 'running', paths, metadata };
  return alive(metadata.pid)
    ? { state: 'stale', paths, metadata, detail: 'process exists but health check failed' }
    : { state: 'stale', paths, metadata, detail: 'runtime metadata points to a stopped process' };
}

function configuredPort(paths: RuntimePaths): number {
  const config = JSON.parse(readFileSync(paths.config, 'utf8')) as { provider?: { base_url?: unknown } };
  const url = new URL(String(config.provider?.base_url ?? ''));
  const port = Number(url.port);
  if (url.hostname !== '127.0.0.1' || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('runtime config does not contain a valid loopback port');
  }
  return port;
}

export async function startRuntime(root: string): Promise<RuntimeStatus> {
  const paths = runtimePaths(root);
  if (!existsSync(paths.python) || !existsSync(paths.server) || !existsSync(paths.config)) {
    throw new Error(`runtime is not installed at ${paths.home}; run 'layagrep setup' first`);
  }
  const current = await runtimeStatus(root);
  if (current.state === 'running') return current;
  if (current.state === 'stale' && current.metadata !== undefined && alive(current.metadata.pid)) {
    throw new Error(`PID ${String(current.metadata.pid)} is alive but unhealthy; run 'layagrep stop' first`);
  }
  const port = configuredPort(paths);
  const token = randomBytes(32).toString('hex');
  const instance = randomBytes(16).toString('hex');
  writeFileSync(paths.token, `${token}\n`, { mode: 0o600 });
  const log = openSync(paths.log, 'a', 0o600);
  const child = spawn(paths.python, [paths.server, '--host', '127.0.0.1', '--port', String(port), '--token', token, '--instance', instance], {
    cwd: paths.root,
    env: runtimeEnvironment(paths),
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  closeSync(log);
  if (child.pid === undefined) throw new Error('the Laya server did not return a process id');
  child.unref();
  const metadata: RuntimeMetadata = { schema_version: 1, pid: child.pid, port, started_at: new Date().toISOString(), instance };
  writeFileSync(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await healthy(port, instance)) return { state: 'running', paths, metadata };
    if (!alive(child.pid)) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Laya server did not become healthy; inspect ${paths.log}`);
}

async function forceStop(metadata: RuntimeMetadata): Promise<void> {
  if (!alive(metadata.pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(metadata.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try { process.kill(metadata.pid, 'SIGTERM'); } catch { return; }
  }
}

export async function stopRuntime(root: string): Promise<RuntimeStatus> {
  const paths = runtimePaths(root);
  const metadata = readMetadata(paths);
  if (metadata === undefined) return { state: 'stopped', paths };
  const token = existsSync(paths.token) ? readFileSync(paths.token, 'utf8').trim() : '';
  if (token.length > 0 && await healthy(metadata.port, metadata.instance)) {
    try {
      await fetch(`http://127.0.0.1:${String(metadata.port)}/shutdown`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2_000),
      });
    } catch { /* The fallback below owns hung or abruptly closed processes. */ }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && alive(metadata.pid)) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  await forceStop(metadata);
  try { writeFileSync(paths.metadata, '', { mode: 0o600 }); } catch { /* setup may be partial */ }
  return { state: 'stopped', paths };
}

export function readRuntimeLog(root: string, lines = 200): string {
  const paths = runtimePaths(root);
  if (!existsSync(paths.log)) return '';
  return readFileSync(paths.log, 'utf8').split(/\r?\n/).slice(-lines - 1).join('\n').trimEnd();
}

export function platformSummary(): string {
  return `${platform()} ${arch()} / Node ${process.versions.node}`;
}
