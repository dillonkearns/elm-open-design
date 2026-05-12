import type { Express, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface RegisterElmRoutesDeps {
  runtimeDataDir: string;
}

const ELM_JSON_CONTENT = JSON.stringify(
  {
    type: 'application',
    'source-directories': ['src'],
    'elm-version': '0.19.1',
    dependencies: {
      direct: {
        'elm/browser': '1.0.2',
        'elm/core': '1.0.5',
        'elm/html': '1.0.0',
        'elm/json': '1.1.3',
        'elm/svg': '1.0.1',
      },
      indirect: {
        'elm/time': '1.0.0',
        'elm/url': '1.0.0',
        'elm/virtual-dom': '1.0.3',
      },
    },
    'test-dependencies': { direct: {}, indirect: {} },
  },
  null,
  2,
);

interface CompileSuccess {
  ok: true;
  js: string;
}

interface CompileFailure {
  ok: false;
  errors: unknown;
  raw?: string;
}

type CompileResult = CompileSuccess | CompileFailure;

// In-memory cache keyed by sha256 of source. Lives for daemon lifetime; capped
// so a runaway agent can't blow up RSS by emitting endless distinct artifacts.
const CACHE_MAX = 64;
const cache = new Map<string, CompileResult>();

// Serializes elm-make invocations. The shared workdir's src/Main.elm is the
// load-bearing file `elm make` reads, so two parallel POSTs would race on the
// write/read pair and one (or both) would see a mangled source. A simple
// promise-chain mutex is enough — compiles are fast (~100ms after warmup) and
// the cache already absorbs identical-source repeats.
let compileQueue: Promise<unknown> = Promise.resolve();
function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const next = compileQueue.then(task, task);
  // Don't let one rejection poison the queue for every later compile.
  compileQueue = next.catch(() => undefined);
  return next;
}

function rememberCacheEntry(key: string, value: CompileResult) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function ensureWorkdir(workdir: string): Promise<void> {
  await fs.mkdir(path.join(workdir, 'src'), { recursive: true });
  const elmJsonPath = path.join(workdir, 'elm.json');
  let needsWrite = true;
  try {
    const existing = await fs.readFile(elmJsonPath, 'utf8');
    if (existing === ELM_JSON_CONTENT) needsWrite = false;
  } catch {
    /* file missing */
  }
  if (needsWrite) await fs.writeFile(elmJsonPath, ELM_JSON_CONTENT);
}

interface ElmMakeOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runElmMake(workdir: string): Promise<ElmMakeOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn('elm', ['make', 'src/Main.elm', '--output=Main.js', '--report=json'], {
      cwd: workdir,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function compileElm(workdir: string, source: string): Promise<CompileResult> {
  await ensureWorkdir(workdir);
  await fs.writeFile(path.join(workdir, 'src', 'Main.elm'), source);
  // Wipe stale output so a failed compile cannot return last run's JS.
  const outputPath = path.join(workdir, 'Main.js');
  await fs.rm(outputPath, { force: true });

  const result = await runElmMake(workdir);

  if (result.exitCode === 0) {
    const js = await fs.readFile(outputPath, 'utf8');
    return { ok: true, js };
  }

  // elm make --report=json writes JSON diagnostics to stderr.
  const rawErrors = result.stderr.trim() || result.stdout.trim();
  let parsed: unknown = rawErrors;
  try {
    parsed = JSON.parse(rawErrors);
  } catch {
    /* leave as raw string */
  }
  return { ok: false, errors: parsed, raw: rawErrors };
}

export function registerElmRoutes(app: Express, deps: RegisterElmRoutesDeps): void {
  const workdir = path.join(deps.runtimeDataDir, 'elm-runtime');

  app.post('/api/elm/compile', async (req: Request, res: Response) => {
    const source = typeof req.body?.source === 'string' ? req.body.source : null;
    if (!source) {
      res.status(400).json({ ok: false, error: 'source must be a string' });
      return;
    }
    const key = crypto.createHash('sha256').update(source).digest('hex');
    const cached = cache.get(key);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const result = await runSerialized(() => compileElm(workdir, source));
      rememberCacheEntry(key, result);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: `elm compile failed: ${message}` });
    }
  });
}
