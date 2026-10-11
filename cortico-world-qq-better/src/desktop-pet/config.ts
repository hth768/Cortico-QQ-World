/** Config section `worlds.desktop-pet`, its defaults and the console config groups. */
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { WorldPanelDecl } from 'cortico/core/types.ts';
import type { WorldSection } from 'cortico/world.ts';
import type { SegmentConfig } from './asr/segmenter.ts';
import { DEFAULT_HOTKEY } from './asr/hotkey.ts';
import type { CuaConfigSection } from '../cua';

export const DESKTOP_PET_ID = 'desktop-pet';

/** 桌宠控制台面板（id 已改为 pet/pet-voice 以避免与 QQ 自带面板冲突）。 */
export const DESKTOP_PET_PANEL_DECLS: readonly WorldPanelDecl[] = [
  { id: 'pet', title: '桌宠', description: '窗口、装扮与窗口运行时。', getMethods: ['state'] },
  { id: 'pet-voice', title: '语音输入', description: '识别引擎、电平与识别结果。', getMethods: ['state'] },
];

/** What the pet's menu offers, in its order; any of them can also show as a button beside the pet on hover. */
export const PET_ACTIONS = ['chat', 'voice', 'roam', 'theme', 'sound', 'dress', 'hide'] as const;
export type PetAction = typeof PET_ACTIONS[number];
/** Most hover buttons. */
export const MAX_HOVER_BUTTONS = 6;

/** The hover buttons a config value names: known actions, each once, at most MAX_HOVER_BUTTONS. */
export function hoverButtonList(value: string): PetAction[] {
  const out: PetAction[] = [];
  for (const id of value.split(',').map((s) => s.trim())) {
    if ((PET_ACTIONS as readonly string[]).includes(id) && !out.includes(id as PetAction)) out.push(id as PetAction);
  }
  return out.slice(0, MAX_HOVER_BUTTONS);
}

/** Accessory choice as the page's `normalizeSkin` reads it; unknown values fall back to defaults there. */
export interface PetSkin {
  /** coo: the built-in figure; whale: the DeepSeek whale maid (web/whale). */
  figure?: string;
  /** The whale's colour scheme id (web/whale/model.json). */
  scheme?: string;
  palette: string;
  head: string;
  side: string;
  glasses: string;
  neck: string;
  colors: Record<string, { main: string; acc: string }>;
}

/** Kinds of the pet's sounds, the keys of `SOUND_KINDS` in web/pet-core.js. */
export const SOUND_KINDS = ['move', 'touch', 'face', 'snore', 'talk', 'ui'] as const;
export type SoundKind = typeof SOUND_KINDS[number];
export type SoundSettings = Record<SoundKind, boolean> & {
  /** Snoring stops this many seconds into each sleep; the z's keep floating. 0 = snore the whole sleep. */
  snoreSeconds: number;
};

export type RoamMode = 'free' | 'calm' | 'off';
/** Which side of each palette the pet pages draw: dark = light figure for dark surroundings. */
export type PetTheme = 'dark' | 'light';
/** Which touches wake the bot: poke = clicks only, petting and carrying wait for the next wake; all; none = every touch waits. */
export type TouchWake = 'poke' | 'all' | 'none';
/** hold: listen while the talk key is held; toggle: each press starts or stops listening; always: listen all the time. */
export type MicMode = 'hold' | 'toggle' | 'always';
/** funasr: FunASR's SenseVoiceSmall in this process (one model download, every platform); system: the recognizer Windows ships (nothing to download, less accurate). */
export type AsrEngine = 'funasr' | 'system';

