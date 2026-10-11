/**
 * The settings the bot may change on its own (`pet_set`), in two tiers:
 *
 * - `self`: its own looks and habits (figure and its picks, Coo's palette and accessories, how much
 *   it walks about, how long it snores): changed at once;
 * - `ask`: what reaches the person's screen, ears or name (sounds, size, the dark/light look, the
 *   hover buttons, what it calls them): changed once they say yes in the bubble.
 *
 * Everything else (computer use, voice input, the microphone, statistics, the model) is not the
 * bot's to change. The person can take the whole of it back with `selfAdjust` on the Habits page.
 */
import type { DeepPartial } from 'cortico/world.ts';
import { MAX_HOVER_BUTTONS, PET_ACTIONS, hoverButtonList, type DesktopPetConfigSection } from './config.ts';
import { nameIn, type FigurePack } from './packs.ts';

export type Tier = 'self' | 'ask';

/** Coo's own looks, as the dressing page names them (web/pet-core.js). */
export interface CooLooks {
  palettes: Array<[id: string, name: string]>;
  /** By slot: head, side, glasses, neck. */
  accessories: Record<string, Array<[id: string, name: string]>>;
}

export interface SettingChange {
  key: string;
  tier: Tier;
  /** What changes, from what to what, for the bubble and the receipt. */
  say: string;
  patch: DeepPartial<DesktopPetConfigSection>;
}

const ROAM: Record<string, string> = { free: '常走动', calm: '多待着', off: '不乱动' };
const THEME: Record<string, string> = { dark: '夜间(浅色身体)', light: '白天(深色身体)' };
const SLOT_NAMES: Record<string, string> = { head: '头顶', side: '耳侧配件', glasses: '眼镜', neck: '颈饰' };

/** The pack's pick named by `scheme`, as `axis:option` words; null when it picks nothing of the pack. */
export function pickWords(pack: FigurePack, scheme: string): string | null {
  const m = pack.manifest;
  const preset = m.presets.find((p) => p.id === scheme);
  const parts = scheme.split('-');
  const words: string[] = [];
  for (const [i, a] of m.axes.entries()) {
    const id = preset ? preset.pick[a.id] : parts[i];
    const o = a.options.find((x) => x.id === id);
    if (!o) return null;
    words.push(`${nameIn(a.name)}:${nameIn(o.name)}`);
  }
  if (!preset && parts.length !== m.axes.length) return null;
  return words.join(',');
}

const figureName = (id: string, packs: readonly FigurePack[]) => (id === 'coo' ? 'Coo' : nameIn(packs.find((p) => p.id === id)?.manifest.name ?? { zh: id }));

/**
 * Checks what `pet_set` asks for against the current config; returns the changes, or why one
 * cannot be made. A value equal to the current one is left out.
 */
