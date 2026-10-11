/**
 * Figure packs: a body other than the built-in Coo, as a directory with a `figure.json` manifest.
 *
 * A pack's code runs only inside the sandboxed figure frame (`web/figure-frame.html`): an opaque
 * origin with no network access, talking to the pet page by `postMessage` alone. What the World and
 * the pages need without running it (names, the dress-up axes, presets, what the bot is told the
 * body looks like, which words of the vocabulary the body does not do) is in the manifest.
 *
 * Built-in packs live in the package's `web/` (the whale maid, `web/whale/`); the embedding app
 * names directories whose subdirectories are more packs (`packRoots`). A built-in id wins over an
 * installed pack with the same id; `coo` is the built-in body and never a pack.
 *
 * `skin.figure` is the pack id, `skin.scheme` the picked option of each axis joined by `-` in the
 * manifest's axis order (one axis: the option id), or a preset id.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOCAB } from './script.ts';

export const MANIFEST_FILE = 'figure.json';
/** The manifest version this World reads, and the figure frame's contract (`web/figure-frame.js`). */
export const MANIFEST_VERSION = 1;
export const FIGURE_API = 1;

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Option ids are joined with `-` into `skin.scheme`, so they cannot hold one. */
const OPTION_ID = /^[a-z0-9]{1,24}$/;

export type Names = Record<string, string>;

export interface FigureAxis {
  id: string;
  name: Names;
  options: Array<{ id: string; name: Names; thumb?: string; accent?: string }>;
}

/** The settings window's colours for a preset, see core/console-theme.ts in Coopanion. */
export interface ConsoleHues { a: string; a2: string; on: string; t: string; c3: string; c4: string }

export interface FigurePreset {
  id: string;
  /** The option of each axis. */
  pick: Record<string, string>;
  name?: Names;
  thumb?: string;
  /** Colours the sleep z's and the listening and thinking marks. */
  accent?: string;
  console?: { light: ConsoleHues; dark: ConsoleHues };
}

export interface FigureManifest {
  manifest: number;
  api: number;
  id: string;
  version: string;
  name: Names;
  /** What the body looks like, for the bot's prompt, by language. */
  about: Names;
  author?: string;
  license?: string;
  credits?: Array<{ role: string; name: string; url?: string }>;
  /** The module the frame imports, relative to the pack, and the factory it exports. */
  entry: string;
  export: string;
  /** JSON handed to the factory as `opts.model`, relative to the pack. */
  model?: string;
  thumb?: string;
  axes: FigureAxis[];
  presets: FigurePreset[];
  /** Vocabulary words (script.ts) the body does not do: replaced by another word, or left out (null). */
  unsupported: Record<string, string | null>;
}

export interface FigurePack {
  id: string;
  dir: string;
  /** URL path the pages load the pack's files from, ending in `/`. */
  base: string;
  builtin: boolean;
  manifest: FigureManifest;
}

const names = (v: unknown): Names | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Names = {};
  for (const [k, s] of Object.entries(v)) if (typeof s === 'string' && s.trim()) out[k] = s.trim();
  return Object.keys(out).length ? out : null;
};
/** A path inside the pack: relative, no `..`. */
const inside = (p: unknown): p is string => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.split(/[\\/]/).includes('..') && !/^[a-z]+:/i.test(p);
const VOCAB_IDS = new Set(VOCAB.map((v) => v.id));

/** The manifest at `dir`, checked; a string says what is wrong with it. */
export function readManifest(dir: string): FigureManifest | string {
  const file = join(dir, MANIFEST_FILE);
  if (!existsSync(file)) return `没有 ${MANIFEST_FILE}`;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch (err) { return `${MANIFEST_FILE} 不是合法的 JSON:${(err as Error).message}`; }
  if (raw.manifest !== MANIFEST_VERSION) return `manifest 应为 ${MANIFEST_VERSION},是 ${JSON.stringify(raw.manifest)}`;
  if (raw.api !== FIGURE_API) return `api 应为 ${FIGURE_API},是 ${JSON.stringify(raw.api)}`;
  if (typeof raw.id !== 'string' || !ID.test(raw.id) || raw.id === 'coo') return `id 不合法:${JSON.stringify(raw.id)}`;
  const name = names(raw.name), about = names(raw.about);
  if (!name) return 'name 缺失';
  if (!about) return 'about 缺失';
  if (!inside(raw.entry) || typeof raw.export !== 'string' || !raw.export) return 'entry 或 export 不合法';
  if (raw.model !== undefined && !inside(raw.model)) return 'model 路径不合法';
  if (raw.thumb !== undefined && !inside(raw.thumb)) return 'thumb 路径不合法';
  const axes: FigureAxis[] = [];
  for (const a of Array.isArray(raw.axes) ? raw.axes as Array<Record<string, unknown>> : []) {
    const an = names(a?.name);
    if (typeof a?.id !== 'string' || !ID.test(a.id) || !an || !Array.isArray(a.options) || !a.options.length) return `axes 里有不合法的一项:${JSON.stringify(a?.id)}`;
    const options: FigureAxis['options'] = [];
    for (const o of a.options as Array<Record<string, unknown>>) {
      const on = names(o?.name);
      if (typeof o?.id !== 'string' || !OPTION_ID.test(o.id) || !on || (o.thumb !== undefined && !inside(o.thumb))) return `axes.${a.id} 里有不合法的选项:${JSON.stringify(o?.id)}`;
      options.push({ id: o.id, name: on, ...(o.thumb ? { thumb: o.thumb as string } : {}), ...(typeof o.accent === 'string' ? { accent: o.accent } : {}) });
    }
    axes.push({ id: a.id, name: an, options });
  }
  const presets: FigurePreset[] = [];
  for (const p of Array.isArray(raw.presets) ? raw.presets as Array<Record<string, unknown>> : []) {
    const pick = p?.pick as Record<string, unknown> | undefined;
    if (typeof p?.id !== 'string' || !ID.test(p.id) || !pick || typeof pick !== 'object') return `presets 里有不合法的一项:${JSON.stringify(p?.id)}`;
    for (const a of axes) if (!a.options.some((o) => o.id === pick[a.id])) return `presets.${p.id} 没有选 ${a.id} 的选项`;
    if (p.thumb !== undefined && !inside(p.thumb)) return `presets.${p.id}.thumb 路径不合法`;
    presets.push({
      id: p.id, pick: Object.fromEntries(axes.map((a) => [a.id, pick[a.id] as string])),
      ...(names(p.name) ? { name: names(p.name)! } : {}), ...(p.thumb ? { thumb: p.thumb as string } : {}),
      ...(typeof p.accent === 'string' ? { accent: p.accent } : {}),
      ...(p.console && typeof p.console === 'object' ? { console: p.console as FigurePreset['console'] } : {}),
    });
  }
  const unsupported: Record<string, string | null> = {};
  for (const [word, to] of Object.entries((raw.unsupported ?? {}) as Record<string, unknown>)) {
    if (!VOCAB_IDS.has(word)) return `unsupported 里的 ${word} 不在词表里`;
    if (to !== null && (typeof to !== 'string' || !VOCAB_IDS.has(to) || to in (raw.unsupported as object))) return `unsupported.${word} 要么是 null,要么是这个形象做得了的词`;
    unsupported[word] = to as string | null;
  }
  return {
    manifest: MANIFEST_VERSION, api: FIGURE_API, id: raw.id, version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    name, about, entry: raw.entry, export: raw.export, axes, presets, unsupported,
    ...(typeof raw.author === 'string' ? { author: raw.author } : {}),
    ...(typeof raw.license === 'string' ? { license: raw.license } : {}),
    ...(Array.isArray(raw.credits) ? { credits: raw.credits as FigureManifest['credits'] } : {}),
    ...(raw.model ? { model: raw.model as string } : {}),
    ...(raw.thumb ? { thumb: raw.thumb as string } : {}),
  };
}