export interface DesktopPetConfigSection extends WorldSection {
  /** Local server for the pet page, the dressing page and the pet window's socket. */
  port: number;
  /** Fallback name for the person at the computer, used only when memory has no calling for them. */
  user: string;
  /** The memory id/scope of the person at the computer (usually a QQ number). The pet reads this
   *  person's 档案 from memory and addresses them by the name stored there, instead of the fixed
   *  `user` above. Empty = use the `main` scope and ask the person what to call them. */
  userRef: string;
  /** Computer-use (cortico-world-cua) settings, composed inside this world. */
  cua?: CuaConfigSection;
  window: {
    /** Open the pet window when the World starts. */
    enabled: boolean;
    /** Electron executable; empty uses CORTICO_DESKTOP_PET_HOST, then the managed runtime. */
    electronFile: string;
    /** Figure size on screen, 1 = 256 logo units drawn at 107 px. */
    scale: number;
    /** The pet page draws 60 frames a second at rest too; off, it drops to 30 while the body stands, sits or sleeps. */
    lockFrameRate: boolean;
  };
  roam: RoamMode;
  /** All of the pet's sounds; `sounds` picks among them while this is on. */
  sound: boolean;
  sounds: SoundSettings;
  theme: PetTheme;
  /** Start each run where the pet stood when the World last stopped. */
  rememberPosition: boolean;
  /**
   * Where the pet stood when the World last stopped, as a share of the pet window's width (0..1), whichever
   * display the window was on; each start opens the window on the primary display. Written only on stop;
   * null when nothing is saved.
   */
  petX: number | null;
  /** Actions shown as buttons beside the pet on hover, ids from PET_ACTIONS joined by commas. */
  hoverButtons: string;
  /** Double-clicking the pet opens the typing box. */
  doubleClickChat: boolean;
  /** The bot may change its own looks and habits (src/self.ts), and asks before the rest. */
  selfAdjust: boolean;
  skin: PetSkin;
  touch: {
    /** Clicks, petting and throws become events. */
    enabled: boolean;
    wakeOn: TouchWake;
  };
  asr: {
    enabled: boolean;
    /** Earlier versions wrote `auto` or `whisper` here; both now mean funasr. */
    engine: AsrEngine;
    language: string;
    /** CPU threads for one FunASR decode; 0 = two. */
    threads: number;
    simplified: boolean;
    timeoutMs: number;
    segment: SegmentConfig;
    mic: {
      mode: MicMode;
      /** Talk key for hold and toggle, names joined by `+` (see `src/asr/hotkey.ts`). */
      hotkey: string;
      /** Browser media device id of the microphone; empty uses the system default. */
      deviceId: string;
    };
  };
}

export const DESKTOP_PET_DEFAULTS: DesktopPetConfigSection = {
  enabled: false,
  port: 7797,
  user: '伙伴',
  userRef: '',
  cua: {
    enabled: false,
    control: true,
    permission: 'ask-each-turn',
    grantMinutes: 30,
    screenshot: { maxWidth: 1280, maxHeight: 800, quality: 75, afterAction: true, settleMs: 500 },
    userIdleMs: 2000,
    maxYieldWaitMs: 15000,
    typeChunkDelayMs: 20,
  },
  window: { enabled: true, electronFile: '', scale: 1, lockFrameRate: false },
  roam: 'calm',
  sound: true,
  sounds: { move: true, touch: true, face: true, snore: true, talk: true, ui: true, snoreSeconds: 0 },
  theme: 'dark',
  rememberPosition: false,
  petX: null,
  hoverButtons: 'chat,voice',
  doubleClickChat: false,
  selfAdjust: true,
  skin: {
    figure: 'coo', scheme: 'deepseek', palette: 'mint', head: 'none', side: 'none', glasses: 'none', neck: 'none',
    colors: { head: { main: 'body', acc: 'eye' }, side: { main: 'eye', acc: 'eye' }, glasses: { main: 'body', acc: 'eye' }, neck: { main: 'eye', acc: 'eye' } },
  },
  touch: { enabled: true, wakeOn: 'poke' },
  asr: {
    enabled: true,
    engine: 'funasr',
    language: 'zh',
    threads: 0,
    simplified: true,
    timeoutMs: 20_000,
    segment: { thresholdDb: -42, minSpeechMs: 180, dispatchSilenceMs: 250, silenceMs: 600, maxUtteranceMs: 15_000, preRollMs: 320, minUtteranceMs: 350 },
    mic: { mode: 'hold', hotkey: DEFAULT_HOTKEY, deviceId: '' },
  },
};

