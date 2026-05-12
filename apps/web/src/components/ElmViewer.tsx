import { useEffect, useMemo, useState, Fragment } from 'react';
import { fetchProjectFileText } from '../providers/registry';
import type { ProjectFile } from '../types';

type TokenKind = 'comment' | 'string' | 'keyword' | 'type' | 'number' | 'plain';
interface Token {
  kind: TokenKind;
  text: string;
}

const ELM_KEYWORDS = new Set([
  'module',
  'exposing',
  'import',
  'as',
  'type',
  'alias',
  'port',
  'where',
  'let',
  'in',
  'if',
  'then',
  'else',
  'case',
  'of',
  'infix',
  'infixl',
  'infixr',
]);

// Palenight-ish palette tuned for the #0b1020 background.
const TOKEN_COLOR: Record<TokenKind, string> = {
  comment: '#7f8ea3',
  string: '#a3d977',
  keyword: '#c792ea',
  type: '#ffcb6b',
  number: '#f78c6c',
  plain: '#cbd5e1',
};

// Single-pass tokenizer. Elm syntax is simple enough that a handful of branches
// cover the visible structure (keywords, capitalised type/constructor names,
// strings, numbers, line + block comments). Anything unrecognised is emitted
// as `plain` so operators and whitespace pass through unchanged.
function tokenizeElm(src: string): Token[] {
  const tokens: Token[] = [];
  let pending = '';
  const flush = () => {
    if (pending) {
      tokens.push({ kind: 'plain', text: pending });
      pending = '';
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (src.startsWith('--', i)) {
      flush();
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      tokens.push({ kind: 'comment', text: src.slice(i, end) });
      i = end;
      continue;
    }
    if (src.startsWith('{-', i)) {
      flush();
      const closeIdx = src.indexOf('-}', i + 2);
      const end = closeIdx === -1 ? src.length : closeIdx + 2;
      tokens.push({ kind: 'comment', text: src.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === '"') {
      flush();
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) j += 2;
        else j += 1;
      }
      const end = Math.min(j + 1, src.length);
      tokens.push({ kind: 'string', text: src.slice(i, end) });
      i = end;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      flush();
      let j = i;
      while (j < src.length) {
        const c = src[j] ?? '';
        if ((c >= '0' && c <= '9') || c === '.') j += 1;
        else break;
      }
      tokens.push({ kind: 'number', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      flush();
      let j = i;
      while (j < src.length) {
        const c = src[j] ?? '';
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_') j += 1;
        else break;
      }
      const word = src.slice(i, j);
      let kind: TokenKind = 'plain';
      if (ELM_KEYWORDS.has(word)) kind = 'keyword';
      else if (word[0] && word[0] >= 'A' && word[0] <= 'Z') kind = 'type';
      tokens.push({ kind, text: word });
      i = j;
      continue;
    }
    pending += ch;
    i += 1;
  }
  flush();
  return tokens;
}

function HighlightedElm({ source }: { source: string }) {
  const tokens = useMemo(() => tokenizeElm(source), [source]);
  return (
    <>
      {tokens.map((token, idx) =>
        token.kind === 'plain' ? (
          <Fragment key={idx}>{token.text}</Fragment>
        ) : (
          <span key={idx} style={{ color: TOKEN_COLOR[token.kind] }}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}

type CompileState =
  | { kind: 'loading-source' }
  | { kind: 'compiling' }
  | { kind: 'rendered'; srcDoc: string }
  | { kind: 'error'; raw: string; structured: unknown };

interface ElmCompileResponse {
  ok: boolean;
  js?: string;
  errors?: unknown;
  raw?: string;
  error?: string;
}

const TAILWIND_CDN_URL = 'https://unpkg.com/tailwindcss@2.2.19/dist/tailwind.min.css';

function buildIframeShell(compiledJs: string, title: string): string {
  // Sandboxed iframe: minimal HTML around the compiled Elm program. The
  // compiled Elm bundle defines a global `Elm` object and we mount Main into
  // the #root div. Tailwind v2 ships as a single pre-built stylesheet so
  // utility classes the agent emits resolve without a JIT step.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${TAILWIND_CDN_URL}" crossorigin="anonymous" />
  <style>html, body { margin: 0; padding: 0; background: #fff; }</style>
</head>
<body>
  <div id="root"></div>
  <script>${compiledJs}</script>
  <script>
    try {
      var app = Elm.Main.init({ node: document.getElementById('root') });
    } catch (err) {
      document.getElementById('root').innerHTML =
        '<pre style="padding:24px;color:#b00;font-family:ui-monospace,monospace;white-space:pre-wrap;">' +
        'Elm runtime error: ' + String(err && err.message || err) + '</pre>';
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function ElmViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [state, setState] = useState<CompileState>({ kind: 'loading-source' });
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<'preview' | 'source'>('preview');

  useEffect(() => {
    setSource(null);
    setState({ kind: 'loading-source' });
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name).then((text) => {
      if (!cancelled) setSource(text ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey]);

  useEffect(() => {
    if (source === null) return;
    if (source.trim().length === 0) {
      setState({ kind: 'error', raw: 'Empty Elm source.', structured: null });
      return;
    }
    let cancelled = false;
    setState({ kind: 'compiling' });
    fetch('/api/elm/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    })
      .then(async (resp) => {
        const data = (await resp.json()) as ElmCompileResponse;
        if (cancelled) return;
        if (data.ok && typeof data.js === 'string') {
          setState({
            kind: 'rendered',
            srcDoc: buildIframeShell(data.js, file.name),
          });
        } else {
          setState({
            kind: 'error',
            raw: data.raw || data.error || 'Elm compile failed',
            structured: data.errors ?? null,
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          raw: `Compile request failed: ${err instanceof Error ? err.message : String(err)}`,
          structured: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [source, file.name]);

  const formattedError = useMemo(() => {
    if (state.kind !== 'error') return null;
    return formatElmErrors(state.structured) ?? state.raw;
  }, [state]);

  return (
    <div className="viewer elm-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <button
            type="button"
            className="icon-only"
            onClick={() => setReloadKey((n) => n + 1)}
            title="Reload"
            aria-label="Reload"
          >
            ↻
          </button>
          <span className="viewer-meta">
            Elm · {state.kind === 'rendered'
              ? 'rendered'
              : state.kind === 'compiling'
                ? 'compiling…'
                : state.kind === 'error'
                  ? 'error'
                  : 'loading…'}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <div className="viewer-tabs">
            <button
              type="button"
              className={`viewer-tab ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => setMode('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              className={`viewer-tab ${mode === 'source' ? 'active' : ''}`}
              onClick={() => setMode('source')}
            >
              Source
            </button>
          </div>
        </div>
      </div>
      <div className="viewer-body">
        {mode === 'source' ? (
          <pre
            style={{
              margin: 0,
              padding: '16px',
              overflow: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              lineHeight: 1.55,
              whiteSpace: 'pre',
              background: '#0b1020',
              color: TOKEN_COLOR.plain,
              height: '100%',
            }}
          >
            <HighlightedElm source={source ?? ''} />
          </pre>
        ) : state.kind === 'rendered' ? (
          <iframe
            title={file.name}
            sandbox="allow-scripts"
            srcDoc={state.srcDoc}
            style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
          />
        ) : state.kind === 'error' ? (
          <pre
            style={{
              margin: 0,
              padding: '16px',
              overflow: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              color: '#fecaca',
              background: '#1a0b0b',
              height: '100%',
            }}
          >
            {formattedError ?? ''}
          </pre>
        ) : (
          <div className="viewer-empty">
            {state.kind === 'loading-source' ? 'Loading source…' : 'Compiling Elm…'}
          </div>
        )}
      </div>
    </div>
  );
}

// Format `elm make --report=json` diagnostics into the same shape the elm CLI
// prints. Two shapes come back:
//   { type: 'compile-errors', errors: [{ path, name, problems: [{ title, region, message: [...] }] }] }
//   { type: 'error', path, title, message: [...] } (top-level error, e.g. bad elm.json)
// Messages are arrays of strings interleaved with `{ string, bold, underline, color }` parts.
function formatElmErrors(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { type?: string; errors?: unknown; path?: string; title?: string; message?: unknown };
  if (r.type === 'compile-errors' && Array.isArray(r.errors)) {
    return r.errors
      .map((file: any) => {
        const path = String(file?.path ?? file?.name ?? 'unknown');
        const problems = Array.isArray(file?.problems) ? file.problems : [];
        return problems
          .map((p: any) => {
            const title = String(p?.title ?? 'PROBLEM');
            const region = p?.region;
            const where = region?.start ? `${path}:${region.start.line}:${region.start.column}` : path;
            const body = renderMessageParts(p?.message);
            return `-- ${title} ---------- ${where}\n\n${body}`;
          })
          .join('\n\n');
      })
      .join('\n\n');
  }
  if (r.type === 'error') {
    const title = String(r.title ?? 'ERROR');
    const where = String(r.path ?? '');
    const body = renderMessageParts(r.message);
    return `-- ${title} ---------- ${where}\n\n${body}`;
  }
  return null;
}

function renderMessageParts(parts: unknown): string {
  if (!Array.isArray(parts)) return String(parts ?? '');
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'string' in (part as Record<string, unknown>)) {
        return String((part as { string: unknown }).string ?? '');
      }
      return '';
    })
    .join('');
}
