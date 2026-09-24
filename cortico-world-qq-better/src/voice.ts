/**
 * QQ 语音收发模块。
 *
 * 语音供应商（ASR 收 / TTS 发）通过「注册表」动态挂载，不写死具体实现：
 *  - 当前内置：native（OneBot 原生 translate_record / tts，零依赖开箱即用）、
 *    custom（远程 OpenAI 兼容音频端点，需 API Key）、
 *    local（本地/自建模型，OpenAI 兼容、免 Key、慢推理可加超时）。
 *  - 新增第三方供应商只要在下方 registerVoiceProvider(...) 注册一个实现对象即可，
 *    收/发入口（transcribeRecord / synthesizeVoice / checkVoiceDeps）无需改动。
 *  语义判定（judgeVoiceWish）决定本次回复是否用语音，是独立的触发开关，不属于供应商。
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** 精简的 driver 能力（只需 callApi）。 */
export interface VoiceDriver {
  callApi<T = unknown>(action: string, params: Record<string, unknown>): Promise<T>;
}
export interface VoiceLog {
  info: (m: string, e?: unknown) => void;
  warn: (m: string, e?: unknown) => void;
}
/** 运行时语音配置（已由 world 解析好密钥）。provider 为供应商 id（字符串，不写死枚举）。 */
export interface RuntimeVoiceCfg {
  enabled: boolean;
  provider: string;
  asr: boolean;
  tts: boolean;
  semanticJudge: boolean;
  audioFallback: boolean;
  judgeEndpoint: string;
  judgeApiKey: string;
  judgeModel: string;
  /** 自定义(custom)供应商的 OpenAI 兼容音频端点基址，如 https://open.bigmodel.cn/api/paas/v4 或 https://api.openai.com/v1。 */
  voiceBaseUrl: string;
  /** custom 供应商的 API Key（已解析）。 */
  voiceApiKey: string;
  /** custom 供应商的音色/声音名（仅当所选模型支持时填写，如 tongtong）。 */
  voiceVoice: string;
  /** custom 供应商的 ASR 模型名（OpenAI 兼容 /audio/transcriptions 用，缺省 whisper-1）。 */
  voiceAsrModel: string;
  /** custom 供应商的 TTS 模型名（OpenAI 兼容 /audio/speech 用，缺省 tts-1）。 */
  voiceTtsModel: string;
  /** 语音请求超时（毫秒）：TTS/ASR 单次请求最长等待。本地推理慢可调大，custom 与 local 共用。 */
  voiceTimeout: number;
  /** TTS 额外参数（合并进 /audio/speech 的 JSON body），用于本地模型高级特性（如 VoxCPM2 的 reference_audio / voice_design / language）。 */
  voiceExtraTts: Record<string, unknown>;
  /** ASR 额外参数（合并进 /audio/transcriptions 表单），如 language=zh。 */
  voiceExtraAsr: Record<string, unknown>;
  /** 专用识别服务地址（alont1 风格 ASR）：POST {url}/asr 收 WAV 字节 → {text}。非空时优先走此路（ffmpeg 解码 SILK/AMR 后送识别），比 OpenAI /audio/transcriptions 更稳地处理 QQ 原生 SILK 语音。 */
  transcribeUrl: string;
  /** 识别服务单次超时（毫秒）。 */
  transcribeTimeout: number;
  /** ffmpeg 候选路径（按 配置 → PATH → 仓库 ffmpeg-static 顺序尝试），用于把 SILK/AMR 解码成 WAV。 */
  ffmpegCandidates: string[];
}

/** 一段 record 语音（合成后返回，由 world 负责发送）。 */
export interface RecordSeg {
  type: 'record';
  data: { file: string };
}

/** 收语音的上下文。 */
export interface VoiceTranscribeCtx {
  seg: { type: string; data?: { url?: string } };
  messageId: number | undefined;
  driver: VoiceDriver;
  cfg: RuntimeVoiceCfg;
  log: VoiceLog;
}
/** 发语音的上下文。 */
export interface VoiceSynthCtx {
  text: string;
  address: string;
  driver: VoiceDriver;
  cfg: RuntimeVoiceCfg;
  log: VoiceLog;
}