export function planSettings(args: Record<string, unknown>, cfg: DesktopPetConfigSection, packs: readonly FigurePack[], coo: CooLooks):
  { changes: SettingChange[]; errors: string[] } {
  const changes: SettingChange[] = [];
  const errors: string[] = [];
  const skin = cfg.skin;
  // figure first: a scheme given with it is checked against the new figure
  let figure = skin.figure ?? 'coo';
  if ('figure' in args) {
    const v = args.figure;
    if (typeof v !== 'string' || (v !== 'coo' && !packs.some((p) => p.id === v))) errors.push(`figure 应为 coo 或已装形象的 id(${packs.map((p) => p.id).join('、') || '没有'}),收到 ${JSON.stringify(v)}`);
    else if (v !== figure) {
      const pack = packs.find((p) => p.id === v);
      const scheme = pack ? (pack.manifest.presets[0]?.id ?? pack.manifest.axes.map((a) => a.options[0]!.id).join('-')) : skin.scheme;
      changes.push({ key: 'figure', tier: 'self', say: `形象 ${figureName(figure, packs)} → ${figureName(v, packs)}`, patch: { skin: { figure: v, ...(pack && !('scheme' in args) ? { scheme } : {}) } } });
      figure = v;
    }
  }
  if ('scheme' in args) {
    const v = args.scheme;
    const pack = packs.find((p) => p.id === figure);
    const words = pack && typeof v === 'string' ? pickWords(pack, v) : null;
    if (!pack) errors.push('scheme 只对形象包有用,Coo 的配色用 palette');
    else if (!words) errors.push(`scheme 不是${nameIn(pack.manifest.name)}的预设或选项组合:${JSON.stringify(v)}`);
    else if (v !== skin.scheme || figure !== skin.figure) {
      const before = skin.figure === figure ? pickWords(pack, skin.scheme ?? '') : null;
      changes.push({ key: 'scheme', tier: 'self', say: `${nameIn(pack.manifest.name)}的打扮 ${before ?? '默认'} → ${words}`, patch: { skin: { scheme: v as string } } });
    }
  }
  if ('palette' in args) {
    const hit = coo.palettes.find(([id]) => id === args.palette);
    if (!hit) errors.push(`palette 应为 ${coo.palettes.map(([id]) => id).join('、')} 之一`);
    else if (hit[0] !== skin.palette) changes.push({ key: 'palette', tier: 'self', say: `Coo 的配色 → ${hit[1]}`, patch: { skin: { palette: hit[0] } } });
  }
  for (const slot of ['head', 'side', 'glasses', 'neck'] as const) {
    if (!(slot in args)) continue;
    const hit = coo.accessories[slot]?.find(([id]) => id === args[slot]);
    if (!hit) errors.push(`${slot} 应为 ${(coo.accessories[slot] ?? []).map(([id]) => id).join('、')} 之一`);
    else if (hit[0] !== skin[slot]) changes.push({ key: slot, tier: 'self', say: `Coo 的${SLOT_NAMES[slot]} → ${hit[1]}`, patch: { skin: { [slot]: hit[0] } } });
  }
  if ('roam' in args) {
    const v = args.roam;
    if (typeof v !== 'string' || !(v in ROAM)) errors.push('roam 应为 free、calm 或 off');
    else if (v !== cfg.roam) changes.push({ key: 'roam', tier: 'self', say: `走动 ${ROAM[cfg.roam]} → ${ROAM[v]}`, patch: { roam: v as DesktopPetConfigSection['roam'] } });
  }
  if ('snoreSeconds' in args) {
    const v = args.snoreSeconds;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 3600) errors.push('snoreSeconds 应为 0–3600 的整数');
    else if (v !== cfg.sounds.snoreSeconds) changes.push({ key: 'snoreSeconds', tier: 'self', say: `每次睡着打呼噜 ${v === 0 ? '一直打到醒' : `${v} 秒`}`, patch: { sounds: { snoreSeconds: v } } });
  }
  if ('sound' in args) {
    const v = args.sound;
    if (typeof v !== 'boolean') errors.push('sound 应为 true 或 false');
    else if (v !== cfg.sound) changes.push({ key: 'sound', tier: 'ask', say: `音效 ${v ? '打开' : '关掉'}`, patch: { sound: v } });
  }
  if ('scale' in args) {
    const v = args.scale;
    if (typeof v !== 'number' || !(v >= .5 && v <= 2)) errors.push('scale 应为 0.5–2 的数');
    else {
      const s = Math.round(v * 20) / 20;
      if (s !== cfg.window.scale) changes.push({ key: 'scale', tier: 'ask', say: `在屏幕上的大小 ${cfg.window.scale} 倍 → ${s} 倍`, patch: { window: { scale: s } } });
    }
  }
  if ('theme' in args) {
    const v = args.theme;
    if (typeof v !== 'string' || !(v in THEME)) errors.push('theme 应为 dark 或 light');
    else if (v !== cfg.theme) changes.push({ key: 'theme', tier: 'ask', say: `换成${THEME[v]}`, patch: { theme: v as DesktopPetConfigSection['theme'] } });
  }
  if ('hoverButtons' in args) {
    const v = args.hoverButtons;
    const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const list = hoverButtonList(ids.join(','));
    if (!Array.isArray(v) || !list.length || list.length !== ids.length) errors.push(`hoverButtons 应为 1–${MAX_HOVER_BUTTONS} 个不重复的 ${PET_ACTIONS.join('、')}`);
    else if (list.join(',') !== cfg.hoverButtons) changes.push({ key: 'hoverButtons', tier: 'ask', say: `悬停按钮换成 ${list.join('、')}`, patch: { hoverButtons: list.join(',') } });
  }
  if ('user' in args) {
    const v = typeof args.user === 'string' ? args.user.trim() : '';
    if (!v || v.length > 20) errors.push('user 应为 1–20 个字');
    else if (v !== cfg.user) changes.push({ key: 'user', tier: 'ask', say: `对你的称呼「${cfg.user}」→「${v}」`, patch: { user: v } });
  }
  const known = new Set(['figure', 'scheme', 'palette', 'head', 'side', 'glasses', 'neck', 'roam', 'snoreSeconds', 'sound', 'scale', 'theme', 'hoverButtons', 'user']);
  for (const k of Object.keys(args)) if (!known.has(k)) errors.push(`${k} 不是你能改的设置`);
  return { changes, errors };
}

/** What `pet_set` can pick from, for the bot's prompt: the figures and their picks, Coo's looks. */
export function dressTable(packs: readonly FigurePack[], coo: CooLooks): string {
  const lines = ['- figure:coo(Coo)' + packs.map((p) => `、${p.id}(${nameIn(p.manifest.name)})`).join('')];
  for (const p of packs) {
    const m = p.manifest;
    const presets = m.presets.map((x) => `${x.id}${x.name ? `(${nameIn(x.name)})` : ''}`).join('、');
    const axes = m.axes.map((a) => `${nameIn(a.name)}:${a.options.map((o) => `${o.id}(${nameIn(o.name)})`).join('、')}`).join(';');
    lines.push(`- ${p.id} 的 scheme:预设 ${presets || '无'}${m.axes.length > 1 ? `;或按 ${m.axes.map((a) => a.id).join('-')} 的顺序用 - 连起来的组合,${axes}` : ''}`);
  }
  lines.push(`- Coo 的 palette:${coo.palettes.map(([id, n]) => `${id}(${n})`).join('、')}`);
  for (const [slot, list] of Object.entries(coo.accessories)) lines.push(`- Coo 的 ${slot}(${SLOT_NAMES[slot] ?? slot}):${list.map(([id, n]) => `${id}(${n})`).join('、')}`);
  return lines.join('\n');
}