const K = `worlds.qqbot.desktopPet`;

export const DESKTOP_PET_CONFIG_GROUP: ConfigGroup = {
  id: `world:${DESKTOP_PET_ID}`,
  owner: `world:${DESKTOP_PET_ID}`,
  schema: {
    type: 'object',
    title: '桌宠',
    properties: {
      [`${K}.user`]: { type: 'string', title: '默认称呼(兜底)', description: '记忆里读不到对方称呼时的兜底叫法;能读到时就用记忆里的。', 'x-hot': true },
      [`${K}.userRef`]: { type: 'string', title: '记忆里你的 id', description: '电脑前这个人在记忆里的 id/scope(通常是 QQ 号,记忆按 qq:<号> 存 TA 的档案)。填了桌宠就从这里读 TA 的称呼,而不是写死的默认值;留空则用 main 范围记忆并自动问你叫什么。', 'x-hot': true },
      [`${K}.roam`]: { type: 'string', title: '行为模式', enum: ['free', 'calm', 'off'], description: 'free 常走动;calm 多待着;off 只做被要求的动作。', 'x-hot': true },
      [`${K}.theme`]: { type: 'string', title: '黑白模式', enum: ['dark', 'light'], description: 'dark 夜间:浅色身体、深色气泡;light 白天:深色身体、浅色气泡。', 'x-hot': true },
      [`${K}.rememberPosition`]: { type: 'boolean', title: '记住位置', description: '退出时记下桌宠的横向位置,下次启动落回那里;有多块屏幕时总在主屏上启动。', 'x-hot': true },
      [`${K}.hoverButtons`]: { type: 'string', title: '悬停按钮', description: `鼠标停在桌宠身上时旁边出现的按钮,最多 ${MAX_HOVER_BUTTONS} 个,逗号分隔:${PET_ACTIONS.join(', ')}。`, 'x-hot': true },
      [`${K}.doubleClickChat`]: { type: 'boolean', title: '双击打字', description: '双击桌宠打开打字框。', 'x-hot': true },
      [`${K}.selfAdjust`]: { type: 'boolean', title: '允许自己调整', description: '桌宠可以自己换形象和装扮、改走动和呼噜;改音效、大小、黑白模式、悬停按钮和对你的称呼前先问你。关掉后这些它都改不了。', 'x-hot': true },
      [`${K}.window.enabled`]: { type: 'boolean', title: '启动时打开桌宠窗口', 'x-hot': false },
      [`${K}.window.scale`]: { type: 'number', title: '大小', minimum: .5, maximum: 2, multipleOf: .05, 'x-hot': true },
      [`${K}.window.lockFrameRate`]: { type: 'boolean', title: '锁定 60 帧', description: '一直按每秒 60 帧画桌宠。关着时站着、坐着、睡着降到每秒 30 帧,走动、被拎着、跳起时仍是 60 帧。', 'x-hot': true },
      [`${K}.window.electronFile`]: { type: 'string', title: 'Electron 程序', description: '留空时依次用 CORTICO_DESKTOP_PET_HOST 和面板里安装的运行时。', 'x-path': { kind: 'file' }, 'x-hot': false },
      [`${K}.port`]: { type: 'integer', title: '页面端口', minimum: 1024, maximum: 65535, description: '被占用时向上顺延。', 'x-hot': false },
      [`${K}.touch.enabled`]: { type: 'boolean', title: '互动发成事件', description: '戳、摸、拎起来甩出去。', 'x-hot': true },
      [`${K}.touch.wakeOn`]: { type: 'string', title: '哪些互动单独唤醒', enum: ['poke', 'all', 'none'], description: 'poke 只有点一下唤醒,摸头和拎起来跟着下一次唤醒一起送;all 都唤醒;none 都跟着下一次唤醒送。一次互动唤醒之后、这一轮结束之前的互动,都跟着下一次唤醒送。', 'x-hot': true },
    },
  },
};

