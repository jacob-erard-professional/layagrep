/** Help generated from the same command option table the parser enforces. */
import { allowedOptionsFor } from './cli-args.ts';

const COMMAND_SUMMARY: Record<string, string> = {
  setup: 'Install uv, Python, Laya, the model cache, server and configuration inside this repository.',
  start: 'Start the repository-local Laya server in the background.',
  stop: 'Stop the repository-local Laya server.',
  restart: 'Restart the repository-local Laya server.',
  status: 'Report whether the repository-local Laya server is healthy.',
  logs: 'Print the repository-local Laya server log.',
  doctor: 'Validate the configuration, managed runtime, model cache and server health.',
  inspect: 'Report eligible scope, exclusions and estimated work without running inference.',
  search: 'Return original excerpts that answer a behavior question, inside the response budget.',
  mcp: 'Serve semantic_search_code over MCP stdio (one repository per process).',
  'harness install pi': 'Install the LayaGrep tool into Pi for this project or globally.',
  'harness status pi': 'Report whether the LayaGrep Pi tool is installed.',
  'harness uninstall pi': 'Remove the managed LayaGrep tool from Pi.',
  'cache clear': 'Remove recognized evaluations from the repository-local score cache.',
};

const OPTION_TEXT: Record<string, string> = {
  '--root': '--root <path>              repository root (default: current project)',
  '--port': '--port <number>            loopback server port (default: 8000)',
  '--lines': '--lines <number>           trailing log lines (default: 200)',
  '--follow': '--follow                   continue streaming new log output',
  '--config': '--config <path>            override .layagrep/config.json discovery',
  '--query': '--query <text>             search question, kept verbatim',
  '--query-file': '--query-file <path>        read a multiline question from a file',
  '--scope': '--scope <relative path>    repeatable; default "."',
  '--max-context-tokens': '--max-context-tokens <n>   response budget (min 1,024)',
  '--allow-partial': '--allow-partial            permit an explicitly partial scan',
  '--json': '--json                     machine-readable JSON output',
  '--global': '--global                   use Pi\'s global extension directory',
};

const COMMAND_USAGE: Record<string, string> = {
  setup: 'layagrep setup [--root <path>] [--port <number>]',
  start: 'layagrep start [--root <path>]',
  stop: 'layagrep stop [--root <path>]',
  restart: 'layagrep restart [--root <path>]',
  status: 'layagrep status [--root <path>] [--json]',
  logs: 'layagrep logs [--root <path>] [--lines <number>] [--follow]',
  search: 'layagrep search [--config <path>] (--query <text> | --query-file <path>) [--scope <path>]... [--max-context-tokens <n>] [--json] [--allow-partial]',
  inspect: 'layagrep inspect [--config <path>] [--scope <path>]... [--json]',
  doctor: 'layagrep doctor [--config <path>]',
  mcp: 'layagrep mcp [--config <path>]',
  'harness install pi': 'layagrep harness install pi [--root <path> | --global]',
  'harness status pi': 'layagrep harness status pi [--root <path> | --global]',
  'harness uninstall pi': 'layagrep harness uninstall pi [--root <path> | --global]',
  'cache clear': 'layagrep cache clear [--config <path>]',
};

export function documentedCommands(): readonly string[] {
  return ['setup', 'start', 'stop', 'restart', 'status', 'logs', 'search', 'inspect', 'doctor', 'mcp', 'harness install pi', 'harness status pi', 'harness uninstall pi', 'cache clear'];
}

export function commandHelp(command: string): string | undefined {
  if (!documentedCommands().includes(command)) return undefined;
  const options = allowedOptionsFor(command) ?? [];
  const lines = [`usage: ${COMMAND_USAGE[command] ?? `layagrep ${command}`}`, '', COMMAND_SUMMARY[command] ?? '', '', 'options:'];
  for (const option of options) lines.push(`  ${OPTION_TEXT[option] ?? option}`);
  lines.push('  -h, --help                 show this page and exit 0', '');
  if (command === 'setup') lines.push('setup downloads the pinned runtime and model into .layagrep/; it does not start the server.');
  else if (command === 'search' || command === 'mcp') lines.push('source excerpts are sent only to the configured loopback Laya server.');
  else if (command.startsWith('harness ')) lines.push('project installs use .pi/extensions; --global uses PI_CODING_AGENT_DIR or ~/.pi/agent/extensions.');
  else lines.push("runtime and cache operations stay inside this repository's .layagrep/ directory.");
  lines.push('', 'exit codes: 0 complete, 2 rejected, 3 partial, 4 runtime failure, 130 interrupted.');
  return lines.join('\n');
}

export function globalHelp(): string {
  const lines = [
    'usage: layagrep --help | --version | <command> [options]', '',
    'Local semantic code search powered by convaiinnovations/laya.',
    'Each repository owns its complete runtime under .layagrep/.', '',
    'options:',
    '  -h, --help      show this help and exit 0',
    '  -V, --version   show the package version and exit 0', '',
    'commands:',
  ];
  for (const command of documentedCommands()) lines.push(`  ${command}`);
  lines.push('', "run 'layagrep <command> --help' for command options", '',
    'quick start: layagrep setup && layagrep start && layagrep doctor', '',
    'exit codes:',
    '  0    complete result',
    '  2    rejected request or configuration',
    '  3    partial result',
    '  4    fatal runtime failure',
    '  130  user interruption', '',
    'documentation: README.md, docs/install-guide.md');
  return lines.join('\n');
}
