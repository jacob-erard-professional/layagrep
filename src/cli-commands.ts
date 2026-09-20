/**
 * CLI command execution (LG-023).
 *
 * The parser (`cli-args.ts`) decides *what* was asked; this module performs it
 * against the shared engine and maps the outcome onto the documented exit codes of
 * specification section 4.5. It holds no search logic of its own.
 *
 * Output discipline: stdout carries exactly the result that was asked for — the
 * canonical JSON payload, the human rendering, a report — and stderr carries
 * diagnostics, measurements and configuration problems. A pipeline can therefore keep
 * the evidence on stdout even when the exit code is non-zero.
 *
 * `doctor`, `inspect` and `cache clear` never need a credential and never dispatch a
 * provider request.
 */
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import type { CliCommand } from './cli-args.ts';
import { renderHumanOutcome } from './cli-render.ts';
import type { CliIo } from './cli.ts';
import { ConfigurationError, doctorReport, loadConfiguration, renderDoctorReport } from './config.ts';
import type { LoadedConfiguration } from './config.ts';
import { createSearchError } from './contracts.ts';
import { SearchEngine, createSearchEngine } from './engine.ts';
import { ScoreCache } from './evaluation/cache.ts';
import { inspectScope, renderInspection } from './inspect.ts';
import { discoverProjectConfiguration } from './init.ts';
import { managePiHarness } from './harness.ts';
import { runMcpServer } from './mcp.ts';
import {
  platformSummary, readRuntimeLog, runtimePaths, runtimeStatus, setupRuntime, startRuntime, stopRuntime,
} from './runtime-manager.ts';
import { CLI_EXIT_CODES, toCliSearchResponse } from './search-response.ts';
import { REFERENCE_COUNTER_ID, referenceCounter } from './response/token-counter.ts';

export type CommandDependencies = {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly serverVersion?: string;
  /** Stdio streams for `mcp`; defaults to this process's own. */
  readonly input?: Readable;
  readonly output?: Writable;
  readonly errorOutput?: Writable;
  /** User interruption, wired to SIGINT by the entry point. */
  readonly signal?: AbortSignal;
  /** Test seam: builds the engine, for example with a scripted provider. */
  readonly engineFactory?: (configuration: LoadedConfiguration) => SearchEngine;
  readonly prompt?: (question: string) => Promise<string>;
};

/** Load the trusted configuration, reporting a configuration problem as a rejection. */
function load(command: { config?: string }, io: CliIo, deps: CommandDependencies): LoadedConfiguration | number {
  const cwd = deps.cwd ?? process.cwd();
  let config: string;
  try {
    config = command.config ?? discoverProjectConfiguration(cwd, deps.env ?? process.env);
  } catch (cause) {
    io.err(`layagrep: INVALID_CONFIG: ${cause instanceof Error ? cause.message : 'no project profile was found'}`);
    return CLI_EXIT_CODES.rejected;
  }
  try {
    return loadConfiguration(config, {
      ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
      ...(deps.env === undefined ? {} : { env: deps.env }),
    });
  } catch (cause) {
    if (cause instanceof ConfigurationError) {
      io.err(`layagrep: ${cause.code}: ${cause.detail}`);
      return CLI_EXIT_CODES.rejected;
    }
    io.err(`layagrep: the configuration could not be loaded: ${cause instanceof Error ? cause.message : 'unknown failure'}`);
    return CLI_EXIT_CODES.error;
  }
}

function engineFor(configuration: LoadedConfiguration, deps: CommandDependencies): SearchEngine {
  return deps.engineFactory?.(configuration) ?? createSearchEngine({
    configuration,
    env: commandEnvironment(configuration, deps),
  });
}

function commandEnvironment(loaded: LoadedConfiguration, deps: CommandDependencies): NodeJS.ProcessEnv {
  void loaded;
  return deps.env ?? process.env;
}

