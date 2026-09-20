import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedOptionsFor } from '../src/cli-args.ts';
import { commandHelp, globalHelp, documentedCommands } from '../src/cli-help.ts';

/**
 * LG-023 help surface. The help must describe exactly what the parser accepts: a command
 * help that advertises an option the parser refuses, or hides one it accepts, is a defect.
 * The same rule as LG-001 applies: nothing is presented as available that cannot run.
 */
test('every documented command has a help page', () => {
  assert.deepEqual([...documentedCommands()].sort(), ['cache clear', 'doctor', 'inspect', 'logs', 'mcp', 'restart', 'search', 'setup', 'start', 'status', 'stop']);
  for (const command of documentedCommands()) {
    const help = commandHelp(command);
    assert.ok(help !== undefined, `${command} has no help`);
    assert.match(help, new RegExp(command.split(' ')[0] ?? '', 'i'));
    assert.match(help, /exit codes/i, `${command}: the page must state the exit-code contract`);
  }
  assert.equal(commandHelp('frobnicate'), undefined);
});

test('the help of a command lists exactly the options the parser accepts', () => {
  for (const command of documentedCommands()) {
    const help = commandHelp(command);
    assert.ok(help !== undefined);
    const accepted = allowedOptionsFor(command);
    assert.ok(accepted !== undefined, `${command} has no option list`);

    const advertised = [...help.matchAll(/--[a-z-]+/g)].map((match) => match[0]);
    const unique = [...new Set(advertised)].filter((option) => option !== '--help');
    for (const option of unique) {
      assert.ok(accepted.includes(option), `${command} advertises '${option}' but the parser refuses it`);
    }
    for (const option of accepted) {
      assert.ok(unique.includes(option), `${command} accepts '${option}' but does not document it`);
    }
  }
});

test('the usage line shows the real choice of query sources', () => {
  const help = commandHelp('search');
  assert.ok(help !== undefined);
  const usage = help.split('\n')[0] ?? '';
  assert.match(usage, /\(--query <text> \| --query-file <path>\)/);
  assert.match(usage, /\[--scope <path>\]\.\.\./);
});

test('the search help documents the response budget bounds and the query sources', () => {
  const help = commandHelp('search');
  assert.ok(help !== undefined);
  assert.match(help, /--query-file/);
  assert.match(help, /--allow-partial/);
  assert.match(help, /--max-context-tokens/);
  assert.match(help, /1[ ,]?024/);
});

test('the global help lists every command and the whole exit-code contract', () => {
  const help = globalHelp();
  assert.match(help, /^usage: layagrep/);
  assert.doesNotMatch(help, /not implemented/i, 'the commands exist, so no page may claim otherwise');
  for (const command of documentedCommands()) {
    const listing = new RegExp(`^ {2}${command}$`, 'm').exec(help);
    assert.notEqual(listing, null, `${command} is not listed as a command`);
  }
  for (const code of ['0', '2', '3', '4', '130']) {
    assert.match(help, new RegExp(`^ {2}${code}\\s`, 'm'), `exit code ${code} is missing`);
  }
  assert.match(help, /local|repository/i, 'the local runtime boundary must be stated');
});

test('the help distinguishes local MCP startup from remote search tool calls', () => {
  const mcp = commandHelp('mcp');
  assert.ok(mcp !== undefined);
  assert.match(mcp, /source excerpts are sent only to the configured loopback Laya server/i);

  const doctor = commandHelp('doctor');
  assert.ok(doctor !== undefined);
  assert.match(doctor, /runtime and cache operations stay inside/i);
  assert.match(globalHelp(), /complete runtime under \.layagrep/i);
});