export const DESKTOP_PET_SOUND_CONFIG_GROUP: ConfigGroup = {
  id: `world:${DESKTOP_PET_ID}:sound`,
  owner: `world:${DESKTOP_PET_ID}`,
  schema: {
    type: 'object',
    title: '音效',
    properties: {
      [`${K}.sound`]: { type: 'boolean', title: '音效总开关', description: '桌宠菜单里的音效按钮切的就是这个。', 'x-hot': true },
      [`${K}.sounds.move`]: { type: 'boolean', title: '动作', description: '走路、跑、跳、落地、被甩出去、点头、摇头、转圈、晕。', 'x-hot': true },
      [`${K}.sounds.touch`]: { type: 'boolean', title: '互动', description: '被拎起来、拎着晃、被摸、被戳。', 'x-hot': true },
      [`${K}.sounds.face`]: { type: 'boolean', title: '表情', description: '开心、眨眼、喜欢、惊讶、生气、难过、害羞、打哈欠。', 'x-hot': true },
      [`${K}.sounds.snore`]: { type: 'boolean', title: '打呼噜', 'x-hot': true },
      [`${K}.sounds.snoreSeconds`]: { type: 'integer', title: '呼噜打多久', minimum: 0, maximum: 3600, 'x-suffix': '秒', description: '每次睡着后打这么久呼噜就安静下来,Z 照样飘;0 = 一直打到醒。', 'x-hot': true },
      [`${K}.sounds.talk`]: { type: 'boolean', title: '说话', description: '气泡里逐字冒出的叽咕声、选项卡片弹出的声音。', 'x-hot': true },
      [`${K}.sounds.ui`]: { type: 'boolean', title: '按钮与提示', description: '点按钮、气泡弹出、选中、开始和结束听你说话。', 'x-hot': true },
    },
  },
};

export const DESKTOP_PET_ASR_CONFIG_GROUP: ConfigGroup = {
  id: `world:${DESKTOP_PET_ID}:asr`,
  owner: `world:${DESKTOP_PET_ID}`,
  schema: {
    type: 'object',
    title: '语音输入',
    properties: {
      [`${K}.asr.enabled`]: { type: 'boolean', title: '语音输入总开关', 'x-hot': true },
      [`${K}.asr.engine`]: { type: 'string', title: '识别引擎', enum: ['funasr', 'system'], description: 'funasr 用 FunASR 的 SenseVoiceSmall,在本机识别,中文准,首次要下载约 240 MB 的模型;system 用 Windows 自带的语音识别,不用下载,准确度低一些(只在 Windows 上有)。', 'x-hot': true },
      [`${K}.asr.language`]: { type: 'string', title: '语言', description: 'zh、en、ja、ko、yue,或 auto 让模型自己判断。', 'x-hot': true },
      [`${K}.asr.threads`]: { type: 'integer', title: 'CPU 线程', minimum: 0, maximum: 16, description: 'FunASR 一次识别用几个线程,0 = 2。', 'x-hot': true },
      [`${K}.asr.simplified`]: { type: 'boolean', title: '转成简体', 'x-hot': true },
      [`${K}.asr.segment.thresholdDb`]: { type: 'number', title: '说话门槛', minimum: -80, maximum: 0, 'x-suffix': 'dBFS', 'x-hot': true },
      [`${K}.asr.segment.silenceMs`]: { type: 'integer', title: '一句结束的静音', minimum: 200, maximum: 5000, 'x-suffix': 'ms', 'x-hot': true },
      [`${K}.asr.segment.maxUtteranceMs`]: { type: 'integer', title: '一句最长', minimum: 2000, maximum: 60000, 'x-suffix': 'ms', 'x-hot': true },
    },
  },
};