/** Run one parsed command and return the process exit code. */
export async function executeCommand(
  command: CliCommand,
  io: CliIo,
  deps: CommandDependencies = {},
): Promise<number> {
  switch (command.kind) {
    case 'setup': return runSetup(command, io, deps);
    case 'start': return runStart(command, io, deps);
    case 'stop': return runStop(command, io, deps);
    case 'restart': return runRestart(command, io, deps);
    case 'status': return runStatus(command, io, deps);
    case 'logs': return runLogs(command, io, deps);
    case 'doctor':
      return runDoctor(command, io, deps);
    case 'inspect':
      return runInspect(command, io, deps);
    case 'search':
      return runSearch(command, io, deps);
    case 'cache-clear':
      return runCacheClear(command, io, deps);
    case 'mcp':
      return runMcp(command, io, deps);
    case 'harness-pi':
      return runHarnessPi(command, io, deps);
  }
}

function runHarnessPi(command: Extract<CliCommand, { kind: 'harness-pi' }>, io: CliIo, deps: CommandDependencies): number {
  try {
    const result = managePiHarness({
      action: command.action,
      cwd: deps.cwd ?? process.cwd(),
      ...(command.root === undefined ? {} : { root: command.root }),
      global: command.global,
      env: deps.env ?? process.env,
    });
    const scope = command.global ? 'global' : 'project';
    if (result.state === 'installed') {
      io.out(`Pi harness: installed (${scope}) at ${result.path}${result.changed ? '' : ' — already current'}`);
      if (result.changed) io.out('next: start or reload Pi, then ask it to use the layagrep tool');
    } else if (result.state === 'removed') {
      io.out(`Pi harness: removed ${result.path}`);
    } else {
      io.out(`Pi harness: not installed at ${result.path}`);
    }
    return CLI_EXIT_CODES.complete;
  } catch (cause) {
    io.err(`layagrep: Pi harness ${command.action} failed: ${cause instanceof Error ? cause.message : 'unknown failure'}`);
    return CLI_EXIT_CODES.error;
  }
}

function lifecycleRoot(root: string | undefined, deps: CommandDependencies): string {
  const cwd = deps.cwd ?? process.cwd();
  if (root !== undefined) return resolve(cwd, root);
  try {
    return dirname(dirname(discoverProjectConfiguration(cwd, deps.env ?? process.env)));
  } catch { return resolve(cwd); }
}

async function runSetup(command: Extract<CliCommand, { kind: 'setup' }>, io: CliIo, deps: CommandDependencies): Promise<number> {
  try {
    const paths = await setupRuntime(resolve(deps.cwd ?? process.cwd(), command.root), command.port,
      (stage) => io.out(`setup: ${stage}`));
    io.out(`LayaGrep is installed in ${paths.home}\nmodel: convaiinnovations/laya\nnext: layagrep start`);
    return CLI_EXIT_CODES.complete;
  } catch (cause) {
    io.err(`layagrep: setup failed: ${cause instanceof Error ? cause.message : 'unknown failure'}`);
    return CLI_EXIT_CODES.error;
  }
}

async function runStart(command: Extract<CliCommand, { kind: 'start' }>, io: CliIo, deps: CommandDependencies): Promise<number> {
  try {
    const status = await startRuntime(lifecycleRoot(command.root, deps));
    io.out(`Laya server running on http://127.0.0.1:${String(status.metadata?.port ?? 8000)} (PID ${String(status.metadata?.pid ?? 'unknown')})`);
    return CLI_EXIT_CODES.complete;
  } catch (cause) { io.err(`layagrep: start failed: ${cause instanceof Error ? cause.message : 'unknown failure'}`); return CLI_EXIT_CODES.error; }
}

async function runStop(command: Extract<CliCommand, { kind: 'stop' }>, io: CliIo, deps: CommandDependencies): Promise<number> {
  try { await stopRuntime(lifecycleRoot(command.root, deps)); io.out('Laya server stopped'); return CLI_EXIT_CODES.complete; }
  catch (cause) { io.err(`layagrep: stop failed: ${cause instanceof Error ? cause.message : 'unknown failure'}`); return CLI_EXIT_CODES.error; }
}

