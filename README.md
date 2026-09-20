# LayaGrep

**Find code by what it does, entirely on your machine.** LayaGrep scans a repository,
uses [convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya) to score
source fragments, and returns the original excerpts with paths and line numbers. It
includes a CLI and a stdio MCP server.

## Supported systems

- macOS 13+ on Apple Silicon or Intel
- Windows 10 / Windows Server 2016 or newer on x64
- Linux on x64 or ARM64, including Arch, Debian/Ubuntu, and Fedora

Node.js 24 and npm are the only host prerequisites. LayaGrep installs its own pinned
`uv`, Python 3.11 environment, Python dependencies, server, model cache, logs, PID
metadata, score cache, and configuration under the target repository's `.layagrep/`
directory. Nothing from `~/Documents/projects/local-ai` is needed at runtime.

## Install

From a published package:

```bash
npm install --global @nassim-arifette/layagrep
```

From this checkout:

```bash
npm ci
npm run verify
npm link
```

Then run the same commands on every supported OS (PowerShell, cmd, bash, and zsh):

```bash
cd /path/to/project
layagrep setup
layagrep start
layagrep doctor
layagrep search --query "Where is session expiry handled?"
```

`setup` is idempotent. It downloads the pinned Python environment and the Laya model;
the first run therefore needs internet access and several gigabytes of free disk. The
server listens only on `127.0.0.1` and is not started until `layagrep start`.

Use another loopback port when 8000 is occupied:

```bash
layagrep setup --port 8123
```

## Runtime commands

```text
layagrep setup [--root PATH] [--port PORT]
layagrep start [--root PATH]
layagrep stop [--root PATH]
layagrep restart [--root PATH]
layagrep status [--root PATH] [--json]
layagrep logs [--root PATH] [--lines N] [--follow]
layagrep doctor [--config PATH]
```

Lifecycle commands discover `.layagrep/config.json` by walking up from the current
directory. `--root` is useful from outside the project. `doctor` reports the platform,
managed tools, cache path, configuration, and live server health.

Search and maintenance commands:

```bash
layagrep inspect
layagrep search --query "How are permissions checked?" --scope src --scope tests
layagrep search --query "Where is the cache invalidated?" --json
layagrep search --query-file question.txt
layagrep cache clear
```

`.gitignore` and `.layagrepignore` are respected. `.layagrep/` contains its own
`.gitignore`, so the downloaded runtime and model do not pollute repository status.

## Harness tools

### Pi CLI

LayaGrep ships a native Pi extension that registers a read-only `layagrep` tool. Install
it for the current project after running `setup` and `start`:

```bash
layagrep harness install pi
layagrep harness status pi
pi
```

In Pi, ask the agent to use `layagrep` for a behavior-oriented query such as “find where
runtime processes are stopped.” The tool accepts `query`, optional repository-relative
`path`, optional `max_context_tokens`, and optional `allow_partial`. Restart Pi after
installation, or run `/reload` in an existing session.

Install the tool for every Pi project instead:

```bash
layagrep harness install pi --global
layagrep harness status pi --global
```

Remove either managed installation with `layagrep harness uninstall pi` or
`layagrep harness uninstall pi --global`. Project installation writes only
`.pi/extensions/layagrep.ts`; global installation writes only
`$PI_CODING_AGENT_DIR/extensions/layagrep.ts` or, when that variable is unset,
`~/.pi/agent/extensions/layagrep.ts`. The installer refuses to overwrite or remove a
same-named file it does not recognize as LayaGrep-managed.

To test the versioned extension without installing it:

```bash
pi --extension ./integrations/pi/layagrep.ts
```

Set `LAYAGREP_BIN` to an absolute executable path when `layagrep` is not on the harness
process's `PATH`.

### MCP and other harnesses

LayaGrep exposes `semantic_search_code` over stdio. After `setup` and `start`:

```toml
[mcp_servers.layagrep]
command = "layagrep"
args = ["mcp"]
tool_timeout_sec = 360
```

Start the MCP process from the repository root, or pass
`--config /absolute/repo/.layagrep/config.json`.

For any harness with MCP support, register `layagrep` as the command and `mcp` as its
single argument, set the working directory to the repository root, and allow at least
360 seconds per call. Harnesses without Pi-extension or MCP support can invoke
`layagrep search --query "..." --json`; exit code 0 is complete evidence and exit code
3 is usable partial evidence.

## Architecture and limits

The bundled Python server exposes `GET /health` and `POST /v1/decisions` on loopback.
LayaGrep sends one source fragment per decision request because the English checkpoint
has a 512-token context with roughly 320 tokens available for state after the decision
head's budget.

Laya's published model card recommends evaluating the checkpoint on your own
distribution before using it for full automation. A code-relevance evaluation set,
fine-tuning, and calibration remain necessary before relying on ranking quality in
production.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run smoke
```

The normal test suite is offline and does not download model weights.

## Attribution

LayaGrep is powered by the
[Laya model from Convai Innovations](https://huggingface.co/convaiinnovations/laya),
released under the Apache 2.0 license.

This project is a continuation of the original
[JevGrep repository by Nassim Arifette](https://github.com/nassim-arifette/jevgrep).
Its repository-scanning architecture, safety contracts, CLI/MCP foundations, MIT
license notice, and complete commit history are retained. This continuation moves
inference to locally hosted Laya and adds the self-contained cross-platform runtime.

See [ATTRIBUTION.md](ATTRIBUTION.md) for the full project and model credits.