/**
 * 语音供应商接口：一种 ASR(收)+TTS(发) 实现。
 * 通过 registerVoiceProvider 挂到注册表，收/发入口按 cfg.provider 查表分发。
 */
export interface VoiceProvider {
  /** 唯一 id，与控制台 provider 选择一致。 */
  id: string;
  /** 收：把一条 record 段转成文字；返回 null 表示无可用文字（调用方回退音频 blob 或文字）。 */
  transcribe(ctx: VoiceTranscribeCtx): Promise<string | null>;
  /** 发：把文字合成语音 record 段；返回 null 表示合成失败（调用方回退文字）。 */
  synthesize(ctx: VoiceSynthCtx): Promise<RecordSeg | null>;
  /** 依赖自检：返回该供应商是否可用（可选；缺省视为可用）。 */
  checkDeps?(cfg: RuntimeVoiceCfg, log: VoiceLog): boolean;
}

const VOICE_PROVIDERS: Record<string, VoiceProvider> = {};

/** 注册一种语音供应商（内置与扩展都走这里，避免写死分支）。 */
export function registerVoiceProvider(p: VoiceProvider): void {
  VOICE_PROVIDERS[p.id] = p;
}
/** 列出已注册供应商 id（供控制台 enum 动态生成，不写死 UI 选项）。 */
export function voiceProviderIds(): string[] {
  return Object.keys(VOICE_PROVIDERS);
}
/** 按 id 取供应商；未知 id 回退 native 并告警。 */
export function getVoiceProvider(id: string, log?: VoiceLog): VoiceProvider {
  const p = VOICE_PROVIDERS[id];
  if (p) return p;
  log?.warn(`[voice] 未知语音供应商 "${id}"，回退到 native`);
  return VOICE_PROVIDERS['native'];
}

/* ------------------------------------------------------------------ *
 * 供应商：native（OneBot 原生 translate_record / tts，零依赖）
 * ------------------------------------------------------------------ */
const nativeProvider: VoiceProvider = {
  id: 'native',
  async transcribe({ seg, messageId, driver, log }: VoiceTranscribeCtx): Promise<string | null> {
    try {
      const params: Record<string, unknown> = {};
      if (messageId != null) params.message_id = messageId;
      else if (seg?.data?.url) params.url = seg.data.url;
      const r: any = await driver.callApi('translate_record', params);
      const t = typeof r === 'string' ? r : r?.text ?? r?.data?.text;
      if (t && String(t).trim()) return String(t).trim();
    } catch (e) {
      log.warn('[voice] translate_record 失败，回退', String(e));
    }
    return null;
  },
  async synthesize({ text, address, driver, log }: VoiceSynthCtx): Promise<RecordSeg | null> {
    try {
      const [kind, idStr] = address.split(':');
      const params: Record<string, unknown> = { text };
      if (kind === 'group') params.group_id = Number(idStr);
      else params.user_id = Number(idStr);
      const r: any = await driver.callApi('tts', params);
      const file = r?.file ?? r?.data?.file ?? (typeof r === 'string' ? r : null);
      if (file) return { type: 'record', data: { file: String(file) } };
    } catch (e) {
      log.warn('[voice] tts 失败，回退文字', String(e));
    }
    return null;
  },
};

// 注册内置供应商（顺序即默认回退链）。
registerVoiceProvider(nativeProvider);

/* ------------------------------------------------------------------ *
 * OpenAI 兼容音频端点（custom / local 共用）：
 *  - ASR：POST {baseUrl}/audio/transcriptions（form-data: file + model + 额外参数）
 *  - TTS：POST {baseUrl}/audio/speech（JSON: model + voice + input + 额外参数）
 *  - 与具体厂商无关：OpenAI / GLM / 自建兼容服务只要实现该接口即可。
 * ------------------------------------------------------------------ */