async function runRestart(command: Extract<CliCommand, { kind: 'restart' }>, io: CliIo, deps: CommandDependencies): Promise<number> {
  const root = lifecycleRoot(command.root, deps);
  try {
    await stopRuntime(root);
    const status = await startRuntime(root);
    io.out(`Laya server restarted on http://127.0.0.1:${String(status.metadata?.port ?? 8000)} (PID ${String(status.metadata?.pid ?? 'unknown')})`);
    return CLI_EXIT_CODES.complete;
  } catch (cause) { io.err(`layagrep: restart failed: ${cause instanceof Error ? cause.message : 'unknown failure'}`); return CLI_EXIT_CODES.error; }
}

async function runStatus(command: Extract<CliCommand, { kind: 'status' }>, io: CliIo, deps: CommandDependencies): Promise<number> {
  try {
    const status = await runtimeStatus(lifecycleRoot(command.root, deps));
    if (command.json) io.out(JSON.stringify({ state: status.state, root: status.paths.root, ...(status.metadata ?? {}), ...(status.detail === undefined ? {} : { detail: status.detail }) }));
    else io.out(`Laya server: ${status.state}${status.metadata === undefined ? '' : ` (PID ${String(status.metadata.pid)}, port ${String(status.metadata.port)})`}${status.detail === undefined ? '' : ` — ${status.detail}`}`);
    return status.state === 'stale' ? CLI_EXIT_CODES.error : CLI_EXIT_CODES.complete;
  } catch (cause) { io.err(`layagrep: status failed: ${cause instanceof Error ? cause.message : 'unknown failure'}`); return CLI_EXIT_CODES.error; }
}

async function runLogs(command: Extract<CliCommand, { kind: 'logs' }>, io: CliIo, deps: CommandDependencies): Promise<number> {
  const root = lifecycleRoot(command.root, deps);
  const initial = readRuntimeLog(root, command.lines);
  if (initial.length > 0) io.out(initial);
  if (!command.follow) return CLI_EXIT_CODES.complete;
  let previous = initial;
  while (deps.signal?.aborted !== true) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    const current = readRuntimeLog(root, command.lines);
    if (current !== previous) { io.out(current.startsWith(previous) ? current.slice(previous.length).trimStart() : current); previous = current; }
  }
  return CLI_EXIT_CODES.interrupted;
}

async function runDoctor(command: Extract<CliCommand, { kind: 'doctor' }>, io: CliIo, deps: CommandDependencies): Promise<number> {
  const loaded = load(command, io, deps);
  if (typeof loaded === 'number') {
    return loaded;
  }
  const report = doctorReport(loaded, commandEnvironment(loaded, deps), REFERENCE_COUNTER_ID);
  for (const line of renderDoctorReport(report)) {
    io.out(line);
  }
  const runtime = await runtimeStatus(loaded.repositoryRoot);
  const paths = runtimePaths(loaded.repositoryRoot);
  io.out(`platform           ${platformSummary()}`);
  io.out(`runtime directory  ${paths.home}`);
  io.out(`managed uv         ${existsSync(paths.uv) ? 'installed' : 'missing'}`);
  io.out(`managed Python     ${existsSync(paths.python) ? 'installed' : 'missing'}`);
  io.out(`model cache        ${existsSync(paths.hfHome) ? paths.hfHome : 'missing'}`);
  io.out(`Laya server        ${runtime.state}`);
  return CLI_EXIT_CODES.complete;
}

function runInspect(command: Extract<CliCommand, { kind: 'inspect' }>, io: CliIo, deps: CommandDependencies): number {
  const loaded = load(command, io, deps);
  if (typeof loaded === 'number') {
    return loaded;
  }
  try {
    const report = inspectScope(loaded, { scope: command.scope });
    if (command.json) {
      io.out(JSON.stringify(report));
    } else {
      for (const line of renderInspection(report)) {
        io.out(line);
      }
    }
    return CLI_EXIT_CODES.complete;
  } catch (cause) {
    io.err(`layagrep: the scope could not be inspected: ${cause instanceof Error ? cause.message : 'unknown failure'}`);
    return CLI_EXIT_CODES.rejected;
  }
}