/** Computer-use (cortico-world-cua) settings, composed inside this world.
 *  Keys live under `worlds.desktop-pet.cua.*` to match the merged config; the
 *  CuaWorld is built in the constructor, so every item needs a world restart. */
const CUA_K = `${K}.cua`;

export const DESKTOP_PET_CUA_CONFIG_GROUP: ConfigGroup = {
  id: `world:${DESKTOP_PET_ID}:cua`,
  owner: `world:${DESKTOP_PET_ID}`,
  schema: {
    type: 'object',
    title: '电脑操作',
    description: '让桌宠替你操作这台电脑:看屏幕、动鼠标键盘、打字、按快捷键。改完重启「桌宠」世界生效。',
    properties: {
      [`${CUA_K}.control`]: {
        type: 'boolean', title: '允许操作鼠标和键盘', 'x-hot': false,
        description: '总开关。关掉就只截图、不会动手;开着才能点、拖、滚动、打字、按键。',
      },
      [`${CUA_K}.permission`]: {
        type: 'string', title: '动手前是否要问你', 'x-hot': false,
        enum: ['always-ask', 'never-ask', 'ask-once', 'ask-daily', 'disabled'],
        description: 'always-ask 每次动手前都问;never-ask 直接做、不問;ask-once 本次授权后一段时间内不再问;ask-daily 每天只问一次;disabled 关掉这层确认(等于 never-ask)。',
      },
      [`${CUA_K}.grantMinutes`]: {
        type: 'integer', title: '一次同意能用多久', minimum: 1, maximum: 1440, 'x-suffix': '分钟', 'x-hot': false,
        description: '选了 ask-once / ask-daily 时,一次同意后这段时间内不再追问。',
      },
      [`${CUA_K}.userIdleMs`]: {
        type: 'integer', title: '你多久没动鼠标就接管', minimum: 0, maximum: 60000, 'x-suffix': 'ms', 'x-hot': false,
        description: '0 = 随时都能接手;数值越大,你一碰鼠标键盘它就先让位给你。',
      },
      [`${CUA_K}.maxYieldWaitMs`]: {
        type: 'integer', title: '一次最多等屏幕多久', minimum: 1000, maximum: 60000, 'x-suffix': 'ms', 'x-hot': false,
        description: '等屏幕安静 / 动画结束的上限,到点就继续往下做,不卡住。',
      },
      [`${CUA_K}.screenshot.maxWidth`]: {
        type: 'integer', title: '截图最宽', minimum: 320, maximum: 3840, 'x-suffix': 'px', 'x-hot': false,
        description: '发给模型的截图缩到这个宽度以内,省 token、也更快。',
      },
      [`${CUA_K}.screenshot.maxHeight`]: {
        type: 'integer', title: '截图最高', minimum: 240, maximum: 2160, 'x-suffix': 'px', 'x-hot': false,
        description: '发给模型的截图缩到这个高度以内。',
      },
      [`${CUA_K}.screenshot.quality`]: {
        type: 'integer', title: '截图质量', minimum: 10, maximum: 100, 'x-suffix': '%', 'x-hot': false,
        description: 'JPEG 压缩质量,越低越省、越糊。',
      },
      [`${CUA_K}.screenshot.afterAction`]: {
        type: 'boolean', title: '动手后自动截图', 'x-hot': false,
        description: '每次动完鼠标键盘就截一张,让模型看到结果再决定下一步。',
      },
      [`${CUA_K}.screenshot.settleMs`]: {
        type: 'integer', title: '动手后等屏幕稳', minimum: 0, maximum: 5000, 'x-suffix': 'ms', 'x-hot': false,
        description: '截图前先等动画 / 页面稳定,避免截到一半的画面。',
      },
    },
  },
};