async function fetchBytes(url: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** OpenAI 兼容 ASR。requireKey=false 时允许免 Key（本地服务）。extra 合并进表单。 */
async function openAiTranscribe(
  ctx: VoiceTranscribeCtx,
  opts: { requireKey: boolean; extra: Record<string, unknown> },
): Promise<string | null> {
  const { cfg, seg, log } = ctx;
  const url = seg?.data?.url;
  if (!url || !cfg.voiceBaseUrl) {
    log.warn('[voice] 未配置语音模型网址或无音频 url，回退');
    return null;
  }
  if (opts.requireKey && !cfg.voiceApiKey) {
    log.warn('[voice] 该供应商需配置「API Key」，回退');
    return null;
  }
  const bytes = await fetchBytes(url, cfg.voiceTimeout);
  if (!bytes) return null;
  // 注：QQ 语音多为 SILK 编码；OpenAI 兼容端点一般要 wav/mp3/flac。
  // 若服务商不支持 SILK，请改用 native 供应商（其服务端已解码）。
  const form = new FormData();
  form.append('model', cfg.voiceAsrModel || 'whisper-1');
  form.append('file', new Blob([bytes]), 'voice');
  for (const [k, val] of Object.entries(opts.extra)) form.append(k, String(val));
  const headers: Record<string, string> = {};
  if (cfg.voiceApiKey) headers.Authorization = `Bearer ${cfg.voiceApiKey}`;
  try {
    const resp = await fetch(`${cfg.voiceBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(cfg.voiceTimeout),
    });
    if (!resp.ok) throw new Error(`ASR HTTP ${resp.status}`);
    const j = (await resp.json()) as { text?: string };
    return j.text?.trim() || null;
  } catch (e) {
    log.warn('[voice] ASR 失败', String(e));
    return null;
  }
}

/** OpenAI 兼容 TTS。requireKey=false 时允许免 Key（本地服务）。extra 合并进请求体。 */
async function openAiSynthesize(
  ctx: VoiceSynthCtx,
  opts: { requireKey: boolean; extra: Record<string, unknown> },
): Promise<RecordSeg | null> {
  const { cfg, text, log } = ctx;
  if (!cfg.voiceBaseUrl) {
    log.warn('[voice] 未配置语音模型网址，回退');
    return null;
  }
  if (opts.requireKey && !cfg.voiceApiKey) {
    log.warn('[voice] 该供应商需配置「API Key」，回退');
    return null;
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.voiceApiKey) headers.Authorization = `Bearer ${cfg.voiceApiKey}`;
  const body = {
    model: cfg.voiceTtsModel || 'tts-1',
    voice: cfg.voiceVoice || '',
    input: text,
    ...opts.extra,
  };
  try {
    const resp = await fetch(`${cfg.voiceBaseUrl}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.voiceTimeout),
    });
    if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);
    const audio = Buffer.from(await resp.arrayBuffer());
    const dir = join(tmpdir(), 'qq-vox');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const f = join(dir, `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    writeFileSync(f, audio);
    return { type: 'record', data: { file: f } };
  } catch (e) {
    log.warn('[voice] TTS 失败', String(e));
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 供应商：custom（远程 OpenAI 兼容音频端点，配置页填网址/Key/音色）
 * ------------------------------------------------------------------ */
const customProvider: VoiceProvider = {
  id: 'custom',
  transcribe: (ctx) => openAiTranscribe(ctx, { requireKey: true, extra: ctx.cfg.voiceExtraAsr }),
  synthesize: (ctx) => openAiSynthesize(ctx, { requireKey: true, extra: ctx.cfg.voiceExtraTts }),
  checkDeps(cfg: RuntimeVoiceCfg, log: VoiceLog): boolean {
    if (!cfg.voiceBaseUrl || !cfg.voiceApiKey) {
      log.warn('[voice] custom 供应商需配置「语音模型网址」与「API Key」，否则回退文字');
      return false;
    }
    return true;
  },
};

// 注册 custom 供应商（配置页可切）。
registerVoiceProvider(customProvider);

/* ------------------------------------------------------------------ *
 * 供应商：local（本地/自建模型，OpenAI 兼容音频端点，免 API Key）
 *  - 与 custom 协议相同（/audio/transcriptions + /audio/speech），但：
 *    · 不强制 API Key（本地服务常无需鉴权，留空即不发送 Authorization）；
 *    · 默认「请求超时」更长（voiceTimeout），适配本地推理慢；
 *    · 支持「额外参数 JSON」透传，便于本地模型高级特性
 *      （如 VoxCPM2 经 vLLM-Omni 提供 OpenAI 兼容接口，可在 TTS 额外参数里传
 *        reference_audio / voice_design / language 等做声音克隆或声音设计）。
 *  - 典型用法：vllm serve openbmb/VoxCPM2 --omni --port 8000，
 *    语音模型网址填 http://localhost:8000/v1，实现方式选 local。
 * ------------------------------------------------------------------ */
const localProvider: VoiceProvider = {
  id: 'local',
  transcribe: (ctx) => openAiTranscribe(ctx, { requireKey: false, extra: ctx.cfg.voiceExtraAsr }),
  synthesize: (ctx) => openAiSynthesize(ctx, { requireKey: false, extra: ctx.cfg.voiceExtraTts }),
  checkDeps(cfg: RuntimeVoiceCfg, log: VoiceLog): boolean {
    if (!cfg.voiceBaseUrl) {
      log.warn('[voice] local 供应商需配置「语音模型网址」（本地服务地址，如 http://localhost:8000/v1），否则回退文字');
      return false;
    }
    return true;
  },
};

// 注册 local 供应商（配置页可切）。
registerVoiceProvider(localProvider);

/* ------------------------------------------------------------------ *
 * 专用识别服务（alont1 风格 ASR）：ffmpeg 解码 SILK/AMR → WAV，再 POST {url}/asr
 *  - 与 provider 解耦：配了 transcribeUrl 就优先走这条（QQ 原生 SILK 语音也能识别）；
 *    没配则回退到供应商自带 ASR（native 的 translate_record / custom·local 的 OpenAI /audio/transcriptions）。
 *  - 服务契约：POST {transcribeUrl}/asr，请求体为 WAV 字节（content-type: audio/wav），
 *    返回 JSON { text: "..." }。识别失败/超时一律回退，绝不阻塞消息。
 * ------------------------------------------------------------------ */
// 已试通的 ffmpeg（试通一个就记住，免得每条语音都从头试候选）。
let resolvedFfmpeg: string | null = null;
let ffmpegWarned = false;

/** 用 ffmpeg 把语音 url 解码成 16k 单声道 WAV 字节；无可用 ffmpeg 或失败返回 null（best-effort，不阻塞）。 */
function decodeToWav(url: string, candidates: string[], timeoutMs: number): Promise<Uint8Array | null> {
  if (!candidates.length) return Promise.resolve(null);
  const tryOne = (idx: number): Promise<Uint8Array | null> => {
    if (idx >= candidates.length) {
      if (!ffmpegWarned) {
        ffmpegWarned = true;
        // 仅记录一次；真正告警在调用方 transcribeViaService 里按 log 输出。
      }
      return Promise.resolve(null);
    }
    const bin = resolvedFfmpeg ?? candidates[idx];
    return new Promise((resolve) => {
      let settled = false;
      const fail = () => { if (!settled) { settled = true; void tryOne(idx + 1).then(resolve); } };
      let proc: ReturnType<typeof spawn> | null = null;
      try {
        proc = spawn(bin, ['-y', '-i', url, '-f', 'wav', '-ac', '1', '-ar', '16000', 'pipe:1'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const chunks: Buffer[] = [];
        proc.stdout?.on('data', (d) => chunks.push(d as Buffer));
        proc.on('error', fail);
        const t = setTimeout(() => { try { proc?.kill(); } catch { /* noop */ } fail(); }, timeoutMs);
        proc.on('close', (code) => {
          clearTimeout(t);
          if (settled) return;
          if (code === 0 && chunks.length) {
            settled = true;
            if (!resolvedFfmpeg) resolvedFfmpeg = bin;
            resolve(Buffer.concat(chunks));
          } else fail();
        });
      } catch { fail(); }
    });
  };
  return tryOne(0);
}

/** 专用识别服务：解码后 POST {url}/asr（audio/wav）→ {text}。一切失败返回 null（best-effort）。 */
async function transcribeViaService(ctx: VoiceTranscribeCtx): Promise<string | null> {
  const { cfg, seg, log } = ctx;
  const base = (cfg.transcribeUrl || '').trim();
  if (!base) return null;
  const url = seg?.data?.url;
  if (!url) return null;
  const wav = await decodeToWav(url, cfg.ffmpegCandidates, cfg.transcribeTimeout);
  if (!wav) {
    if (!ffmpegWarned) log.warn('[voice] 语音解码失败：找不到可用的 ffmpeg（可配置 voiceFfmpegPath），识别服务未调用');
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.transcribeTimeout);
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/asr`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: Buffer.from(wav),
      signal: ctrl.signal,
    });
    if (!res.ok) { log.warn(`[voice] ASR 服务返回 ${res.status}`); return null; }
    const j = (await res.json()) as { text?: string };
    return j.text?.trim() || null;
  } catch (e) {
    log.warn('[voice] ASR 请求失败', String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * 对外收/发入口：按 cfg.provider 查表分发
 * ------------------------------------------------------------------ */
/** 收：把一条 record 段转成文字。返回 null 表示无可用文字（调用方应回退音频 blob）。 */
export async function transcribeRecord(
  seg: { type: string; data?: { url?: string } },
  messageId: number | undefined,
  driver: VoiceDriver,
  cfg: RuntimeVoiceCfg,
  log: VoiceLog,
): Promise<string | null> {
  // 配了专用识别服务（alont1 风格）→ 优先走 ffmpeg+ /asr；失败再回退供应商自带 ASR。
  if (cfg.transcribeUrl && cfg.transcribeUrl.trim()) {
    const via = await transcribeViaService({ seg, messageId, driver, cfg, log });
    if (via) return via;
  }
  return getVoiceProvider(cfg.provider, log).transcribe({ seg, messageId, driver, cfg, log });
}

/** 发：把文字合成语音 record 段。返回 null 表示合成失败（调用方回退文字）。 */
export async function synthesizeVoice(
  text: string,
  address: string,
  driver: VoiceDriver,
  cfg: RuntimeVoiceCfg,
  log: VoiceLog,
): Promise<RecordSeg | null> {
  return getVoiceProvider(cfg.provider, log).synthesize({ text, address, driver, cfg, log });
}

/** 依赖检查：按当前供应商的 checkDeps 判定可用性。 */
export function checkVoiceDeps(cfg: RuntimeVoiceCfg, log: VoiceLog): boolean {
  const p = getVoiceProvider(cfg.provider, log);
  return p.checkDeps ? p.checkDeps(cfg, log) : true;
}

/* ------------------------------------------------------------------ *
 * 语义判定：本次回复是否应当用语音
 * ------------------------------------------------------------------ */
export async function judgeVoiceWish(userText: string, cfg: RuntimeVoiceCfg, log: VoiceLog): Promise<boolean> {
  if (!cfg.judgeApiKey) {
    log.info('[voice] 语义判定未配置 judgeApiKey，默认不发语音');
    return false;
  }
  try {
    const resp = await fetch(`${cfg.judgeEndpoint}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.judgeApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.judgeModel,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              '你是语音意图判定器。判断：用户这条消息是否希望收到"语音"形式的回复（即机器人用语音念出来）。' +
              '只有当用户明显想要听语音（如"用语音"/"念给我听"/"说给我听"/"语音回复"）或上下文强烈暗示要语音时才返回 yes。' +
              '只回复一个词：yes 或 no。',
          },
          { role: 'user', content: userText.slice(0, 500) },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`judge HTTP ${resp.status}`);
    const j = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const ans = j.choices?.[0]?.message?.content?.trim().toLowerCase() ?? '';
    return ans.startsWith('yes');
  } catch (e) {
    log.warn('[voice] 语义判定失败，默认不发语音', String(e));
    return false;
  }
}