async function runSearch(
  command: Extract<CliCommand, { kind: 'search' }>,
  io: CliIo,
  deps: CommandDependencies,
): Promise<number> {
  const loaded = load(command, io, deps);
  if (typeof loaded === 'number') {
    return loaded;
  }

  const engine = engineFor(loaded, deps);
  const { outcome, measuredTokens } = await engine.search(command.request, {
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  });

  if (command.json) {
    try {
      const response = toCliSearchResponse(outcome, referenceCounter);
      io.out(response.stdout);
      if (measuredTokens !== null) {
        io.err(`layagrep: response measured at ${String(measuredTokens)} ${REFERENCE_COUNTER_ID} tokens of ${String(command.request.max_context_tokens ?? loaded.config.search.default_response_tokens)}`);
      }
      return response.exitCode;
    } catch (cause) {
      // A payload that does not satisfy its own contract is a defect, not a result.
      io.err(`layagrep: the produced response failed contract validation: ${cause instanceof Error ? cause.message : 'unknown failure'}`);
      io.out(JSON.stringify(createSearchError('RESOURCE_EXHAUSTED', 'invalid-response')));
      return CLI_EXIT_CODES.error;
    }
  }

  let human;
  try {
    human = renderHumanOutcome(outcome, referenceCounter);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    io.out('layagrep: rejected\nerror: RESPONSE_BUDGET_TOO_SMALL\nIncrease the human response budget or narrow the scope.');
    return CLI_EXIT_CODES.rejected;
  }
  io.out(human.text);
  io.err(`layagrep: human rendering measured at ${String(human.tokenCount)} ${human.counter} tokens, `
    + `${String(human.byteCount)} bytes, ${String(human.excerptCount)} excerpt(s); `
    + `human and --json payloads are budgeted separately`);
  const cancelled = 'error' in outcome
    ? outcome.error.code === 'CANCELLED'
    : outcome.report.stop_reasons.includes('CANCELLED');
  return cancelled ? CLI_EXIT_CODES.interrupted : CLI_EXIT_CODES[outcome.status];
}

function runCacheClear(
  command: Extract<CliCommand, { kind: 'cache-clear' }>,
  io: CliIo,
  deps: CommandDependencies,
): number {
  const loaded = load(command, io, deps);
  if (typeof loaded === 'number') {
    return loaded;
  }
  const cache = new ScoreCache({
    directory: loaded.cacheDirectory,
    enabled: true,
    ttlSeconds: loaded.config.cache.ttl_seconds,
    maxBytes: loaded.config.cache.max_bytes,
  });
  const removed = cache.clear();
  if (cache.stats.failures > 0) {
    io.err('layagrep: the configured cache could not be completely cleared; check local access or an active writer');
    return CLI_EXIT_CODES.error;
  }
  io.out(`removed ${String(removed)} cached evaluation(s) from ${loaded.cacheDirectory}`);
  io.err('layagrep: only the cache configured by this configuration was cleared; no repository file was written');
  return CLI_EXIT_CODES.complete;
}

async function runMcp(
  command: Extract<CliCommand, { kind: 'mcp' }>,
  io: CliIo,
  deps: CommandDependencies,
): Promise<number> {
  const loaded = load(command, io, deps);
  if (typeof loaded === 'number') {
    return loaded;
  }
  const engine = engineFor(loaded, deps);
  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const errorOutput = deps.errorOutput ?? process.stderr;
  errorOutput.write(`layagrep: mcp server ready for ${loaded.repositoryRoot} (no scan, no provider call at startup)\n`);

  await runMcpServer({
    engine, input, output, errorOutput,
    serverVersion: deps.serverVersion ?? readVersionQuietly(),
  });
  void io;
  return CLI_EXIT_CODES.complete;
}

function readVersionQuietly(): string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const version = (manifest as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
