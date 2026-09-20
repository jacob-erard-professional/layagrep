# LayaGrep install guide

Install Node.js 24 and npm, then install the command:

```bash
npm install --global @nassim-arifette/layagrep
```

The command is identical on Arch, Debian/Ubuntu, Fedora, macOS, and Windows:

```bash
cd /path/to/repository
layagrep setup
layagrep start
layagrep doctor
```

`layagrep setup` downloads a repository-private `uv`, managed Python 3.11, the locked
Laya dependency graph, and `convaiinnovations/laya`. All generated files live under
`.layagrep/`. No system Python, system `uv`, daemon manager, or sibling `local-ai`
checkout is required.

Useful operations:

```bash
layagrep status
layagrep logs --lines 200
layagrep logs --follow
layagrep restart
layagrep stop
```

If port 8000 is already in use, select another port during setup:

```bash
layagrep setup --port 8123
```

Run `layagrep setup` again to repair or update the pinned runtime. It preserves search
settings already present in `.layagrep/config.json`, while restoring bundled runtime
files and ensuring the selected port is current.

## Credits

LayaGrep uses the Apache-2.0-licensed
[Laya model by Convai Innovations](https://huggingface.co/convaiinnovations/laya) and
continues the MIT-licensed
[original JevGrep project by Nassim Arifette](https://github.com/nassim-arifette/jevgrep).
See [`ATTRIBUTION.md`](../ATTRIBUTION.md) for details.
