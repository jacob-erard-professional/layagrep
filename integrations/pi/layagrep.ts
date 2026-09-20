/**
 * LayaGrep tool for Pi.
 *
 * Install with `layagrep harness install pi` or test directly with
 * `pi --extension ./integrations/pi/layagrep.ts`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Managed by LayaGrep. The installer uses this marker to avoid overwriting an
// unrelated extension that happens to have the same file name.
const Parameters = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description: "A behavior, responsibility, or concept to find in the codebase.",
    }),
    path: Type.Optional(Type.String({
      minLength: 1,
      description: "Repository-relative file or directory to search. Defaults to the entire repository.",
    })),
    max_context_tokens: Type.Optional(Type.Integer({
      minimum: 1024,
      description: "Maximum reference-token budget for returned evidence.",
    })),
    allow_partial: Type.Optional(Type.Boolean({
      description: "Allow a deterministic partial scan when an operator scan cap is exceeded.",
    })),
  },
  { additionalProperties: false },
);

type Excerpt = {
  path: string;
  start_line: number;
  end_line: number;
  score: number;
  code: string;
};

type Outcome = {
  status?: string;
  excerpts?: Excerpt[];
  error?: { code?: string; message?: string; retryable?: boolean };
  report?: {
    scope?: string[];
    scope_fully_scanned?: boolean;
    files?: { eligible?: number };
    fragments?: { total?: number | null; cache_reused?: number };
    stop_reasons?: string[];
  };
};

function normalizePath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const normalized = path.startsWith("@") ? path.slice(1) : path;
  return normalized.length === 0 ? undefined : normalized;
}

function parseOutcome(stdout: string): Outcome {
  try {
    return JSON.parse(stdout) as Outcome;
  } catch {
    throw new Error("LayaGrep returned invalid JSON. Run `layagrep doctor` and inspect `layagrep logs`.");
  }
}

function renderOutcome(outcome: Outcome): string {
  if (outcome.error !== undefined) {
    const code = outcome.error.code ?? "SEARCH_FAILED";
    const retry = outcome.error.retryable === true ? " Retry may succeed." : "";
    return `LayaGrep ${code}: ${outcome.error.message ?? "search failed"}${retry}`;
  }

  const excerpts = outcome.excerpts ?? [];
  const coverage = outcome.report?.scope_fully_scanned === true ? "complete coverage" : "partial coverage";
  const fragments = outcome.report?.fragments?.total;
  const cacheReused = outcome.report?.fragments?.cache_reused ?? 0;
  const header = `LayaGrep ${outcome.status ?? "result"}: ${coverage}; ${String(excerpts.length)} excerpt(s); ${fragments === null || fragments === undefined ? "unknown" : String(fragments)} fragment(s); ${String(cacheReused)} cached.`;
  const reasons = outcome.report?.stop_reasons ?? [];
  const warning = reasons.length === 0 ? "" : `\nStop reasons: ${reasons.join(", ")}`;
  if (excerpts.length === 0) {
    return `${header}${warning}\nNo excerpt cleared the configured relevance threshold. This does not prove absence when coverage is partial.`;
  }
  const evidence = excerpts.map((excerpt) =>
    `${excerpt.path}:${String(excerpt.start_line)}-${String(excerpt.end_line)} (score ${excerpt.score.toFixed(2)})\n${excerpt.code}`,
  ).join("\n\n");
  return `${header}${warning}\n\n${evidence}`;
}

export default function layagrepExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "layagrep",
    label: "LayaGrep",
    description: "Semantically grep repository code by behavior, responsibility, or concept when the exact identifier or text is unknown. Returns original source excerpts with paths, lines, relevance scores, and coverage. Use ordinary grep for a known literal, symbol, or regex.",
    promptSnippet: "Semantically grep code by behavior or concept with locally hosted Laya",
    promptGuidelines: [
      "Use layagrep when searching for behavior or responsibility without knowing the exact symbol; use ordinary grep for exact text or regex searches.",
      "Treat an empty layagrep result as evidence only when it reports complete coverage.",
    ],
    parameters: Parameters,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const args = ["search", "--query", params.query, "--json"];
      const path = normalizePath(params.path);
      if (path !== undefined) args.push("--scope", path);
      if (params.max_context_tokens !== undefined) {
        args.push("--max-context-tokens", String(params.max_context_tokens));
      }
      if (params.allow_partial === true) args.push("--allow-partial");

      onUpdate?.({
        content: [{ type: "text", text: "LayaGrep is scoring repository fragments…" }],
        details: { query: params.query, path: path ?? "." },
      });

      const command = process.env.LAYAGREP_BIN?.trim() || "layagrep";
      let result: Awaited<ReturnType<typeof pi.exec>>;
      try {
        result = await pi.exec(command, args, { cwd: ctx.cwd, signal, timeout: 310_000 });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Could not run LayaGrep (${message}). Install/link the CLI, then run \`layagrep setup && layagrep start\` in this repository.`);
      }

      if (signal?.aborted || result.code === 130) throw new Error("LayaGrep search was cancelled.");
      const outcome = parseOutcome(result.stdout);
      const text = renderOutcome(outcome);
      if (result.code !== 0 && result.code !== 3) {
        throw new Error(text);
      }
      return {
        content: [{ type: "text", text }],
        details: {
          status: outcome.status ?? "unknown",
          query: params.query,
          path: path ?? ".",
          excerpts: outcome.excerpts?.length ?? 0,
          complete: outcome.report?.scope_fully_scanned === true,
        },
      };
    },
  });
}