export interface PackScan { packs: FigurePack[]; problems: string[] }

/** The packs that ship with the World: directory and the URL path the pages load it from. */
export const BUILTIN_PACKS: ReadonlyArray<{ dir: string; base: string }> = [
  { dir: fileURLToPath(new URL('../../web/whale/', import.meta.url)), base: '/web/whale/' },
];

/** The built-in packs and those installed under `roots` (each subdirectory one pack). */
export function figurePacks(roots: readonly string[]): PackScan {
  return scanPacks(BUILTIN_PACKS, roots);
}

/** The built-in packs (`builtin`: directory → URL path), then each pack directory under `roots`. */
export function scanPacks(builtin: ReadonlyArray<{ dir: string; base: string }>, roots: readonly string[]): PackScan {
  const packs: FigurePack[] = [];
  const problems: string[] = [];
  const add = (dir: string, base: (id: string) => string, isBuiltin: boolean) => {
    const m = readManifest(dir);
    if (typeof m === 'string') { problems.push(`${dir}:${m}`); return; }
    if (packs.some((p) => p.id === m.id)) { problems.push(`${dir}:id ${m.id} 已被${packs.find((p) => p.id === m.id)!.builtin ? '内置形象' : '另一个形象包'}占用`); return; }
    packs.push({ id: m.id, dir, base: base(m.id), builtin: isBuiltin, manifest: m });
  };
  for (const b of builtin) add(b.dir, () => b.base, true);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory()) add(join(root, e.name), (id) => `/packs/${id}/`, false);
    }
  }
  return { packs, problems };
}

/** A file of `pack` by its path inside it, or null when the path leaves the pack. */
export function packFile(pack: FigurePack, path: string): string | null {
  const root = normalize(pack.dir).replace(/[\\/]+$/, '') + sep;
  const full = normalize(join(root, path));
  return full.startsWith(root) ? full : null;
}

/** The name in `language`, else Chinese, else the first one given. */
export function nameIn(n: Names, language = 'zh'): string {
  return n[language] ?? n.zh ?? Object.values(n)[0] ?? '';
}

/**
 * Vocabulary words as the body does them: kept, replaced by the pack's stand-in, or left out.
 * `told` lists one line per word that was not done as asked, for the tool's receipt.
 */
export function adaptWords(words: readonly string[], pack: FigurePack | null): { words: string[]; told: string[] } {
  if (!pack) return { words: [...words], told: [] };
  const out: string[] = [];
  const told: string[] = [];
  const figure = nameIn(pack.manifest.name);
  for (const w of words) {
    if (!(w in pack.manifest.unsupported)) { out.push(w); continue; }
    const to = pack.manifest.unsupported[w];
    if (to) { out.push(to); told.push(`${w} 当前形象(${figure})做不了,换成了 ${to}`); }
    else told.push(`${w} 当前形象(${figure})做不了,没有做`);
  }
  return { words: out, told: [...new Set(told)] };
}

/** One line on what the body does not do, for the bot; empty when it does everything. */
export function unsupportedLine(pack: FigurePack): string {
  const u = Object.entries(pack.manifest.unsupported);
  if (!u.length) return '';
  const replaced = u.filter(([, to]) => to).map(([w, to]) => `${w}→${to}`);
  const left = u.filter(([, to]) => !to).map(([w]) => w);
  return [
    replaced.length ? `这些词会换成别的:${replaced.join('、')}` : '',
    left.length ? `这些词做不了,会被略过:${left.join('、')}` : '',
  ].filter(Boolean).join(';');
}
