// `od elm check <drafts-dir> <entry-file>` — compile a set of draft `.elm`
// files against the active project's existing siblings, without persisting
// the drafts. Exit 0 on success, 1 on compile errors (rendered to stderr in
// the same shape elm make uses). Used by the agent inside SKILL.md to
// pre-validate Elm artifacts before emitting them.

import fs from 'node:fs';
import path from 'node:path';

interface ElmMessagePart {
  string?: string;
  bold?: boolean;
  underline?: boolean;
  color?: string | null;
}

interface ElmProblem {
  title?: string;
  region?: { start?: { line?: number; column?: number } };
  message?: Array<string | ElmMessagePart>;
}

interface ElmFileErrors {
  path?: string;
  name?: string;
  problems?: ElmProblem[];
}

interface ElmCompileErrorsBody {
  type?: string;
  title?: string;
  path?: string;
  message?: Array<string | ElmMessagePart>;
  errors?: ElmFileErrors[];
}

interface CompileResponse {
  ok?: boolean;
  js?: string;
  errors?: ElmCompileErrorsBody | string;
  raw?: string;
  error?: string;
}

function printHelp(): void {
  console.log(`Usage:
  od elm check <drafts-dir> <entry-file>

Validate one or more draft Elm artifacts against the active project. The
daemon stages every .elm file in the project, overlays the drafts in the
given directory, then compiles <entry-file>. Imports across draft files
type-check the same way they will once the artifacts are persisted.

Arguments:
  <drafts-dir>   Directory containing draft .elm files (e.g. .scratch/elm-check).
  <entry-file>   The draft file to compile as the entry (e.g. dashboard.elm).
                 Must exist inside <drafts-dir>.

Environment:
  OD_DAEMON_URL  Base URL of the running daemon (e.g. http://127.0.0.1:64971).
  OD_PROJECT_ID  Active project id (the agent runtime injects this).

Exit codes:
  0  Drafts compile cleanly.
  1  Compile error (structured diagnostics printed to stderr).
  2  Usage error or daemon unreachable.`);
}

function renderMessageParts(parts: Array<string | ElmMessagePart> | undefined): string {
  if (!parts) return '';
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      return part.string ?? '';
    })
    .join('');
}

function renderCompileErrors(body: ElmCompileErrorsBody | string | undefined): string {
  if (!body) return '(no diagnostics)';
  if (typeof body === 'string') return body;
  if (body.type === 'compile-errors' && Array.isArray(body.errors)) {
    return body.errors
      .map((file) => {
        const path = String(file.path ?? file.name ?? 'unknown');
        const problems = file.problems ?? [];
        return problems
          .map((p) => {
            const title = String(p.title ?? 'PROBLEM');
            const region = p.region;
            const where = region?.start
              ? `${path}:${region.start.line}:${region.start.column}`
              : path;
            const body = renderMessageParts(p.message);
            return `-- ${title} ---------- ${where}\n\n${body}`;
          })
          .join('\n\n');
      })
      .join('\n\n');
  }
  if (body.type === 'error') {
    const title = String(body.title ?? 'ERROR');
    const where = String(body.path ?? '');
    const body2 = renderMessageParts(body.message);
    return `-- ${title} ---------- ${where}\n\n${body2}`;
  }
  return JSON.stringify(body, null, 2);
}

export async function runElmCli(args: string[]): Promise<{ exitCode: number }> {
  const sub = args[0];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    printHelp();
    return { exitCode: sub === 'help' || sub === '--help' || sub === '-h' ? 0 : 2 };
  }
  if (sub !== 'check') {
    process.stderr.write(`unknown subcommand: od elm ${sub}\n`);
    printHelp();
    return { exitCode: 2 };
  }

  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const draftsDir = positional[0];
  const entryFile = positional[1];

  if (!draftsDir || !entryFile) {
    process.stderr.write('error: missing <drafts-dir> or <entry-file>\n\n');
    printHelp();
    return { exitCode: 2 };
  }

  const daemonUrl = (process.env.OD_DAEMON_URL || '').replace(/\/$/, '');
  if (!daemonUrl) {
    process.stderr.write('error: OD_DAEMON_URL not set in environment\n');
    return { exitCode: 2 };
  }
  const projectId = process.env.OD_PROJECT_ID;
  if (!projectId) {
    process.stderr.write('error: OD_PROJECT_ID not set in environment\n');
    return { exitCode: 2 };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(draftsDir, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: cannot read drafts dir "${draftsDir}": ${message}\n`);
    return { exitCode: 2 };
  }

  const drafts: Array<{ fileName: string; source: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.elm')) continue;
    const filePath = path.join(draftsDir, entry.name);
    const source = fs.readFileSync(filePath, 'utf8');
    drafts.push({ fileName: entry.name, source });
  }

  if (!drafts.some((d) => d.fileName === entryFile)) {
    process.stderr.write(`error: entry "${entryFile}" not found in "${draftsDir}"\n`);
    return { exitCode: 2 };
  }

  let response: Response;
  try {
    response = await fetch(`${daemonUrl}/api/elm/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, fileName: entryFile, drafts }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: could not reach daemon at ${daemonUrl}: ${message}\n`);
    return { exitCode: 2 };
  }

  let body: CompileResponse;
  try {
    body = (await response.json()) as CompileResponse;
  } catch {
    process.stderr.write(`error: daemon returned non-JSON response (status ${response.status})\n`);
    return { exitCode: 2 };
  }

  if (body.ok && typeof body.js === 'string') {
    process.stdout.write(`ok — ${entryFile} compiles (${body.js.length} bytes JS)\n`);
    return { exitCode: 0 };
  }

  // Non-2xx responses (bad projectId, malformed body, etc.) come back as
  // { ok: false, error: "..." } with no structured `errors` field. Surface
  // that string before falling back to the elm-make diagnostics renderer so
  // the user actually sees what went wrong.
  if (typeof body.error === 'string' && body.error.length > 0) {
    process.stderr.write(`elm check (status ${response.status}): ${body.error}\n`);
    return { exitCode: response.status >= 200 && response.status < 300 ? 1 : 2 };
  }

  process.stderr.write(`compile failed for ${entryFile}:\n\n`);
  process.stderr.write(renderCompileErrors(body.errors));
  process.stderr.write('\n');
  return { exitCode: 1 };
}
