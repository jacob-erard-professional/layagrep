import { basename, dirname, join, resolve } from 'node:path';

import { LocalDirectory, isMissing } from './local-directory.ts';
import { AuthorizedRoot } from './source/authorization.ts';

function readOptional(storage: LocalDirectory, name: string, limit: number): string | undefined {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(storage.read(name, limit)); }
  catch (cause) {
    if (isMissing(cause)) return undefined;
    throw new Error(`cannot read local settings at ${join(storage.path, name)}`);
  }
}

/** Find the nearest repository-local LayaGrep configuration. */
export function discoverProjectConfiguration(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  void env;
  let candidate = AuthorizedRoot.open(resolve(cwd)).path;
  for (;;) {
    const path = join(candidate, '.layagrep', 'config.json');
    try {
      if (readOptional(new LocalDirectory(dirname(path)), basename(path), 1_048_576) !== undefined) return path;
    } catch { /* An inaccessible ancestor is not a configured project. */ }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`no LayaGrep runtime is configured for ${resolve(cwd)}; run 'layagrep setup' in the repository first`);
}
