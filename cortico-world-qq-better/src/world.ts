import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { type BlobInput, type EventEnvelope, type Logger, type PromptDocDecl, type ToolDef, type World, type WorldConsoleDecl, type WorldHost, type WorldLamp, type WorldPanelDecl, type WorldStreamSocket } from 'cortico/core/types.ts';
import { shortTime } from 'cortico/core/util.ts';
import { OneBotDriver } from './driver.ts';
import { QZonePoster, type QZoneConfig } from './qzone.ts';
import { QQ_CONFIG_GROUP, QQ_VOICE_GROUP, QQ_DEFAULTS, normalizeConfig, toIds, type QQConfigSection, type QQWorldConfig } from './config.ts';
import { transcribeRecord, synthesizeVoice, judgeVoiceWish, checkVoiceDeps, type RuntimeVoiceCfg } from './voice.ts';
import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOutgoing, eventClock, eventTs, renderIncoming, renderSegmentsPlain, splitReplyIntoMessages } from './normalize.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('../ENV_PROMPT.md', import.meta.url));
import { type Conv, type OneBotMessage, type OneBotSegment, type QQIdentity, type QQSenderBrief } from './types.ts';
import { Vision } from './vision.ts';
import { StickerStore } from './sticker.ts';
import { ReminderStore, parseWhen, formatWhen } from './reminder.ts';
import { AffinityStore, affinityLabel } from './affinity.ts';
import { ProactiveSpeaker, type ProactiveTarget, type ChatMsg, routineSegment } from './proactive.ts';
import { EmotionEngine } from './emotion.ts';
import { makeHistoryTools } from './history-tools.ts';
import { Notebook } from './notebook.ts';
import { festivalText } from './festival.ts';

const SOURCE = 'qqbot';
/** 合并转发节点里取不到昵称时的占位（对齐内置 qq 的 'QQ用户' 占位）。 */
const PLACEHOLDER_NICKNAME = 'QQ用户';

/** 合并转发节点的渲染结果（对齐内置 qq 的 ForwardNode）。 */
interface ForwardNode {
  line: string;
  body: string;
  named: boolean;
  time?: number;
  userId?: string;
  messageType?: string;
}

interface PendingSend {
  address: string;
  label: string;
  text: string;
  createdAt: number;
  /** 绑定到本草稿的引用回复消息编号（跨会话校验后写入）。 */
  replyMessageId?: number;
  /** qq_send 是否已直接发出（去掉强制草稿门后通常为 true）。 */
  sent?: boolean;
}

/** 把配置里的 JSON 字符串安全地解析成对象；非法或空则回退 {}。用于 TTS/ASR 额外参数透传。 */
function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/** 构建 ffmpeg 候选路径（按 配置 → PATH → 仓库 ffmpeg-static 顺序尝试）。来源于 alont1 的 best-effort 解码思路。 */
function buildFfmpegCandidates(configPath: string, packageDir: string): string[] {
  const out: string[] = [];
  if (configPath && configPath.trim()) out.push(configPath.trim());
  out.push('ffmpeg');
  if (packageDir) {
    const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    out.push(join(packageDir, '..', 'node_modules', 'ffmpeg-static', bin));
  }
  return out;
}

export class QQWorld implements World {
  readonly id = 'qqbot';
  private config: QQWorldConfig = QQ_DEFAULTS;
  /** 语义判定结果缓存：conv 地址 -> 本次是否应说语音（在入站时判定，sendTo 消费后清除）。 */
  private voiceWish = new Map<string, boolean>();
  private host: WorldHost | null = null;
  private log: Logger = consoleLogger();
  private driver: OneBotDriver | null = null;
  private identity: QQIdentity | null = null;
  private readonly convs = new Map<string, Conv>();
  private readonly pendingSends = new Map<string, PendingSend>();
  /** 自己发出的消息索引（message_id → 会话），用于引用回复自己刚发的消息。 */
  private readonly knownMessages = new Map<string, { conv: string; ts: number }>();
  /** 最近收到的图片 URL 缓冲（供 qq_view_image 主动重看，无需事件里带 URL）。 */
  private readonly recentImages: Array<{ url: string; conv: string; at: number }> = [];
  private vision: Vision;
  private stickers: StickerStore | null = null;
  private proactive: ProactiveSpeaker | null = null;
  private qzone: QZonePoster | null = null;
  private emotion: EmotionEngine | null = null;
  private connected = false;
  private proactivePersonaCache: string | null = null;
  /** sendTo 因限速/防死循环而拦截时返回的字符串前缀，便于 qq_send 工具区分“已发送”与“被拦截”。 */
  private static readonly SEND_BLOCKED = '[send blocked] ';
  /** 群聊发言频率限制：group:<id> -> 已发出消息的时间戳数组（用于滑动窗口计数）。 */
  private groupSpeakStamps = new Map<string, number[]>();
  /** 防死循环：会话地址 -> 自上次对方发言以来的 bot 连续发送条数。 */
  private botStreak = new Map<string, number>();
  /** 防死循环：会话地址 -> 最近一次收到对方发言的时间戳（用于 idle 收尾判断）。 */
  private lastUserMsgAt = new Map<string, number>();
  private readonly eventSockets = new Set<WorldStreamSocket>();
  private packageDir = '';
  private emojiDirAbs = '';
  /** 本进程已处理过的 message_id（去重，防止 NapCat 重投导致同一消息回两遍）。仅内存。 */
  private readonly processedIds = new Set<string>();
  /**
   * 兜底自动回复状态。当一条“应当回复”的入站消息（私聊 / 被 @ 的群消息）触发了本轮，
   * 而模型最终没有调用 qq_send 就把文本当成了回复（纯文字回答 → 控制台有、QQ 收不到），
   * 我们在回合收束时把模型生成的文本自动发往来源会话，避免漏发。
   */
  private readonly _pendingReplyConvs = new Set<string>();
  private _tapBuf = '';
  private readonly _sentThisTurn = new Set<string>();
  /** 群成员昵称→QQ 缓存（懒加载，供按昵称 @人/戳人）。groupId -> (小写名->qq)。 */
  private readonly memberIndex = new Map<number, Map<string, number>>();
  private stickerDirAbs = '';
  /** 定时提醒 / 记事本存储。 */
  private reminders!: ReminderStore;
  /** 到点提醒检查定时器句柄。 */
  private reminderTimer: ReturnType<typeof setInterval> | undefined = undefined;
  /** 好感度（关系分）存储：每用户独立、可正可负、随互动浮动。 */
  private affinity: AffinityStore | null = null;
  /** 智能体私人笔记本：记忆插件启用时路由到记忆库，否则落到本地 notebook.jsonl。 */
  private notebook!: Notebook;
  /** key=QQ 号，value=上次注入上下文时记录的好感度；仅在数值变化/首次时重新注入，避免历史被刷屏。 */
  private affinityInjected = new Map<string, number>();
  // 发送去重：记录同会话最近一次实际发出的归一化文本，6s 内完全相同则跳过（防“一句话回复两遍”）。
  private dedupSends = new Map<string, { norm: string; ts: number }>();
  /** 状态持久化目录（来自 ctx.dataDir），用于跨重启重建 knownMessages（防串台索引）。 */
  private dataDir = '';
  private stateFile = '';
  private stateSaveTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /**
   * 串行处理链（对齐内置 qq 的 msgChain）。所有消息/通知都接到这条 Promise 链上依次执行，
   * 严格保证按到达顺序落库，避免并发时 knownMessages / convs / 聚合窗口交叉污染导致串台。
   */
  private msgChain: Promise<void> = Promise.resolve();

  constructor(config?: Partial<QQWorldConfig>, packageDir?: string, dataDir = '') {
    this.config = normalizeConfig((config ?? {}) as QQConfigSection);
    this.packageDir = packageDir ?? '';
    this.dataDir = dataDir;
    this.stateFile = dataDir ? join(dataDir, 'qqbot-known-messages.json') : '';
    this.emojiDirAbs = this.config.emojiDir
      ? isAbsolute(this.config.emojiDir)
        ? this.config.emojiDir
        : join(this.packageDir, this.config.emojiDir)
      : '';
    this.stickerDirAbs = this.config.sticker.dir
      ? isAbsolute(this.config.sticker.dir)
        ? this.config.sticker.dir
        : join(this.packageDir, this.config.sticker.dir)
      : this.emojiDirAbs;
    this.vision = new Vision(this.config.vision, consoleLogger());
  }

  // ---- 生命周期 ----
  async start(host: WorldHost): Promise<void> {
    this.host = this.wrapHost(host);
    this.log = this.host.log.child('qq');
    this.vision = new Vision(this.config.vision, this.log, this.dataDir);
    this.stickers = new StickerStore(this.stickerDirAbs || this.emojiDirAbs || join(this.packageDir, 'emoji'), this.config.vision, this.log, this.dataDir);
    this.syncConfigRoster();
    this.driver = new OneBotDriver({
      mode: this.config.mode,
      wsUrl: this.config.wsUrl,
      wsHost: this.config.wsHost,
      wsPort: this.config.wsPort,
      wsPath: this.config.wsPath,
      token: this.config.token,
      log: this.log,
      onEvent: (ev) => void this.handleEvent(ev),
      onConnectionChange: (c) => {
        this.connected = c;
        if (c) {
          if (this.config.voice.enabled) checkVoiceDeps(this.voiceRuntime(), this.log);
          void this.reloadIdentity();
        }
      },
    });
    await this.driver.start();
    this.loadState();
    this.initProactive();
    this.initQzone();
    // 闹钟/记事本：装载存储并启动到点检查（每 30s 扫一次；离线期间到期的也会在启动后补发）。
    this.reminders = new ReminderStore(this.dataDir, this.log.child('reminder'));
    this.reminderTimer = setInterval(
      () => void this.checkReminders().catch((e) => this.log.warn('提醒检查异常', { err: String(e) })),
      30_000,
    );
    // 好感度（关系分）存储：每用户独立、可正可负、随互动浮动。
    this.affinity = new AffinityStore(this.dataDir, this.log.child('affinity'));
    // 智能体私人笔记本：记忆插件启用时路由到记忆库('qq' scope)，否则落到本地 notebook.jsonl。
    this.notebook = new Notebook(this.dataDir, this.log.child('notebook'));
  }

  /** 装配 QQ 空间动态发布器（发/删动态、按对话记忆自动冒泡、评论回复）。 */
  private initQzone(): void {
    const cfg = this.config.qzone as QZoneConfig;
    if (!cfg.enabled) {
      this.log.info('QQ空间动态未开启');
      return;
    }
    this.qzone = new QZonePoster({
      cfg,
      log: this.log,
      dataDir: this.dataDir,
      callApi: (action, params) => this.driver.callApi(action, params),
      chatCompletion: (messages) => this.qzoneCompletion(messages),
      getContext: () => this.qzoneContext(),
      getRecentImageUrl: () => this.recentImageUrl(),
      resolveSecret: (name) => this.resolveSecret(name),
      isPaused: () => this.host?.isPaused?.() ?? false,
      pushEvent: (e) => this.host.pushEvent(e as never, { trigger: 'piggyback' }),
      identity: () => this.identity,
    });
    this.qzone.start();
  }

  /** 取最近一段聊天上下文（文本），供动态生成“有话可说”。 */
  private qzoneContext(): string {
    try {
      const events = (this.host?.store?.range?.({ source: SOURCE, limit: 60 }) ?? []) as Array<{ text?: string }>;
      return events.map((e) => e.text ?? '').filter(Boolean).join('\n').slice(-4000);
    } catch {
      return '';
    }
  }

  /** 取最近一条 QQ 图片 URL，供自动附图。 */
  private recentImageUrl(): string | null {
    return this.recentImages.length ? this.recentImages[this.recentImages.length - 1].url : null;
  }

  /** 装配主动说话调度器（移植自 fat-fish ProactiveSpeaker）。 */
  private initProactive(): void {
    const cfg = this.config.proactive;
    this.proactive = new ProactiveSpeaker({
      cfg,
      log: this.log,
      dataDir: this.dataDir,
      getTargets: () => this.proactiveTargets(),
      routine: this.config.routine,
      selfName: this.resolveSelfRef(),
      send: async (address, text) => {
        // 解析主动生成文本里的动作标记（让主动冒泡也能 @人 / 戳一啄）：
        //  - [[poke:QQ号或群昵称]]  → 戳一啄该成员（无文本动作）
        //  - @QQ号 / @群昵称        → 在消息开头 @ 该成员
        const groupId = address.startsWith('group:') ? Number(address.split(':')[1]) : null;
        let body = text;
        const pokeTargets: Array<{ qq: number; who: string }> = [];
        const pokeRe = /\[\[poke:\s*([^\]]+?)\s*\]\]/g;
        let pm: RegExpExecArray | null;
        while ((pm = pokeRe.exec(body))) {
          const qq = await this.resolveQQ(groupId, pm[1].trim());
          if (qq != null) pokeTargets.push({ qq, who: pm[1].trim() });
          else this.log.warn('proactive 戳一啄解析失败（已跳过）', { who: pm[1] });
        }
        body = body.replace(pokeRe, '');
        // 收集 @（QQ号或群内昵称），并从正文移除，避免 sendTo 重复注入 at 段。
        const atQQs: number[] = [];
        const atRe = /@([^\s@]{1,30})/g;
        const atMentioned: string[] = [];
        let am: RegExpExecArray | null;
        while ((am = atRe.exec(body))) atMentioned.push(am[1]);
        if (atMentioned.length) {
          const resolved = await Promise.all(atMentioned.map((w) => this.resolveQQ(groupId, w)));
          for (const q of resolved) if (q != null) atQQs.push(q);
          body = body.replace(atRe, '').replace(/\s{2,}/g, ' ').trim();
        }
        // 先执行戳一啄动作（无文本）。
        for (const t of pokeTargets) {
          try {
            if (groupId != null) await this.driver?.callApi('group_poke', { group_id: groupId, user_id: t.qq });
            else await this.driver?.callApi('friend_poke', { user_id: t.qq });
          } catch (e) {
            this.log.warn('proactive 戳一啄失败', { qq: t.qq, err: String(e) });
          }
        }
        // 再发文本（带 @）。
        let res = '（主动冒泡：仅动作，无文本）';
        const spoken = body.trim();
        if (spoken) {
          res = await this.sendTo(address, spoken, undefined, atQQs.length ? atQQs : undefined);
        }
        // 把 bot 自己主动说的话/做的动作回灌进 session 上下文：origin=internal 会渲染进
        // 上下文但不唤醒回合（不会回声回复），否则她不记得自己主动说过/做过什么。
        try {
          const [kind, idStr] = address.split(':');
          const conv = this.convs.get(address);
          const label = conv?.label ?? idStr;
          const clock = eventClock(this.config.timezone);
          const selfName = this.identity?.nickname ?? '肥鱼娘';
          const bits: string[] = [];
          if (spoken) bits.push(`说了下面这句话：“${spoken}”`);
          if (atQQs.length) bits.push(`并 @了 ${atQQs.length} 人`);
          if (pokeTargets.length) bits.push('并戳了 ' + pokeTargets.map((t) => `${t.who}(QQ:${t.qq})`).join('、'));
          if (!bits.length) bits.push('发了个动作（戳一啄）');
          const prefix = kind === 'group'
            ? `我是${selfName}。刚才(约 ${clock})我主动在QQ群「${label}」里`
            : `我是${selfName}。刚才(约 ${clock})我主动在QQ私聊里`;
          await this.host?.pushEvent({
            type: 'qq.message',
            ts: eventTs(this.config.timezone),
            source: SOURCE,
            origin: 'internal',
            text: `${prefix}${bits.join('，')}。`,
            senderKey: address,
            meta: { conv: address, role: 'assistant', self: true },
          }, { trigger: 'piggyback' });
        } catch (e) {
          this.log.warn('proactive 回灌上下文失败 ' + String(e));
        }
        return res;
      },
      generate: (messages) => this.chatCompletion(messages),
      // 让主动说话调度器感知总开关：暂停时 tick 直接停手。
      isPaused: () => this.host?.isPaused?.() ?? false,
      // 主动说话复用 Persona + 记忆，避免与正常对话割裂。
      systemPromptFor: (target) => this.proactiveSystemPrompt(target),
    });
    this.emotion = new EmotionEngine({
      dataDir: this.dataDir,
      decayHours: this.config.emotion.decayHours,
      labelMinutes: this.config.emotion.labelMinutes,
      log: this.log,
      generate: (messages) => this.moodCompletion(messages),
      enabled: this.config.emotion.enabled,
    });
    this.proactive.start();
  }

  /** 按 mode 过滤出可主动说话的监听会话。 */
  private proactiveTargets(): ProactiveTarget[] {
    const mode = this.config.proactive.mode;
    const out: ProactiveTarget[] = [];
    for (const c of this.convs.values()) {
      if (!c.active) continue;
      if (mode === 'private' && c.kind !== 'private') continue;
      if (mode === 'group' && c.kind !== 'group') continue;
      out.push({ address: c.address, kind: c.kind, label: c.label });
    }
    return out;
  }

  /** 解析密钥：优先取 process.env，否则回退到 deployments/providers 下各 provider 的 .env 文件（Cortico 不把 .env 注入 process.env）。 */
  private resolveSecret(name: string): string | undefined {
    const fromEnv = process.env[name];
    if (fromEnv) return fromEnv;
    try {
      const providersDir = join(dirname(dirname(this.dataDir)), 'providers');
      if (existsSync(providersDir)) {
        for (const dir of readdirSync(providersDir)) {
          const envPath = join(providersDir, dir, '.env');
          if (!existsSync(envPath)) continue;
          const m = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm').exec(readFileSync(envPath, 'utf8'));
          if (m) return m[1].trim();
        }
      }
    } catch { /* ignore */ }
    return undefined;
  }

  /** 把配置里的语音设置解析成运行时配置（已解析密钥）。 */
  private voiceRuntime(): RuntimeVoiceCfg {
    const v = this.config.voice;
    return {
      enabled: v.enabled,
      provider: v.provider,
      asr: v.asr,
      tts: v.tts,
      semanticJudge: v.semanticJudge,
      audioFallback: v.audioFallback,
      judgeEndpoint: v.judgeEndpoint,
      judgeApiKey: this.resolveSecret(v.judgeApiKeySecret) ?? '',
      judgeModel: v.judgeModel,
      voiceBaseUrl: v.voiceBaseUrl,
      voiceApiKey: this.resolveSecret(v.voiceApiKeySecret) ?? '',
      voiceVoice: v.voiceVoice,
      voiceAsrModel: v.voiceAsrModel,
      voiceTtsModel: v.voiceTtsModel,
      voiceTimeout: (typeof v.voiceTimeout === 'number' && v.voiceTimeout > 0 ? v.voiceTimeout : 120) * 1000,
      voiceExtraTts: parseJsonObject(v.voiceExtraTts),
      voiceExtraAsr: parseJsonObject(v.voiceExtraAsr),
      transcribeUrl: v.voiceTranscribeUrl || '',
      transcribeTimeout: (typeof v.voiceTranscribeTimeout === 'number' && v.voiceTranscribeTimeout > 0 ? v.voiceTranscribeTimeout : 60000),
      ffmpegCandidates: buildFfmpegCandidates(v.voiceFfmpegPath, this.packageDir),
    };
  }

  /** OpenAI 兼容 chat 补全（主动消息生成用），失败返回 null。
   *  主动说话需要「贴着事实」，故温度压到 0.5（默认 0.9 太飘，容易编造）。 */
  private async chatCompletion(messages: ChatMsg[]): Promise<string | null> {
    const cfg = this.config.proactive;
    return this.completeChat(cfg.endpoint, cfg.apiKeySecret, cfg.model, messages, { temperature: 0.5, maxTokens: 200 });
  }

  /**
   * 主动说话的系统提示词：复用 bot 的 Persona（ORIENTATION）+ 该会话已有的记忆，
   * 让主动冒泡的语气与内容跟正常对话保持一致，不再「割裂」。
   */
  private proactiveSystemPrompt(target: ProactiveTarget): string {
    const blocks: string[] = [];
    const persona = this.loadPersonaPrompt();
    if (persona) blocks.push(persona);
    // 关键：把这个会话最近的真实对话塞进去，作为「事实基底」，否则 LLM 只能凭空编。
    const recent = this.recentContextFor(target.address);
    if (recent) blocks.push('## 这个会话最近的真实对话（只基于这里出现过的内容说话，没出现过的事件/计划/细节一律不要编造）\n' + recent);
    const mem = this.recallProactiveMemory(target.address);
    if (mem) blocks.push('## 你关于这个会话已有的记忆\n' + mem);
    const notes = this.recallProfileNotes();
    if (notes) blocks.push('## 你的长期笔记（全局，务必遵守）\n' + notes);
    const routine = this.routineSegmentText();
    if (routine) blocks.push(routine);
    // 当下时间与时令（含节日/节气/农历感知）：让主动说话也能自然呼应今天是什么日子，
    // 而不只是被动回复时才懂——比如中秋主动发句问候、冬至聊吃饺子，而不是只有被问到才提。
    const timeFestival = [
      `当前时间：${this.nowText()}（时区 ${this.config.timezone}）。`,
      this.festivalLine(),
    ].filter(Boolean).join('\n');
    if (timeFestival) {
      blocks.push('## 当下时间与时令（用于让主动说话自然呼应今天的日子、节气或节日；不要生硬念，自然带过即可）\n' + timeFestival);
    }
    if (this.config.proactive.systemPrompt) {
      blocks.push(
        this.config.proactive.systemPrompt +
          '\n\n【硬性约束】主动说话只能基于上面「真实对话」与「记忆」里出现过的内容。' +
          '严禁编造：不要引用没发生过的「上次/上回」、对方从没提过的计划或偏好、对话里没出现过的细节。' +
          '如果上面的真实对话/记忆里没什么可接的，就聊点当下泛泛的关心或问候（天气、心情、摸鱼），' +
          '或者返回空内容（什么都不发）也完全可以——绝对不要为了凑话题而虚构具体事件。' +
          '\n\n【主动动作（可选）】除了说话，你还可以主动 @人 或 戳一啄：' +
          '在生成内容里用 `@昵称` 或 `@QQ号` 来 @某人；用 `[[poke:昵称或QQ号]]` 来戳一啄某人' +
          '（戳一啄是无文本的动作，可以单独发，也可以和说话一起）。注意：' +
          '只在群聊里、且只对这些会话「真实对话」里近期出现过/有互动的成员使用动作；' +
          '次数要克制，不要每条主动消息都 @或戳（容易打扰），偶尔、自然地用才合适；私聊戳一啄留空为戳对话对象。'
      );
    }
    return blocks.join('\n\n');
  }

  /** 当前作息状态文本（睡眠/午休/活跃），用于注入主动说话与人格上下文；未开启返回空。 */
  private routineSegmentText(): string {
    const r = this.config.routine;
    if (!r?.enabled) return '';
    const seg = routineSegment(r);
    const self = this.resolveSelfRef();
    const text =
      seg === 'sleep'
        ? `【当前作息】睡眠时段：${self}在休息，不会主动找人说话（但被找仍会回），语气可以带点困、简短些。`
        : seg === 'lazy'
        ? `【当前作息】午休/打盹时段：${self}在摸鱼歇着，聊可以但别太耗能。`
        : `【当前作息】活跃时段：${self}精神着呢。`;
    return text;
  }

  /** 当前时间（按配置时区格式化），供对话前缀与主动说话共用。 */
  private nowText(): string {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: this.config.timezone,
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date());
    } catch {
      return new Date().toLocaleString('zh-CN');
    }
  }

  /** 节日/节气/农历感知文本（按配置时区推算），供对话前缀与主动说话共用。 */
  private festivalLine(): string {
    try {
      return festivalText(this.config.timezone);
    } catch {
      return '';
    }
  }

  /** 读取部署的 Persona 提示词（prompts/ORIENTATION.md），缓存一次。 */
  private loadPersonaPrompt(): string {
    if (this.proactivePersonaCache === null) {
      this.proactivePersonaCache = '';
      try {
        const p = join(dirname(this.dataDir), 'prompts', 'ORIENTATION.md');
        if (existsSync(p)) this.proactivePersonaCache = readFileSync(p, 'utf8').trim();
      } catch {
        /* 读不到就回退到 cfg.systemPrompt */
      }
    }
    return this.proactivePersonaCache;
  }

  /** 解析主动说话/作息文本里用的自称，替代硬编码「本鱼」。
   *  优先级：config.selfName 显式配置 > 从 ORIENTATION 人设推断 > 登录 QQ 昵称 > '我'。 */
  private resolveSelfRef(): string {
    const explicit = (this.config.selfName ?? '').trim();
    if (explicit) return explicit;
    const persona = this.loadPersonaPrompt();
    if (persona) {
      // 常见写法：昵称"小鱼"或"肥鱼娘" / 名字叫陈玥汐 / 你是DeepSeek娘，
      const m =
        persona.match(/昵称[“"『「]([^”"』」\s,，。、]+)[”"』」]/) ??
        persona.match(/名字叫([^\s，。、,的叫]+)/) ??
        persona.match(/你是([^\s，。、,]+?)[，,。]/);
      if (m && m[1]) return m[1].trim();
    }
    return this.identity?.nickname ?? '我';
  }

  /** 从共享 fact-store 取该会话（scope=address）最近的记忆，作为主动说话上下文。 */
  private recallProactiveMemory(address: string): string {
    try {
      const f = join(this.dataDir, 'fact-store.json');
      if (!existsSync(f)) return '';
      const raw = JSON.parse(readFileSync(f, 'utf8'));
      const facts: Array<{ text?: string; updatedAt?: number; createdAt?: number }> =
        raw?.scopes?.[address] ?? [];
      if (!facts.length) return '';
      const top = [...facts]
        .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
        .slice(0, 20)
        .map((x) => '- ' + String(x.text ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return top.join('\n');
    } catch {
      return '';
    }
  }

  /** 从共享 memory-data 取全局长期笔记（profile notes），主动说话也必须遵守。 */
  private recallProfileNotes(): string {
    try {
      const f = join(this.dataDir, 'memory-data.json');
      if (!existsSync(f)) return '';
      const raw = JSON.parse(readFileSync(f, 'utf8'));
      const notes: Array<{ text?: string }> = raw?.notes?.main ?? [];
      if (!notes.length) return '';
      const top = notes
        .slice(-10)
        .map((x) => '- ' + String(x.text ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return top.join('\n');
    } catch {
      return '';
    }
  }

  /** 拉取该会话最近的真实对话（来自框架 EventStore），作为主动说话的「事实基底」，避免凭空编造。
   *  只取 senderKey 命中该会话、且带文本的事件，取最近 40 条，截断到 3000 字。 */
  private recentContextFor(address: string): string {
    try {
      const events = (this.host?.store?.range?.({ source: SOURCE, limit: 150 }) ?? []) as Array<{
        text?: string;
        senderKey?: string;
      }>;
      const lines = events
        .filter((e) => e.senderKey === address && e.text && e.text.trim())
        .slice(-40)
        .map((e) => e.text!.replace(/\s+/g, ' ').trim());
      const joined = lines.join('\n');
      return joined.length > 3000 ? joined.slice(-3000) : joined;
    } catch {
      return '';
    }
  }

  /** 动态生成（QQ空间）专用模型调用，与主动说话共用同一套 fetch 逻辑。 */
  private async qzoneCompletion(messages: ChatMsg[]): Promise<string | null> {
    const cfg = this.config.qzone as QZoneConfig;
    return this.completeChat(cfg.endpoint, cfg.apiKeySecret, cfg.model, messages);
  }

  /** OpenAI 兼容 chat/completions 调用（供主动说话与动态生成复用）。 */
  private async completeChat(
    endpoint: string,
    apiKeySecret: string,
    model: string,
    messages: ChatMsg[],
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<string | null> {
    const apiKey = this.resolveSecret(apiKeySecret);
    if (!apiKey) {
      this.log.warn('动态/主动说话缺少 API Key', { secret: apiKeySecret });
      return null;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature: opts?.temperature ?? 0.9, max_tokens: opts?.maxTokens ?? 200 }),
      });
      if (!res.ok) {
        this.log.warn('动态/主动说话模型返回非 200', { status: res.status });
        return null;
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch (e) {
      this.log.warn('动态/主动说话模型调用失败', { err: String(e) });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 情绪感知专用补全：低温、较长输出；失败返回 null（由 EmotionEngine 兜底跳过）。 */
  private async moodCompletion(messages: ChatMsg[]): Promise<string | null> {
    const cfg = this.config.emotion;
    return this.completeChat(cfg.endpoint, cfg.apiKeySecret, cfg.model, messages, { temperature: 0.2, maxTokens: 400 });
  }

  async stop(): Promise<void> {
    for (const c of this.convs.values()) {
      if (c.aggregationTimer) {
        clearTimeout(c.aggregationTimer);
        c.aggregationTimer = undefined;
      }
    }
    if (this.stateSaveTimer) {
      clearTimeout(this.stateSaveTimer);
      this.stateSaveTimer = undefined;
    }
    this.saveState();
    this.stickers?.flush();
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    this.reminderTimer = undefined;
    this.reminders?.flush();
    this.affinity?.flush();
    this.proactive?.stop();
    this.qzone?.stop();
    this.emotion?.stop();
    if (this.driver) await this.driver.stop();
    this.driver = null;
    this.connected = false;
    for (const s of this.eventSockets) s.close('world stopped');
    this.eventSockets.clear();
  }

  /** 一轮自然收束：未确认的草稿只在本轮内有效（对齐内置 qq 的 onTurnEnded 作废草稿）。 */
  onTurnEnded(): void {
    this.pendingSends.clear();
  }

  /**
   * 到点自动提醒：扫描所有到期未完成提醒，发到对应会话，并把“已提醒”回灌进上下文
   * （让 bot 记得自己提醒过、便于接话）。注意：提醒只是“到点说一声”，到底做不做、怎么做，
   * 由 bot 自己根据情境判断决定——不强求执行，也不反复催促。bot 睡眠/暂停时不阻止提醒（约定到点了该响）。
   */
  private async checkReminders(): Promise<void> {
    if (!this.config.reminder?.enabled) return;
    const due = this.reminders.due();
    if (!due.length) return;
    for (const r of due) {
      const addr = r.address || '';
      const body = `⏰ 到点提醒：${r.text}` + (r.scope ? `（${r.scope}）` : '');
      if (addr) {
        try {
          await this.sendTo(addr, body);
        } catch (e) {
          this.log.warn('提醒发送失败', { id: r.id, address: addr, err: String(e) });
        }
      } else {
        this.log.warn('提醒缺少发送地址，已跳过发送', { id: r.id, text: r.text });
      }
      // 回灌上下文：注明提醒到点已发出，并点明“做不做由本鱼自己看着办”，避免模型误以为必须执行/反复催。
      try {
        this.host?.pushEvent({
          type: 'qq.message',
          ts: eventTs(this.config.timezone),
          source: SOURCE,
          origin: 'internal',
          text:
            `我是肥鱼娘。我之前记的定时提醒「${r.text}」${r.scope ? `（${r.scope}）` : ''}到点了，我已经${addr ? '在该会话提醒了一声' : '准备提醒'}。` +
            `至于这件事到底做不做、怎么做，由我自己根据当下情况决定，不必硬照办，也不反复催。`,
          senderKey: addr,
          meta: { conv: addr, role: 'assistant', self: true },
        }, { trigger: 'piggyback' });
      } catch (e) {
        this.log.warn('提醒回灌上下文失败', { err: String(e) });
      }
      this.reminders.markDone(r.id);
    }
    this.reminders.flush();
  }

  // ---- 状态持久化（跨重启重建 knownMessages，防串台索引不丢）----
  private loadState(): void {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as { knownMessages?: Record<string, { conv: string; ts: number }> };
      const km = raw.knownMessages ?? {};
      for (const [k, v] of Object.entries(km)) this.knownMessages.set(k, { conv: v.conv, ts: v.ts });
      this.log.info('已恢复 knownMessages', { count: this.knownMessages.size });
    } catch (e) {
      this.log.warn('读取 qqbot 状态失败', { err: String(e) });
    }
  }

  private saveState(): void {
    if (!this.stateFile) return;
    try {
      const obj = { knownMessages: Object.fromEntries(this.knownMessages) };
      writeFileSync(this.stateFile, JSON.stringify(obj), 'utf8');
    } catch (e) {
      this.log.warn('保存 qqbot 状态失败', { err: String(e) });
    }
  }

  /** 防抖落盘：每条消息索引更新后调用，1.5s 内合并一次写入。 */
  private scheduleSaveState(): void {
    if (!this.stateFile) return;
    if (this.stateSaveTimer) return;
    this.stateSaveTimer = setTimeout(() => {
      this.stateSaveTimer = undefined;
      this.saveState();
    }, 1500);
  }

  private async reloadIdentity(): Promise<void> {
    if (!this.driver) return;
    try {
      this.identity = await this.driver.refreshIdentity();
      this.log.info('已加载身份', { selfId: this.identity.selfId, groups: this.identity.groups.size });
      this.syncConfigRoster();
    } catch (e) {
      this.log.warn('加载身份失败', { err: String(e) });
    }
  }

  private syncConfigRoster(): void {
    for (const g of toIds(this.config.groups)) this.ensureConv('group', g);
    for (const p of toIds(this.config.privates)) this.ensureConv('private', p);
  }

  private ensureConv(kind: 'group' | 'private', id: number): Conv {
    const address = `${kind}:${id}`;
    let c = this.convs.get(address);
    if (!c) {
      c = {
        kind,
        id,
        address,
        label: kind === 'group' ? (this.identity?.groups.get(id) ?? `群${id}`) : `私聊${id}`,
        active: true,
      };
      this.convs.set(address, c);
    }
    return c;
  }

  private convLabel(address: string): string {
    return this.convs.get(address)?.label ?? address;
  }

  // ---- 事件处理 ----
  private handleEvent(ev: OneBotMessage): void {
    if (!this.host) return;
    if (ev.post_type === 'meta_event') return;
    if (ev.post_type === 'notice') {
      this.enqueue(() => this.handleNotice(ev));
      return;
    }
    // QQ 空间互动事件（评论/点赞等）：交给 qzone 发布器处理，不进入聊天消息流。
    if (ev.post_type === 'qzone' || ev.post_type === 'interact' || /qzone/i.test(String((ev as Record<string, unknown>).detail_type ?? (ev as Record<string, unknown>).sub_type ?? ''))) {
      if (this.qzone) void this.enqueue(() => this.qzone!.onEvent(ev as unknown as Record<string, unknown>));
      return;
    }
    if (ev.post_type !== 'message' && ev.post_type !== 'message_sent') return;
    if (ev.post_type === 'message_sent') return; // 忽略自己发出的回显，避免回环
    const kind = ev.message_type === 'private' ? 'private' : 'group';
    const id = kind === 'group' ? ev.group_id! : ev.user_id!;
    // 自己回声丢弃（双重保险：NapCat reverse 有时把自身消息以普通 message 回报）
    if (this.identity && Number(ev.user_id) === this.identity.selfId) return;
    if (!this.isListened(kind, id)) return;
    const conv = this.ensureConv(kind, id);
    conv.lastMessageAt = Date.now();
    this.proactive?.notifyReply(conv.address);
    // 收到对方发言：清零该会话的“bot 连续发言”计数，并刷新最后发言时间（防死循环）。
    this.botStreak.set(conv.address, 0);
    this.lastUserMsgAt.set(conv.address, Date.now());
    const sender = this.resolveSender(ev, kind, id);
    // 按 message_id 去重：NapCat reverse 偶发会把同一条消息事件重投两次，
    // 若直接 enqueue 会被处理两遍 → 同一消息回两遍。已在内存里出现过的消息直接丢弃。
    if (ev.message_id != null) {
      const mid = String(ev.message_id);
      if (this.processedIds.has(mid)) {
        this.log.warn('重复消息事件，跳过', { message_id: mid });
        return;
      }
      this.processedIds.add(mid);
      // 内存增长保护：超过 6 万条清空（QQ message_id 单调递增，短期内不会复用）。
      if (this.processedIds.size > 60000) this.processedIds.clear();
    }
    this.enqueue(() => this.handleMessage(ev, conv, sender));
  }

  /** 把一条事件处理任务接到串行链上（对齐内置 qq 的 enqueueMessage）。 */
  private enqueue(task: () => Promise<void>): void {
    this.msgChain = this.msgChain.then(task).catch((e) => {
      this.log.error('消息处理链异常', { err: String(e) });
    });
  }

  private isListened(kind: 'group' | 'private', id: number): boolean {
    if (kind === 'group') {
      const ids = toIds(this.config.groups);
      return ids.length === 0 || ids.includes(id);
    }
    return toIds(this.config.privates).includes(id);
  }

  private resolveSender(ev: OneBotMessage, kind: 'group' | 'private', id: number): QQSenderBrief {
    const s = ev.sender ?? {};
    const userId = ev.user_id ?? 0;
    let name = s.card || s.nickname || `用户${userId}`;
    let role = s.role;
    let title = s.title;
    if (kind === 'group' && this.driver) {
      // 名片可能为空，尝试补一次群成员信息
      if (!s.card && (s.nickname === undefined || s.nickname === '')) {
        void this.driver.getMemberInfo(id, userId).then((info) => {
          if (info) {
            const c = this.convs.get(`group:${id}`);
            if (c?.members) {
              const prev = c.members.get(userId);
              if (prev) c.members.set(userId, { ...prev, card: info.card, name: info.nickname, role: info.role, title: info.title });
            }
          }
        });
      }
      const conv = this.convs.get(`group:${id}`);
      if (conv) {
        conv.members ??= new Map();
        conv.members.set(userId, { userId, name, card: s.card, role, title });
      }
    }
    void this.identity?.knownPeers.set(userId, { nickname: s.nickname ?? name, card: s.card });
    return { userId, name, card: s.card, role, title };
  }

  private async handleMessage(ev: OneBotMessage, conv: Conv, sender: QQSenderBrief): Promise<void> {
    // 收到即索引 message_id → 会话（防串台核心：引用回复与跨会话校验都靠它，对齐内置）。
    if (ev.message_id != null) {
      this.knownMessages.set(String(ev.message_id), { conv: conv.address, ts: Date.now() });
      this.scheduleSaveState();
    }
    const host = this.host!;
    const segs: OneBotSegment[] =
      typeof ev.message === 'string' ? [{ type: 'text', data: { text: ev.message } }] : (ev.message ?? []);
    const selfId = this.identity?.selfId ?? 0;
    const atMe = segs.some((s) => s.type === 'at' && Number((s as { data: { qq: string } }).data.qq) === selfId);

    // 引用回复
    let replyText: string | undefined;
    let replyRef: string | undefined;
    const replySeg = segs.find((s) => s.type === 'reply');
    if (replySeg) {
      const rid = Number((replySeg as { data: { id: string } }).data.id);
      const q = await this.resolveQuoted(rid);
      replyRef = q.ref;
      replyText = q.text || undefined;
    }

    const text = renderIncoming(segs, { timezone: this.config.timezone, selfId, replyText, replyRef });
    this.log.info('HANDLE_IN kind=' + conv.kind + ' text=' + JSON.stringify(text).slice(0, 40));
    // 情绪系统（移植自 fat-fish emotion）：感知 + /心情 命令/查询
    if (text && this.emotion) {
      const trimmed = text.trim();
      const isMoodCmd = /^[/／]心情/.test(trimmed);
      if (isMoodCmd) {
        // 命令：开 / 关 / 状态 / 重置 / 默认查询
        let sysText: string | null = null;
        if (/^[/／]心情\s*(开|开启|启动|on|enable|启用)/i.test(trimmed)) {
          this.emotion.setEnabled(true);
          sysText = '【系统提示】用户让你开启情绪感知。请自然回应"已开启"，并简短说明现在能感知心情了。';
        } else if (/^[/／]心情\s*(关|关闭|off|disable|停用)/i.test(trimmed)) {
          this.emotion.setEnabled(false);
          sysText = '【系统提示】用户让你关闭情绪感知。请自然回应"已关闭"，说明之后不再带情绪语气了。';
        } else if (/状态|status/i.test(trimmed)) {
          sysText = '【系统提示】用户问情绪模块开关状态，据实回答（不要编造）：情绪感知当前'
            + (this.emotion.isEnabled() ? '已开启。' : '已关闭。');
        } else if (/重置|reset/i.test(trimmed)) {
          this.emotion.reset();
          sysText = '【系统提示】用户让你重置心情，请自然回应：心情已重置回平静。';
        } else {
          // 纯 /心情：回答当前心情
          sysText = '【系统提示】用户问你心情如何，请如实、自然地回答，不要编造：\n' + this.emotion.describe();
        }
        try {
          void host.pushEvent({ type: 'system', ts: eventTs(this.config.timezone), source: SOURCE, text: sysText });
        } catch { /* ignore */ }
      } else if (this.emotion.isEnabled()) {
        // 普通发言且情绪开启：自然语言问心情 → 回答；否则 → 感知
        if (this.emotion.isQuery(text)) {
          try {
            void host.pushEvent({
              type: 'system',
              ts: eventTs(this.config.timezone),
              source: SOURCE,
              text: '【系统提示】用户问你心情如何，请如实、自然地回答，不要编造：\n' + this.emotion.describe(),
            });
          } catch { /* ignore */ }
        } else {
          void this.emotion.perceive(text, sender.name).catch((e) => this.log.warn('情绪感知失败 ' + String(e)));
        }
      }
    }
    // 合并转发：异步展开内容作为补充事件（不阻塞主消息投递，对齐内置 lookupForward）
    const fwdSeg = segs.find((s) => s.type === 'forward');
    if (fwdSeg) {
      const fwdId = String((fwdSeg as { data: { id: string } }).data.id ?? '');
      if (fwdId) this.lookupForward(fwdId, conv, ev.message_id ?? '');
    }
    // 纯表情消息（无文字）：face 段无 url 无法收藏但仍需进入处理链（避免静默丢弃）；
    // sticker/image 段会在下方循环里判定是否收藏。
    if (!text && !segs.some((s) => s.type === 'image' || s.type === 'record' || s.type === 'forward' || s.type === 'sticker' || s.type === 'face')) return;

    const blobs: BlobInput[] = [];
    for (const s of segs) {
      if (s.type === 'image' && (s.data as { url?: string }).url) {
        const url = (s.data as { url: string }).url!;
        const digest = url.split('?')[0];
        this.recentImages.push({ url, conv: conv.address, at: Date.now() });
        if (this.recentImages.length > 50) this.recentImages.shift();
        if (this.config.deliverImageAttachments && host.modelFacts.accepts('image/png')) {
          const bytes = await this.fetchBytes(url);
          if (bytes) blobs.push({ bytes, mime: 'image/jpeg', name: 'qq-image', fallbackText: '[图片]' });
        }
        if (this.config.vision.enabled && !this.host?.isPaused?.()) {
          try {
            const descP = Promise.resolve(this.vision.register(url, Date.now() + 60_000));
            const desc = await Promise.race([
              descP,
              new Promise<string | null>((res) => setTimeout(() => res(null), 2_500)),
            ]);
            if (desc) {
              if (text) text += '\n';
              text += `[图片内容（${conv.label}）]：${desc}`;
            }
          } catch (e) {
            this.log.warn('图片视觉描述失败 ' + String(e));
          }
        }
        // 图片作为表情包收藏：该图片本身就得是表情（NapCat 推来的表情包常是 image 段，
        // 但 subType 往往为 null，仅靠 subType 会漏采；故同时认 summary 里的表情标记）。
        if (this.config.sticker.enabled && this.stickers) {
          const sd = s.data as { subType?: string; summary?: string };
          const summary = typeof sd.summary === 'string' ? sd.summary : '';
          const isStickerLike = sd.subType === 'sticker' || /\[?(动画)?表情|贴纸|sticker|emoji/i.test(summary);
          const asSticker = isStickerLike || this.config.sticker.captureMode === 'allImages';
          if (asSticker && !this.host?.isPaused?.()) {
            this.stickers.ingest(url, conv.address, summary);
          }
        }
      } else if (s.type === 'sticker' && (s.data as { url?: string }).url) {
        // 真实表情包段（type=sticker）必须在顶层处理，不能塞进 image 分支里。
        if (this.config.sticker.enabled && this.stickers) {
          const url = (s.data as { url: string }).url!;
          const sd = s.data as { subType?: string; summary?: string };
          const summary = typeof sd.summary === 'string' ? sd.summary : '';
          if (!this.host?.isPaused?.()) this.stickers.ingest(url, conv.address, summary);
        }
      } else if (s.type === 'record') {
        const url = (s.data as { url?: string }).url;
        let asText = false;
        if (this.config.voice.enabled && this.config.voice.asr) {
          const transcribed = await this.transcribeRecord(s, (ev as { message_id?: number }).message_id, this.driver, this.voiceRuntime(), this.log);
          if (transcribed) {
            if (text) text += '\n';
            text += `[语音转写] ${transcribed}`;
            asText = true;
          }
        }
        if (!asText && url && (this.config.voice.enabled ? this.config.voice.audioFallback : true)) {
          const wav = await this.decodeVoice(url);
          if (wav) blobs.push({ bytes: wav, mime: 'audio/wav', name: 'qq-voice', fallbackText: '[语音]' });
        }
      }
    }

    // 语义判定：是否应当用语音回复（对齐 qq_bot 的 _judge_voice）。
    if (this.config.voice.enabled && this.config.voice.tts && this.config.voice.semanticJudge && text.trim()) {
      const want = await judgeVoiceWish(text, this.voiceRuntime(), this.log);
      this.voiceWish.set(conv.address, want);
    }

    const baseMeta = {
      conv: conv.address,
      role: sender.role,
      user: sender.userId,
      atMe,
      card: sender.card,
      title: sender.title,
      platformMessageId: String(ev.message_id ?? ''),
      channel: 'qq',
    };

    if (conv.kind === 'private' && this.config.privateAggregationWindow > 0) {
      this.aggregatePrivate(conv, sender, text, blobs, baseMeta);
      return;
    }

    let sendClock = '';
    try { sendClock = shortTime(this.config.timezone, new Date((ev.time ?? Date.now() / 1000) * 1000)); } catch (e) { this.log.warn('shortTime FAIL ' + String(e)); }
    const senderTag = `${sender.name}(QQ:${sender.userId})`;
    const channelPrefix = conv.kind === 'group'
      ? `【QQ群 ${conv.label} ${sendClock}】${senderTag}`
      : `【QQ私聊 ${sendClock} ${senderTag}】`;
    // 把这条消息在 QQ 上的真实身份编号（#message_id）带进上下文：模型据此才能引用/回复
    // 任意一条历史消息（对齐内置 qq world 的 idTag 渲染）。在自己发消息时 qq_send 的返回里
    // 也会给 message_id，这里补上入站消息，使「引用消息」功能完整闭环。
    const idTag = ev.message_id != null ? `#${ev.message_id} ` : '';
    // 好感度：在用户消息之前，把该用户当前好感度作为内部上下文注入。
    // 仅在数值相对上次注入有变化、或首次遇到该用户时再注入，避免历史被同一行刷屏。
    if (this.affinity && this.config.affinity.enabled && sender.userId) {
      const key = String(sender.userId);
      const e = this.affinity.get(key);
      const score = e?.score ?? 0;
      if (this.affinityInjected.get(key) !== score) {
        this.affinityInjected.set(key, score);
        const name = e?.name || sender.name || `QQ ${key}`;
        const label = affinityLabel(score);
        const tone = score >= 20
          ? '高好感：可以更亲昵、放松、自然'
          : score <= -10
            ? '低/负好感：更客气、有分寸、保持距离，别硬凑'
            : '中性：正常有礼貌地相处即可';
        try {
          await host.pushEvent({
            type: 'qq.affinity',
            ts: eventTs(this.config.timezone, new Date((ev.time ?? Date.now() / 1000) * 1000)),
            source: SOURCE,
            origin: 'internal',
            text:
              `（关系备忘｜${name} QQ ${key}：好感度 ${score}/100，${label}。${tone}。` +
              `据此把握说话态度与分寸，但别生硬念数字、别刻意强调关系分。）`,
            senderKey: conv.address,
            meta: { conv: conv.address, role: 'system', affinity: score },
          }, { trigger: 'piggyback' });
        } catch (ie) {
          this.log.warn('好感度注入失败 ' + String(ie));
        }
      }
    }
    this.log.info('HANDLE_PUSH pre kind=' + conv.kind);
    // 记录“应当回复”的会话，供回合收束时兜底自动发送（模型若只输出文本未调 qq_send）。
    if (conv.kind === 'private' || atMe) this._pendingReplyConvs.add(conv.address);
    try {
      await host.pushEvent({
        type: 'qq.message',
        ts: eventTs(this.config.timezone, new Date((ev.time ?? Date.now() / 1000) * 1000)),
        source: SOURCE,
        text: `${channelPrefix}：${idTag}${text}`,
        senderKey: conv.address,
        meta: { ...baseMeta, sender: senderTag },
        blobs: blobs.length ? blobs : undefined,
        }, { trigger: atMe ? 'flush' : 'debounce' });
        this.log.info('HANDLE_PUSH ok');
    } catch (e) {
      this.log.error('HANDLE_PUSH FAIL ' + String(e));
    }
  }

  private aggregatePrivate(conv: Conv, sender: QQSenderBrief, text: string, blobs: BlobInput[], meta: Record<string, unknown>): void {
    const host = this.host!;
    const now = Date.now();
    const win = this.config.privateAggregationWindow;
    const senderTag = `${sender.name}(QQ:${sender.userId})`;
    const pend = conv.pendingAggregatedText;
    if (pend && now - pend.firstAt < win) {
      // 仍在窗口内：累积到暂存文本，已排定的到期冲刷计时器保持不变
      pend.text += `\n${senderTag}：${text}`;
      return;
    }
    // 窗口已过期（或无暂存）：先把上一段冲刷出去（如有），再开新的一段并排定到期冲刷
    if (pend) {
      if (conv.aggregationTimer) {
        clearTimeout(conv.aggregationTimer);
        conv.aggregationTimer = undefined;
      }
      this._pendingReplyConvs.add(conv.address);
      void host.pushEvent({
        type: 'qq.message',
        ts: eventTs(this.config.timezone, new Date(pend.firstAt)),
        source: SOURCE,
        text: pend.text,
        senderKey: conv.address,
        meta: { ...meta, sender: '对话' },
        blobs: undefined,
      });
    }
    conv.pendingAggregatedText = { text: `${senderTag}：${text}`, firstAt: now };
    const segMeta = meta;
    conv.aggregationTimer = setTimeout(() => {
      conv.aggregationTimer = undefined;
      if (!this.host) return;
      const p = conv.pendingAggregatedText;
      if (!p) return;
      conv.pendingAggregatedText = undefined;
      this._pendingReplyConvs.add(conv.address);
      void this.host.pushEvent({
        type: 'qq.message',
        ts: eventTs(this.config.timezone, new Date(p.firstAt)),
        source: SOURCE,
        text: p.text,
        senderKey: conv.address,
        meta: { ...segMeta, sender: '对话' },
        blobs: undefined,
      });
    }, win);
  }

  /**
   * 输出流接收器：实时累积模型本轮的“正文”文本（仅 output_text.delta，不含思考链/拒答）。
   * 用于回合收束时兜底把模型文本自动发往应回复的会话。
   */
  outputTap() {
    return {
      onEvent: (event: any): void => {
        if (event && event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          this._tapBuf += event.delta;
        }
      },
      onRoundEnd: (): void => {},
      onAbort: (): void => { this._tapBuf = ''; },
    };
  }

  /**
   * 回合收束钩子（框架在每轮结束都调用，含“模型只输出文本未调工具”的路径）。
   * 若本轮由“应回复”的入站消息触发、且模型没有对该会话调用 qq_send，
   * 则把模型生成的文本自动发往来源会话，避免“控制台有回复、QQ 收不到”。
   */
  onTurnEnded(): void {
    const buf = this._tapBuf.trim();
    const pending = [...this._pendingReplyConvs];
    // 仅当“单一待回复会话且本轮未对其发送、且有文本”时兜底，避免多消息歧义或串轮误发。
    if (pending.length === 1) {
      const conv = pending[0];
      if (!this._sentThisTurn.has(conv) && buf) {
        this.log.warn('兜底自动发送：入站消息未调 qq_send，按模型文本回复', { conv, len: buf.length });
        void this.sendTo(conv, buf).catch((e) => this.log.warn('兜底自动发送失败', { err: String(e) }));
      }
    }
    this._tapBuf = '';
    this._sentThisTurn.clear();
    this._pendingReplyConvs.clear();
  }

  /** 实时拉取被引用消息（对齐 fat-fish get_quoted_message 的 get_msg 路径）。 */
  private async resolveQuoted(rid: number): Promise<{ text?: string; ref?: string }> {
    if (!this.driver) return {};
    try {
      const r: any = await this.driver.callApi('get_msg', { message_id: rid });
      if (!r) return {};
      const sender = r.sender ?? {};
      const ref = sender.nickname || (sender.user_id != null ? String(sender.user_id) : undefined);
      const text = renderIncoming(r.message, { timezone: this.config.timezone, selfId: 0 });
      return { text: text || '', ref };
    } catch (e) {
      this.log.warn('获取引用消息失败', { err: String(e), rid });
      return {};
    }
  }

  private async handleNotice(ev: OneBotMessage): Promise<void> {
    const host = this.host!;
    const t = ev.notice_type;
    if (t === 'group_recall' || t === 'friend_recall') {
      const id = ev.group_id ?? ev.user_id ?? 0;
      const conv = this.ensureConv(ev.group_id ? 'group' : 'private', id);
      const who = ev.user_id ?? 0;
      await host.pushEvent({
        type: 'qq.recall',
        ts: eventTs(this.config.timezone),
        source: SOURCE,
        text: `${conv.label} 中 ${who} 撤回了一条消息`,
        senderKey: conv.address,
      });
    } else if (t === 'group_increase' || t === 'group_decrease') {
      const conv = this.ensureConv('group', ev.group_id ?? 0);
      const op = ev.operator_id ?? 0;
      const who = ev.user_id ?? 0;
      const verb = t === 'group_increase' ? '加入' : '退出';
      await host.pushEvent({
        type: 'qq.member',
        ts: eventTs(this.config.timezone),
        source: SOURCE,
        text: `${conv.label}：${who} ${verb}（操作者 ${op}）`,
        senderKey: conv.address,
      });
    } else if (t === 'notify') {
      const sub = ev.sub_type;
      const conv = this.ensureConv(ev.group_id ? 'group' : 'private', ev.group_id ?? ev.user_id ?? 0);
      if (sub === 'poke') {
        await host.pushEvent({
          type: 'qq.poke',
          ts: eventTs(this.config.timezone),
          source: SOURCE,
          text: `${conv.label}：${ev.user_id} 戳了 ${ev.target_id}`,
          senderKey: conv.address,
        });
      } else if (sub === 'emoji') {
        await host.pushEvent({
          type: 'qq.react',
          ts: eventTs(this.config.timezone),
          source: SOURCE,
          text: `${conv.label}：${ev.user_id} 对消息做了表情回应`,
          senderKey: conv.address,
        });
      }
    }
  }

  /** 从文本或显式 hint 解析引用消息编号（对齐内置 qq 的 #<id> 约定）。 */
  private resolveReplyMessageId(text: string, idHint?: number): number | undefined {
    if (idHint != null && Number.isFinite(idHint)) return idHint;
    // 注意：NapCat 推来的 message_id 偶发为负数（int32 溢出），#编号可能形如 #-158564853，
    // 故正则必须允许负号，否则引用这类消息时提取不到 id、引用失败。
    const m = String(text ?? '').match(/#(-?\d+)/);
    return m ? Number(m[1]) : undefined;
  }

  /** 校验被引用消息是否属于同一会话（跨会话引用会误发 quote，必须拒绝）。 */
  private sameConversation(conv: string, id: number): boolean {
    const m = this.knownMessages.get(String(id));
    return !!m && m.conv === conv;
  }

  /** 把「QQ 号或昵称」解析成真实 QQ 号。纯数字直接返回；群内昵称走成员名单缓存（懒加载）。 */
  private async resolveQQ(groupId: number | null, who: string): Promise<number | null> {
    const raw = String(who ?? '').replace(/^@/, '').trim();
    if (!raw) return null;
    if (/^\d{5,}$/.test(raw)) return Number(raw);
    if (groupId == null) return null;
    const idx = await this.ensureMemberIndex(groupId);
    return idx.get(raw.toLowerCase()) ?? null;
  }

  /** 懒加载某群成员昵称→QQ 索引（card/昵称/头衔都登记，小写匹配）。 */
  private async ensureMemberIndex(groupId: number): Promise<Map<string, number>> {
    const cached = this.memberIndex.get(groupId);
    if (cached) return cached;
    const idx = new Map<string, number>();
    if (this.driver) {
      const list = await this.driver.getGroupMemberList(groupId);
      for (const m of list) {
        const qq = Number(m.user_id);
        if (!qq) continue;
        if (m.card) idx.set(String(m.card).toLowerCase(), qq);
        if (m.nickname) idx.set(String(m.nickname).toLowerCase(), qq);
        if (m.title) idx.set(String(m.title).toLowerCase(), qq);
      }
    }
    this.memberIndex.set(groupId, idx);
    return idx;
  }

  /** 解析发送目标（对齐内置 qq 的 `to` 字符串：group:<id> / private:<id>）。 */
  private resolveTarget(to: string): { kind: 'group' | 'private'; id: number } | null {
    const m = String(to ?? '').match(/^(group|private):(\d+)$/);
    if (!m) return null;
    return { kind: m[1] as 'group' | 'private', id: Number(m[2]) };
  }

  /** 合并转发节点渲染结果（对齐内置 qq 的 ForwardNode）。 */
  private renderForwardNode(value: OneBotMessage): ForwardNode {
    const sender = value.sender ?? {};
    const uid = sender.user_id;
    const isSelf = uid !== undefined && this.identity !== null && uid === this.identity.selfId;
    const nickname = sender.nickname || sender.card;
    const named = isSelf || (nickname !== undefined && nickname !== '' && nickname !== PLACEHOLDER_NICKNAME);
    const name = isSelf ? '你' : nickname ?? (uid !== undefined ? String(uid) : '?');
    const body = typeof value.message === 'string' ? value.message : renderSegmentsPlain(value.message ?? []);
    return {
      line: `${name}${uid !== undefined ? `(${uid})` : ''}: ${body}`,
      body,
      named,
      time: value.time != null ? Number(value.time) : undefined,
      userId: uid !== undefined ? String(uid) : undefined,
      messageType: value.message_type,
    };
  }

  /** 转发节点是否都是匿名（身份塌缩）：此时无法分辨发言人，提示可能是多人。 */
  private forwardIdentityCollapsed(nodes: ForwardNode[]): boolean {
    if (nodes.length < 2 || nodes.some((n) => n.named)) return false;
    const ids = new Set(nodes.map((n) => n.userId));
    return ids.size === 1 && !ids.has(undefined);
  }

  /** 展开合并转发消息并作为补充事件投递（对齐内置 qq 的 lookupForward）。 */
  private lookupForward(resId: string, conv: Conv, ofMessageId: number | string): void {
    const driver = this.driver;
    const host = this.host;
    if (!driver || !host) return;
    void driver
      .getForwardMessages(resId, this.config.forwardExpandLimit)
      .then((nodes) => {
        if (!this.host) return;
        const rendered = nodes.map((n) => this.renderForwardNode(n));
        // 合并转发自身节点塌缩补回（NapCat 常把“你转发的内容”单独成段但省略身份，需补全为“你”）
        if (this.identity && !rendered.some((n) => n.userId != null && Number(n.userId) === this.identity!.selfId)) {
          rendered.unshift({
            line: `你(${this.identity.selfId}): （你在转发里发的内容）`,
            body: '（你在转发里发的内容）',
            named: true,
            userId: String(this.identity.selfId),
          });
        }
        const collapsed = this.forwardIdentityCollapsed(rendered);
        const body = rendered.length ? rendered.map((n) => n.line).join('\n') : '(转发记录是空的)';
        const header = collapsed
          ? `[系统] #${ofMessageId} 引用的转发消息展开如下（里面的发言人身份没能取到，可能是多个人在说话）：`
          : `[系统] #${ofMessageId} 引用的转发消息展开如下：`;
        void this.host.pushEvent({
          type: 'qq.forward',
          ts: eventTs(this.config.timezone),
          source: SOURCE,
          text: `${header}\n${body}`,
          senderKey: conv.address,
          meta: { conv: conv.address, forward_id: resId },
        });
      })
      .catch((err) => {
        this.log.warn('展开合并转发失败', { err: String(err), resId });
        if (!this.host) return;
        void this.host.pushEvent({
          type: 'qq.forward',
          ts: eventTs(this.config.timezone),
          source: SOURCE,
          text: `[系统] #${ofMessageId} 引用的转发消息展开失败：${String(err)}`,
          senderKey: conv.address,
          meta: { conv: conv.address, forward_id: resId },
        });
      });
  }

  // ---- 发送（草稿-确认门）----
  // ---- 群聊发言限速 / 话题防死循环 ----
  private groupSpeakWindow(address: string): number[] {
    const gs = this.config.groupSpeak;
    if (!gs.enabled || !address.startsWith('group:')) return [];
    const now = Date.now();
    const winMs = Math.max(1, gs.windowSec) * 1000;
    const stamps = (this.groupSpeakStamps.get(address) ?? []).filter((t) => now - t < winMs);
    this.groupSpeakStamps.set(address, stamps);
    return stamps;
  }
  /** 群聊发言频率限制：超过窗口上限返回拦截文案（带 SEND_BLOCKED 前缀），否则 null。 */
  private checkGroupSpeak(address: string): string | null {
    const gs = this.config.groupSpeak;
    if (!gs.enabled || !address.startsWith('group:')) return null;
    const stamps = this.groupSpeakWindow(address);
    if (stamps.length >= Math.max(1, gs.maxPerWindow)) {
      return QQWorld.SEND_BLOCKED + `群 ${this.convLabel(address)} 发言频率已达上限（${gs.maxPerWindow}/${gs.windowSec}s），先不说了。`;
    }
    return null;
  }
  private recordGroupSpeak(address: string): void {
    if (!this.config.groupSpeak.enabled || !address.startsWith('group:')) return;
    const stamps = this.groupSpeakStamps.get(address) ?? [];
    stamps.push(Date.now());
    this.groupSpeakStamps.set(address, stamps);
  }
  /** 话题自动结束 / 防死循环：连续发言超限或对方长时间静默则拦截，返回带 SEND_BLOCKED 前缀的文案。 */
  private checkAntiLoop(address: string): string | null {
    const al = this.config.antiLoop;
    if (!al.enabled) return null;
    const streak = this.botStreak.get(address) ?? 0;
    const lastUser = this.lastUserMsgAt.get(address);
    // 没有“对方发言基线”时不启用 idle 收尾，否则会话启动后 bot 发第一条就会被永久拦住
    const sinceUser = lastUser == null ? -1 : Date.now() - lastUser;
    if (streak >= al.maxConsecutiveBotTurns) {
      return QQWorld.SEND_BLOCKED + `该会话已连续发言 ${streak} 次，自动结束话题（等对方先开口再继续）。`;
    }
    if (al.idleToEndSec > 0 && streak >= 1 && sinceUser >= 0 && sinceUser > al.idleToEndSec * 1000) {
      return QQWorld.SEND_BLOCKED + `对方已静默 ${Math.round(sinceUser / 1000)}s，话题自动收尾，先不说了。`;
    }
    return null;
  }
  private recordAntiLoop(address: string): void {
    if (!this.config.antiLoop.enabled) return;
    this.botStreak.set(address, (this.botStreak.get(address) ?? 0) + 1);
  }

  private async sendTo(address: string, text: string, replyMessageId?: number, atQQs?: number[]): Promise<string> {
    if (!this.driver) return '未连接到 NapCat。';
    // 模型(尤其 DeepSeek)常在回复里把换行写成字面 "\n"(反斜杠+字母n 两字符)。
    // OneBot 会原样发到 QQ 显示成字符,故这里归一化为真实换行符。
    text = text.replace(/\\n/g, '\n');
    const norm = text.replace(/\s+/g, ' ').trim();
    const prev = this.dedupSends.get(address);
    if (prev && prev.norm === norm && Date.now() - prev.ts < 6000) {
      this.log.info('发送去重：跳过 6s 内同会话相同内容', { address, len: norm.length });
      return '（去重：与刚刚发送的内容相同，已跳过重复发送）';
    }
    const gl = this.checkGroupSpeak(address);
    if (gl) return gl;
    const al = this.checkAntiLoop(address);
    if (al) return al;
    const [kind, idStr] = address.split(':');
    const id = Number(idStr);
    const paramsBase: Record<string, unknown> =
      kind === 'group' ? { message_type: 'group', group_id: id } : { message_type: 'private', user_id: id };
    // 语音回复路径：语义判定认为应当说语音时，把文字合成语音发出。
    const wantVoice = this.config.voice.enabled && this.config.voice.tts && this.voiceWish.get(address) === true;
    this.voiceWish.delete(address);
    if (wantVoice) {
      const rec = await this.synthesizeVoice(text, address, this.driver, this.voiceRuntime(), this.log);
      if (rec) {
        const segs: Array<Record<string, unknown>> = [];
        if (replyMessageId != null) segs.push({ type: 'reply', data: { id: String(replyMessageId) } });
        if (atQQs && atQQs.length) for (const qq of atQQs) segs.push({ type: 'at', data: { qq: String(qq) } });
        segs.push(rec as unknown as Record<string, unknown>);
        try {
          const r: any = await this.driver.callApi('send_msg', { ...paramsBase, message: segs });
          if (r?.message_id != null) {
            this.knownMessages.set(String(r.message_id), { conv: address, ts: Date.now() });
            this.scheduleSaveState();
          }
          this.recordGroupSpeak(address);
          this.recordAntiLoop(address);
          this.dedupSends.set(address, { norm, ts: Date.now() });
          return `已向 ${this.convLabel(address)} 发送语音 1 段。`;
        } catch (e) {
          this.log.warn('语音发送失败，回退文字', { err: String(e) });
        }
      } else {
        this.log.warn('TTS 合成失败，回退文字发送');
      }
    }

    const outgoing = buildOutgoing(text, this.emojiDirAbs);
    if (atQQs && atQQs.length) {
      for (const qq of atQQs) outgoing.unshift({ type: 'at', data: { qq: String(qq) } });
    }
    const messages = splitReplyIntoMessages(outgoing, {
      splitBySentence: this.config.splitReplyBySentence,
      sentencesPerMessage: this.config.sentencesPerMessage,
      maxBytes: this.config.maxMessageBytes,
    });
    if (replyMessageId != null && messages.length) {
      messages[0] = [{ type: 'reply', data: { id: String(replyMessageId) } }, ...messages[0]];
    }
    let ok = 0;
    let total = 0;
    const ids: string[] = [];
    for (const segs of messages) {
      const valid = segs.filter((s) => !(s.type === 'text' && !((s.data as { text?: string }).text ?? '').trim()));
      if (!valid.length) continue;
      total++;
      try {
        const r: any = await this.driver.callApi('send_msg', { ...paramsBase, message: valid });
        ok++;
        if (r?.message_id != null) {
          this.knownMessages.set(String(r.message_id), { conv: address, ts: Date.now() });
          ids.push(String(r.message_id));
          this.scheduleSaveState();
        }
      } catch (e) {
        this.log.warn('发送失败', { err: String(e), address });
      }
      if (this.config.sendIntervalMs > 0) await sleep(this.config.sendIntervalMs);
    }
    if (ok > 0) {
      this.recordGroupSpeak(address);
      this.recordAntiLoop(address);
      this.dedupSends.set(address, { norm, ts: Date.now() });
    }
    const tail = ids.length ? `（message_id: ${ids.join(', ')}，可用 #编号 引用回复）` : '';
    return `已向 ${this.convLabel(address)} 发送 ${ok}/${total} 段。${tail}`;
  }

  /** 包装宿主：在 pushEvent 后向控制台事件流广播（仅广播本扩展产生的事件）。 */
  private wrapHost(host: WorldHost): WorldHost {
    const base = host;
    const self = this;
    return {
      ...base,
      async pushEvent(e, opts) {
        const saved = await base.pushEvent(e, opts);
        if (saved.source === SOURCE) self.broadcastEvent(saved);
        return saved;
      },
    };
  }

  // ---- 工具 ----
  tools(): ToolDef[] {
    const send: ToolDef = {
      name: 'qq_send',
      tags: ['speak'],
      barrierAfter: true,
      endsTurn: true,
      description:
        '回复 QQ 消息事件的唯一渠道：发送一条发往 QQ 群或私聊的消息（不要用 terminal_send，那只会发到控制台终端）。调用即直接发送，无需再确认。to 直接填事件 meta 里的 conv 字段：群聊为 "group:<群号>"，私聊为 "private:<QQ号>"。',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: '发送目标，原样复制事件 meta 里的 conv 字段。群聊填 "group:<群号>"，私聊填 "private:<QQ号>"。' },
          text: { type: 'string', description: '要发送的消息正文。可用 #编号 引用回复某条消息。' },
          reply_message_id: { type: 'number', description: '可选：引用回复的目标消息编号（也可在 text 里写 #编号）。每条收到的消息行首都带有它的 #编号（即该消息在 QQ 上的真实身份），想引用某条消息就填它的编号；必须是同一会话内的消息，否则会被拒绝。' },
          at: { type: 'array', items: { type: 'string' }, description: '可选：要 @ 的人，元素为 QQ 号或群内昵称（如 "123456" 或 "张三"）。发送时会在开头插入 @。' },
        },
        required: ['to', 'text'],
      },
      handler: async (args, ctx) => {
        const to = String(args.to ?? '').trim();
        const text = String(args.text ?? '').trim();
        this.log.info('qq_send调用参数', { to, textLength: text.length });
        if (!text) return 'text 不能为空。';
        const target = this.resolveTarget(to);
        if (!target) return 'to 格式应为 "group:<群号>" 或 "private:<QQ号>"（直接复制事件 meta 里的 conv 字段，不要自己改）。';
        const address = `${target.kind}:${target.id}`;
        this._sentThisTurn.add(address); // 标记本轮已对该会话发送，兜底逻辑据此跳过重复发送
        if (!this.isListened(target.kind, target.id)) {
          return `该${target.kind === 'group' ? '群' : '私聊'}不在监听名单内，无法发送。请先用控制台加入监听。`;
        }
        const atRaw = Array.isArray(args.at) ? args.at.map((x: unknown) => String(x)) : [];
        let atQQs: number[] = [];
        if (atRaw.length) {
          const groupId = target.kind === 'group' ? target.id : null;
          const resolved = await Promise.all(atRaw.map((w) => this.resolveQQ(groupId, w)));
          atQQs = resolved.filter((q): q is number => q != null);
          const failed = atRaw.filter((_, i) => resolved[i] == null);
          if (failed.length) this.log.warn('qq_send @ 解析失败（已跳过）', { failed });
        }
        const rid = this.resolveReplyMessageId(text, args.reply_message_id != null ? Number(args.reply_message_id) : undefined);
        if (rid !== undefined && !this.sameConversation(address, rid)) {
          return `[send failed] 引用消息 #${rid} 属于其他会话，不能作为「${this.convLabel(address)}」的引用回复。`;
        }
        const id = `d${Math.random().toString(36).slice(2, 8)}`;
        this.pendingSends.set(id, { address, label: this.convLabel(address), text, createdAt: Date.now(), replyMessageId: rid, sent: false });
        // 直接发送（去掉强制草稿门：LLM 起草后常常不调 qq_confirm_send，导致消息发不出去）
        const res = await this.sendTo(address, text, rid, atQQs);
        const entry = this.pendingSends.get(id);
        if (entry) entry.sent = true;
        // 暂停期间已到达的外部事件先排到下一轮
        if (this.host && typeof (this.host as { drainPendingEvents?: unknown }).drainPendingEvents === 'function') {
          const drained = await this.host.drainPendingEvents(
            (e) => e.source === SOURCE && !(e.type === 'qq.message' && (e as { senderKey?: string }).senderKey === address)
          );
          ctx?.queueExternalEvents?.(drained);
        }
        if (res.startsWith(QQWorld.SEND_BLOCKED)) {
          return `未能发送（编号 ${id}）到 ${this.convLabel(address)}：${res.slice(QQWorld.SEND_BLOCKED.length)}\n${rid !== undefined ? `（引用回复 #${rid} 未发出）\n` : ''}`;
        }
        return `已发送（编号 ${id}）到 ${this.convLabel(address)}：${res}\n${rid !== undefined ? `（已绑定引用回复 #${rid}）\n` : ''}`;
      },
    };

    const confirm: ToolDef = {
      name: 'qq_confirm_send',
      tags: ['speak'],
      barrierAfter: true,
      description: '（兼容别名）qq_send 现已直接发送，通常无需调用本工具；仅当仍有未发送草稿时可补发。',
      parameters: {
        type: 'object',
        properties: {
          draft: { type: 'string', description: 'qq_send 返回的草稿编号；留空则发送最近一条草稿。' },
        },
        required: [],
      },
      handler: async (args) => {
        const id = typeof args.draft === 'string' && args.draft ? args.draft : Array.from(this.pendingSends.keys()).pop();
        if (!id || !this.pendingSends.has(id)) return '没有待确认的草稿（qq_send 现已直接发送，通常无需调用本工具）。';
        const p = this.pendingSends.get(id)!;
        if (p.sent) return '该草稿已由 qq_send 直接发送，无需重复确认。';
        this.pendingSends.delete(id);
        return await this.sendTo(p.address, p.text, p.replyMessageId);
      },
    };

    const viewImage: ToolDef = {
      name: 'qq_view_image',
      tags: ['read'],
      barrierAfter: true,
      description:
        '主动重新看一张刚收到的 QQ 图片（当被动视觉没拿到描述、或你想细看时）。不传 url 则看最近收到的一张；也可传 url 指定任意图片链接。返回图片的文字描述。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '可选：要查看的图片链接；留空则取最近收到的一张。' },
          index: { type: 'number', description: '可选：取最近图片缓冲里的第几条（从 0 起，默认最后一条）。' },
        },
        required: [],
      },
      handler: async (args) => {
        if (!this.config.vision.enabled) return '被动视觉未开启（config.vision.enabled=false），无法看图。';
        let url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : '';
        if (!url) {
          const idx = typeof args.index === 'number' && Number.isFinite(args.index) ? args.index : this.recentImages.length - 1;
          const rec = this.recentImages[idx];
          if (!rec) return '还没有收到过任何图片，无法查看。';
          url = rec.url;
        }
        const desc = await this.vision.viewImage(url);
        return desc ? `图片描述：${desc}` : '看图失败（下载或视觉端点异常，可稍后重试）。';
      },
    };

    const stickerStats: ToolDef = {
      name: 'qq_sticker_stats',
      tags: ['read'],
      barrierAfter: true,
      description:
        '查看已自动收藏的表情包统计：总数、按情感分布、最近若干条（含情感/用处/标签/文件名）。想给 QQ 回复发表情包图片时，先调本工具拿到真实文件名（返回里的 [表情包:xxx.jpg]），再把整段 [表情包:文件名] 写进回复文本即可自动发出；不要编造不存在的文件名。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: '返回最近几条，默认 10。' } },
        required: [],
      },
      handler: async (args) => {
        this.log.info('调用 qq_sticker_stats');
        if (!this.stickers) return '表情包收藏未启用。';
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(50, args.limit)) : 10;
        const s = this.stickers.stats(limit);
        const lines = s.recent.map(
          (m) =>
            `- [表情包:${m.file}] ${m.label}（情感:${m.emotion} / 用处:${m.usage}${m.tag ? ' / 标签:' + m.tag : ''} / 出现${m.count}次）`,
        );
        const byEmo = Object.entries(s.byEmotion).map(([k, v]) => `${k}:${v}`).join('，') || '无';
        return `已收藏表情包共 ${s.total} 张；情感分布：${byEmo}\n最近：\n${lines.join('\n') || '（暂无）'}`;
      },
    };

    const proactiveStatus: ToolDef = {
      name: 'qq_proactive_status',
      tags: ['read'],
      barrierAfter: true,
      description: '查看主动说话调度器状态：运行态（暖场/稳定/静默）、今日已发/配额、各会话未回复与静默情况、最近主动说过的话。',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        if (!this.proactive) return '主动说话调度器未启用。';
        const s = this.proactive.status(this.proactiveTargets().length);
        const per = Object.entries(s.perAddr)
          .map(([a, v]) => `- ${a}：态=${v.state} 未回复=${v.unreplied}${v.silentUntil ? ' 静默至=' + new Date(v.silentUntil).toISOString() : ''}`)
          .join('\n') || '（无会话状态）';
        const recent = s.recent.length ? s.recent.slice(-5).map((t, i) => `  ${i + 1}. ${t}`).join('\n') : '（暂无）';
        return `主动说话：${s.runState}；今日 ${s.dailyCount}/${s.dailyQuota}；可主动会话 ${s.targets}\n会话状态：\n${per}\n最近主动说过：\n${recent}`;
      },
    };

    const proactiveTrigger: ToolDef = {
      name: 'qq_proactive_trigger',
      tags: ['speak'],
      barrierAfter: true,
      description: '手动触发一次主动说话：随机挑一个可主动的监听会话（或指定 address 如 private:123）发一条闲聊。用于测试主动说话调度器。',
      parameters: {
        type: 'object',
        properties: { address: { type: 'string', description: '可选：目标会话地址，如 private:123 / group:456；留空则随机。' } },
        required: [],
      },
      handler: async (args) => {
        if (!this.proactive) return '主动说话调度器未启用（先在控制台开 worlds.qqbot.proactive.enabled）。';
        const addr = typeof args.address === 'string' && args.address ? args.address : undefined;
        return this.proactive.trigger(addr);
      },
    };

    const qzonePost: ToolDef = {
      name: 'qq_qzone_post',
      tags: ['speak'],
      barrierAfter: true,
      description:
        '在 QQ 空间发一条动态（说说）。内容按「最近聊天 + 你对人或事的真实看法」自己生成：可省略 content 让它自动按对话与记忆发挥（topic 给方向，如“吐槽最近的天气/介绍某人”）；也可直接给 content 发你写好的。可附图片（images：file://、http(s):// 或 base64:// 链接）与 @人（ats：昵称或 QQ 号）。permission 默认 1=公开。返回 tid 供后续删除/回复。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '动态正文；留空则自动生成（结合最近聊天与记忆，以第一人称发表看法/吐槽/简介）。' },
          topic: { type: 'string', description: '自动生成时的方向提示，如「吐槽最近的天气」「介绍一下小明」。' },
          images: { type: 'array', items: { type: 'string' }, description: '附图链接数组（file:// / http(s):// / base64://）。' },
          ats: { type: 'array', items: { type: 'string' }, description: '@的人：昵称或 QQ 号数组。' },
          permission: { type: 'number', description: '可见权限 ugc_right，默认 1=公开。' },
        },
        required: [],
      },
      handler: async (args) => {
        if (!this.qzone) return 'QQ空间动态未启用（先在控制台开 worlds.qqbot.qzone.enabled 并重启）。';
        const r = await this.qzone.post({
          content: typeof args.content === 'string' ? args.content : undefined,
          topic: typeof args.topic === 'string' ? args.topic : undefined,
          images: Array.isArray(args.images) ? args.images.filter((x) => typeof x === 'string') : undefined,
          ats: Array.isArray(args.ats) ? args.ats.filter((x) => typeof x === 'string') : undefined,
          permission: typeof args.permission === 'number' ? args.permission : undefined,
        });
        return r.ok
          ? `已发 QQ空间动态。tid=${r.tid ?? '(未知)'}；内容：${r.text ?? ''}`
          : `发 QQ空间动态失败：${r.error ?? '未知错误'}`;
      },
    };

    const qzoneDelete: ToolDef = {
      name: 'qq_qzone_delete',
      tags: ['speak'],
      barrierAfter: true,
      description: '删除一条 QQ 空间动态。tid 来自 qq_qzone_post 的返回或 qq_qzone_status 的最近列表。',
      parameters: {
        type: 'object',
        properties: { tid: { type: 'string', description: '要删除的动态 tid。' } },
        required: ['tid'],
      },
      handler: async (args) => {
        if (!this.qzone) return 'QQ空间动态未启用。';
        const tid = String(args.tid ?? '');
        if (!tid) return '缺少 tid。';
        const r = await this.qzone.delete(tid);
        return r.ok ? `已删除 QQ空间动态 tid=${tid}。` : `删除失败：${r.error ?? '未知错误'}`;
      },
    };

    const qzoneReply: ToolDef = {
      name: 'qq_qzone_reply',
      tags: ['speak'],
      barrierAfter: true,
      description: '回复某条动态下的一条评论。tid 为动态 id，comment_id 为评论 id（来自 QQ空间评论事件或你记忆里 qq_qzone_status 的互动记录）。',
      parameters: {
        type: 'object',
        properties: {
          tid: { type: 'string', description: '动态 tid。' },
          comment_id: { type: 'string', description: '评论 id。' },
          content: { type: 'string', description: '回复内容。' },
        },
        required: ['tid', 'comment_id', 'content'],
      },
      handler: async (args) => {
        if (!this.qzone) return 'QQ空间动态未启用。';
        const tid = String(args.tid ?? '');
        const cid = String(args.comment_id ?? '');
        const content = typeof args.content === 'string' ? args.content : '';
        if (!tid || !cid || !content) return 'tid / comment_id / content 都不能为空。';
        const r = await this.qzone.replyComment(tid, cid, content);
        return r.ok ? `已回复 QQ空间评论（tid=${tid}, comment_id=${cid}）。` : `回复失败：${r.error ?? '未知错误'}（评论回复 action 名称可在控制台 qzone.commentAction 调整）`;
      },
    };

    const qzoneFeeds: ToolDef = {
      name: 'qq_qzone_feeds',
      tags: ['read'],
      barrierAfter: true,
      description: '查看自己的 QQ 空间动态列表（尽力而为；依赖 NapCat 的 get_qzone_msg_list 是否支持）。',
      parameters: {
        type: 'object',
        properties: { num: { type: 'number', description: '返回条数，默认 5。' } },
        required: [],
      },
      handler: async (args) => {
        if (!this.qzone) return 'QQ空间动态未启用。';
        const num = typeof args.num === 'number' && Number.isFinite(args.num) ? Math.max(1, Math.min(50, args.num)) : 5;
        const r = await this.qzone.getFeeds(num);
        if (!r.ok) return `获取动态列表失败：${r.error ?? '未知错误'}`;
        return `最近 ${num} 条动态：\n${JSON.stringify(r.feeds ?? []).slice(0, 2000)}`;
      },
    };

    const qzoneStatus: ToolDef = {
      name: 'qq_qzone_status',
      tags: ['read'],
      barrierAfter: true,
      description: '查看 QQ 空间动态发布器状态：是否开启、今日已发/配额、自动回复评论是否开、最近发的动态（含 tid）。',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        if (!this.qzone) return 'QQ空间动态未启用（先在控制台开 worlds.qqbot.qzone.enabled 并重启）。';
        const s = this.qzone.status();
        const posts = (s.lastPosts as Array<{ tid?: string; text: string }>).map((p) => `- tid=${p.tid ?? '?'}：${p.text}`).join('\n') || '（暂无）';
        return `QQ空间动态：开启=${s.enabled}；今日自动 ${s.dailyCount}/${s.dailyQuota}；自动回评=${s.autoReply}（今日 ${s.replyDailyCount}）；最近动态：\n${posts}`;
      },
    };

    const poke: ToolDef = {
      name: 'qq_poke',
      tags: ['speak'],
      barrierAfter: false,
      description:
        '戳一戳某个人（群戳一戳或私聊戳一戳）。target 为会话地址 group:<群号> 或 private:<QQ号>（原样复制事件 meta 的 conv）；user 为要戳的人的 QQ 号或群内昵称（私聊戳一戳时留空表示戳对话对象）。这是一个动作而非文字消息。',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: '会话地址，原样复制事件 meta 里的 conv 字段。' },
          user: { type: 'string', description: '要戳的人的 QQ 号或群内昵称；私聊戳一戳时留空表示戳对话对象。' },
        },
        required: ['target'],
      },
      handler: async (args) => {
        const to = String(args.target ?? '').trim();
        const target = this.resolveTarget(to);
        if (!target) return 'target 格式应为 "group:<群号>" 或 "private:<QQ号>"。';
        if (!this.isListened(target.kind, target.id)) return `该${target.kind === 'group' ? '群' : '私聊'}不在监听名单内，无法戳一戳。`;
        const driver = this.driver;
        if (!driver) return '未连接到 NapCat。';
        const groupId = target.kind === 'group' ? target.id : null;
        const userRaw = args.user != null ? String(args.user).replace(/^@/, '').trim() : '';
        let userId: number | null;
        if (!userRaw) {
          if (target.kind === 'private') userId = target.id;
          else return '群戳一戳需要指定 user（QQ 号或群内昵称）。';
        } else {
          userId = await this.resolveQQ(groupId, userRaw);
        }
        if (userId == null) return `无法把 "${userRaw}" 解析成 QQ 号（群内昵称需为该群成员；私聊只能填 QQ 号）。`;
        try {
          if (target.kind === 'group') await driver.callApi('group_poke', { group_id: target.id, user_id: userId });
          else await driver.callApi('friend_poke', { user_id: userId });
          // 把「自己戳了谁」作为内部事件回灌会话上下文：origin=internal 渲染进上下文但不
          // 唤醒回合（无回声），否则 bot 下一轮完全不记得是自己戳的，别人回"别戳我"时也接不上。
          try {
            const whoLabel = userRaw || '对话对象';
            const selfName = this.identity?.nickname ?? '肥鱼娘';
            const conv = this.convs.get(to);
            const label = conv?.label ?? (target.kind === 'group' ? String(target.id) : String(userId));
            const text = target.kind === 'group'
              ? `我是${selfName}。我刚才在QQ群「${label}」里戳了 ${whoLabel}（QQ ${userId}）。`
              : `我是${selfName}。我刚才在QQ私聊里戳了 ${whoLabel}（QQ ${userId}）。`;
            await this.host?.pushEvent({
              type: 'qq.message',
              ts: eventTs(this.config.timezone),
              source: SOURCE,
              origin: 'internal',
              text,
              senderKey: to,
              meta: { conv: to, role: 'assistant', self: true },
            }, { trigger: 'piggyback' });
          } catch (fe) {
            this.log.warn('qq_poke 回灌上下文失败 ' + String(fe));
          }
          return `已戳一戳 ${userRaw || '对话对象'}（QQ ${userId}）。`;
        } catch (e) {
          return `戳一戳失败：${String(e)}`;
        }
      },
    };

    // ---- 闹钟 / 记事本 ----
    const reminderAdd: ToolDef = {
      name: 'qq_reminder_add',
      tags: ['speak'],
      description:
        '记一个定时提醒 / 闹钟（也是记事本）。把需要以后做的事、约定、待办记下，到点会自动在该会话提醒对方。' +
        'when 支持：绝对 ISO 时间（如 2026-09-24T09:30）、"HH:MM"（今天，已过则明天）、"明天 9:00"、"in 30m" / "30分钟后" / "2小时后" / "3天后"。' +
        'text 是提醒内容。address 默认就是当前会话（一般不用填）；scope 可填“这是谁的事 / 相关人”等备注。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要提醒的内容，例如“提醒我三点开会”“和用户约好的事：明天还书”' },
          when: { type: 'string', description: '提醒时间，见上方描述里的格式（给一个未来的时间）' },
          address: { type: 'string', description: '可选，提醒发到哪个会话（group:群号 / private:QQ），默认当前会话' },
          scope: { type: 'string', description: '可选，备注（谁的事 / 相关人）' },
        },
        required: ['text', 'when'],
      },
      handler: async (req, args) => {
        const text = String(args.text ?? '').trim();
        const whenStr = String(args.when ?? '').trim();
        if (!text) return { error: 'text 不能为空' };
        const when = parseWhen(whenStr);
        if (when == null) {
          return { error: `无法解析时间：“${whenStr}”。支持 ISO、HH:MM、明天 9:00、in 30m、30分钟后 等。` };
        }
        if (when <= Date.now()) return { error: '这个时间已经过去了，请给一个未来的时间。' };
        const address = typeof args.address === 'string' && args.address.trim() ? args.address.trim() : req.address;
        const scope = typeof args.scope === 'string' ? args.scope.trim() : '';
        const r = this.reminders.add(text, when, { address, scope });
        return { text: `已记下提醒（id=${r.id}）：${text} @ ${formatWhen(when)}`, ok: true, id: r.id, content: text, when: formatWhen(when), whenMs: when, address };
      },
    };
    const reminderList: ToolDef = {
      name: 'qq_reminder_list',
      tags: ['read'],
      description: '列出当前所有未触发的提醒 / 记事（闹钟清单），用于向用户汇报“你记了这些事”。返回每条的 id、内容、时间。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const list = this.reminders.list(true);
        if (!list.length) return { text: '当前没有待提醒/记事。', ok: true, count: 0, reminders: [] };
        return {
          text: `共 ${list.length} 条待提醒/记事：` + list.map((r) => `- [${r.id}] ${r.text} @ ${formatWhen(r.when)}`).join('\n'),
          ok: true,
          count: list.length,
          reminders: list.map((r) => ({ id: r.id, text: r.text, when: formatWhen(r.when), address: r.address || '', scope: r.scope || '' })),
        };
      },
    };
    const reminderCancel: ToolDef = {
      name: 'qq_reminder_cancel',
      tags: ['speak'],
      description: '取消 / 删除一条提醒（记事）。传要删的 id（来自 qq_reminder_list 或 add 时返回的 id）。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: '要取消的提醒 id' } },
        required: ['id'],
      },
      handler: async (_req, args) => {
        const id = String(args.id ?? '').trim();
        if (!id) return { error: 'id 不能为空' };
        const ok = this.reminders.remove(id);
        return ok ? { text: `已取消提醒 ${id}。`, ok: true, removed: id } : { error: `没找到 id=${id} 的提醒` };
      },
    };
    const affinityAdjust: ToolDef = {
      name: 'qq_affinity_adjust',
      tags: ['speak'],
      description:
        '调整你对某个用户的好感度（关系分）。好感度是每个人独立的、可在正负间浮动的数字（范围 -100~100，初始 0=普通），' +
        '做让人舒服/投缘的事就加，做让人反感/越界的事就减——不是只增不减。delta 为正数增加、负数减少（如 +5 / -10 / 20）。' +
        'who 填对方 QQ 号（群聊里必须指定；私聊不填则默认对方）。reason 可选，记一笔这次加减的原因（会进好感度档案）。' +
        '调整后好感度会随下一条该用户的消息自动注入对话上下文，影响你后续的态度与分寸。',
      inputSchema: {
        type: 'object',
        properties: {
          who: { type: 'string', description: '对方 QQ 号（纯数字字符串）。群聊必填；私聊可省略（默认当前私聊对象）。' },
          delta: { type: 'number', description: '好感度变化量，正数加、负数减，如 5、-10、20' },
          reason: { type: 'string', description: '可选，这次加减的原因（如“帮我解决了个问题”“阴阳怪气了我”）' },
        },
        required: ['delta'],
      },
      handler: async (req, args) => {
        const delta = Number(args.delta);
        if (!Number.isFinite(delta) || delta === 0) return { error: 'delta 必须是非零数字（正数加、负数减）' };
        const who = typeof args.who === 'string' ? args.who.trim() : '';
        let key: string | undefined;
        if (who) {
          if (!/^\d+$/.test(who)) return { error: 'who 必须是纯 QQ 号数字（群聊里请填对方 QQ 号）。' };
          key = who;
        } else {
          const addr = req.address ?? '';
          if (addr.startsWith('private:')) key = addr.slice('private:'.length);
          else return { error: '群聊里调整好感度必须指定 who（对方 QQ 号）。' };
        }
        if (!key) return { error: '无法确定要对谁调整好感度。' };
        const reason = typeof args.reason === 'string' ? args.reason.trim() : undefined;
        const before = this.affinity?.get(key)?.score ?? 0;
        const e = this.affinity?.adjust(key, delta, reason) ?? { score: before, name: key, updatedAt: 0 };
        const label = affinityLabel(e.score);
        try {
          await this.host?.pushEvent({
            type: 'qq.affinity',
            ts: eventTs(this.config.timezone),
            source: SOURCE,
            origin: 'internal',
            text:
              `（关系更新｜QQ ${key}：好感度由 ${before} 变为 ${e.score}/100，${label}` +
              `${reason ? `（原因：${reason}）` : ''}。据此把握后续态度与分寸。）`,
            senderKey: req.address ?? '',
            meta: { conv: req.address ?? '', role: 'system', affinity: e.score },
          }, { trigger: 'piggyback' });
        } catch (fe) {
          this.log.warn('好感度回灌失败 ' + String(fe));
        }
        const summary = `好感度已更新：QQ ${key} 由 ${before} 变为 ${e.score}/100（${label}）${reason ? `（原因：${reason}）` : ''}`;
        return { text: summary, ok: true, qq: key, before, delta, score: e.score, label, reason: reason ?? '' };
      },
    };
    const affinityGet: ToolDef = {
      name: 'qq_affinity_get',
      tags: ['read'],
      description: '查询某个用户当前的好感度（关系分）。who 填 QQ 号；省略则默认当前私聊对象（群聊需指定）。',
      inputSchema: {
        type: 'object',
        properties: { who: { type: 'string', description: '对方 QQ 号；群聊必填，私聊可省略' } },
        required: [],
      },
      handler: async (req, args) => {
        const who = typeof args.who === 'string' ? args.who.trim() : '';
        let key: string | undefined;
        if (who) {
          if (!/^\d+$/.test(who)) return { error: 'who 必须是纯 QQ 号数字。' };
          key = who;
        } else {
          const addr = req.address ?? '';
          if (addr.startsWith('private:')) key = addr.slice('private:'.length);
          else return { error: '群聊里查询好感度必须指定 who（对方 QQ 号）。' };
        }
        const e = this.affinity?.get(key ?? '');
        if (!e) return { text: `QQ ${key}：好感度 0/100（普通，还没有记录）。`, ok: true, qq: key, score: 0, label: affinityLabel(0), note: '还没有记录，视为普通（0）' };
        const summary = `QQ ${key}（${e.name ?? ''}）：好感度 ${e.score}/100（${affinityLabel(e.score)}）${e.lastReason ? `；上次：${e.lastReason}` : ''}`;
        return { text: summary, ok: true, qq: key, score: e.score, label: affinityLabel(e.score), name: e.name ?? '', note: e.note ?? '', lastReason: e.lastReason ?? '' };
      },
    };
    const affinityList: ToolDef = {
      name: 'qq_affinity_list',
      tags: ['read'],
      description: '列出你对所有用户的好感度（关系分），按从高到低排序；用于了解“谁跟我现在关系好/不好”。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const list = this.affinity?.list() ?? [];
        if (!list.length) return { text: '还没有记录任何人的好感度（都视为普通 0）。', ok: true, count: 0, entries: [] };
        const text = '好感度总览（高→低）：\n' + list.map((e) => `- QQ ${e.key}（${e.name ?? ''}）：${e.score}/100 ${affinityLabel(e.score)}`).join('\n');
        return {
          text,
          ok: true,
          count: list.length,
          entries: list.map((e) => ({ qq: e.key, name: e.name ?? '', score: e.score, label: affinityLabel(e.score), lastReason: e.lastReason ?? '' })),
        };
      },
    };

    // ---- 智能体私人笔记本（记忆插件启用时路由到记忆库，否则本地 notebook.jsonl）----
    const noteSave: ToolDef = {
      name: 'qq_note_save',
      tags: ['write'],
      description:
        '把你想长期记住的东西写进「私人笔记本」——任何你（智能体）想记的事：对某个人的观感、一条约定、一个灵感、' +
        '用户叮嘱的偏好、自己立下的小目标等。记忆插件(cortico-world-memory)启用时，笔记会进它的记忆库并常驻进你的环境提示词；' +
        '没启用时落到本地笔记本文件。text 填要记的内容（尽量具体、自包含，日后回看能懂）。',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: '要记的内容' } },
        required: ['text'],
      },
      handler: async (_req, args) => {
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        if (!text) return { error: 'text 不能为空' };
        const r = await this.notebook.save(text);
        const where = r.backend === 'memory' ? '记忆插件(常驻环境提示词)' : '本地笔记本';
        const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
        return { text: `已记到笔记本（${where}）：${preview}`, ok: true, id: r.id, backend: r.backend };
      },
    };
    const noteList: ToolDef = {
      name: 'qq_note_list',
      tags: ['read'],
      description: '列出私人笔记本里的全部条目（记忆插件模式下为记忆库 qq 域；本地模式下为 notebook.jsonl）。用于回看你记过什么。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const entries = await this.notebook.list();
        if (!entries.length) return { text: '笔记本还是空的，还没记过东西。', ok: true, count: 0, backend: this.notebook.backend, entries: [] };
        const lines = entries.map((e) => `${e.seq != null ? e.seq + '. ' : '- '}${e.text}`);
        const where = this.notebook.backend === 'memory' ? '记忆插件(qq 域)' : '本地笔记本';
        return { text: `笔记本（${where}）共 ${entries.length} 条：\n` + lines.join('\n'), ok: true, count: entries.length, backend: this.notebook.backend, entries: entries.map((e) => ({ id: e.id, text: e.text, ts: e.ts })) };
      },
    };
    const noteGet: ToolDef = {
      name: 'qq_note_get',
      tags: ['read'],
      description: '按 id 查看某条笔记本内容。id 来自 qq_note_list 的编号/条目 id。',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: '条目 id' } }, required: ['id'] },
      handler: async (_req, args) => {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) return { error: 'id 不能为空' };
        const e = await this.notebook.get(id);
        if (!e) return { text: `没找到 id=${id} 的笔记。`, ok: true, found: false };
        return { text: `笔记 #${id}：${e.text}`, ok: true, found: true, id: e.id, content: e.text, ts: e.ts };
      },
    };
    const noteForget: ToolDef = {
      name: 'qq_note_forget',
      tags: ['write'],
      description: '删除一条笔记本（你确定不再需要它时）。id 来自 qq_note_list 的编号/条目 id。',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: '条目 id' } }, required: ['id'] },
      handler: async (_req, args) => {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) return { error: 'id 不能为空' };
        const ok = await this.notebook.forget(id);
        return ok ? { text: `已删除笔记本 #${id}。`, ok: true, id } : { text: `没找到 id=${id} 的笔记，未删除。`, ok: true, found: false };
      },
    };

    return [send, confirm, viewImage, stickerStats, proactiveStatus, proactiveTrigger, qzonePost, qzoneDelete, qzoneReply, qzoneFeeds, qzoneStatus, poke, reminderAdd, reminderList, reminderCancel, affinityAdjust, affinityGet, affinityList, noteSave, noteList, noteGet, noteForget, ...makeHistoryTools({
      getHost: () => this.host,
      sourceId: SOURCE,
      timezone: this.config.timezone,
      convLabel: (a) => this.convLabel(a),
    })];
  }

  // ---- 控制台 ----
  console(): WorldConsoleDecl {
    const lamps: WorldLamp[] = [
      {
        label: 'NapCat 连接',
        state: this.connected ? 'online' : this.config.mode === 'reverse' ? 'loading' : 'offline',
        hint: this.connected ? '已连接' : this.config.mode === 'reverse' ? '等待 NapCat 反向连入' : '未连接',
      },
      {
        label: '身份',
        state: this.identity ? 'online' : 'offline',
        hint: this.identity ? `QQ ${this.identity.selfId}（${this.identity.nickname}）` : '未加载',
      },
      {
        label: 'QQ空间动态',
        state: this.qzone ? 'online' : 'offline',
        hint: this.qzone ? `开启（今日 ${this.qzone.status().dailyCount}/${this.qzone.status().dailyQuota}${this.qzone.status().autoReply ? '，自动回评开' : ''}）` : '未开启',
      },
      {
        label: '群聊限速/防死循环',
        state: this.config.groupSpeak.enabled || this.config.antiLoop.enabled ? 'online' : 'offline',
        hint: `群发言限速=${this.config.groupSpeak.enabled ? `${this.config.groupSpeak.maxPerWindow}/${this.config.groupSpeak.windowSec}s` : '关'}；话题防死循环=${this.config.antiLoop.enabled ? `连续≤${this.config.antiLoop.maxConsecutiveBotTurns}/静默${this.config.antiLoop.idleToEndSec}s收尾` : '关'}`,
      },
      {
        label: '情绪系统',
        state: this.emotion?.isEnabled() ? 'online' : 'offline',
        hint: this.emotion?.isEnabled() ? '已启用·每轮注入全局上下文' : '未启用',
      },
      {
        label: '闹钟/记事本',
        state: this.config.reminder.enabled ? 'online' : 'offline',
        hint: this.config.reminder.enabled
          ? `到点提醒开·待提醒 ${this.reminders?.list(true).length ?? 0} 条`
          : '记录/查询可用，但到点自动提醒已关',
      },
      {
        label: '好感度',
        state: this.config.affinity.enabled ? 'online' : 'offline',
        hint: this.config.affinity.enabled
          ? `开启·已记录 ${this.affinity?.count() ?? 0} 人（每用户独立、可正可负、随互动浮动）`
          : '未开启',
      },
    ];
    const panels: WorldPanelDecl[] = [
      { id: 'roster', title: '监听名单', description: '当前监听的群与私聊及未读情况。', getMethods: ['getRoster'] },
      { id: 'events', title: '实时事件', description: 'QQ 消息与通知的实时流。' },
    ];
    return {
      label: 'QQ 群聊',
      lamps,
      badges: [
        { label: '自身 QQ', value: this.identity?.selfId ?? '-', tone: 'on' },
        { label: '监听会话', value: this.convs.size, tone: 'on' },
        { label: '表情包', value: this.stickers?.size ?? 0, tone: 'on' },
        { label: '主动', value: this.proactive?.status().runState ?? '关', tone: this.proactive?.status().enabled ? 'on' : 'plain' },
        { label: '空间动态', value: this.qzone ? '开' : '关', tone: this.qzone ? 'on' : 'plain' },
        { label: '群限速', value: this.config.groupSpeak.enabled ? `开(${this.config.groupSpeak.maxPerWindow}/${this.config.groupSpeak.windowSec}s)` : '关', tone: this.config.groupSpeak.enabled ? 'on' : 'plain' },
        { label: '防死循环', value: this.config.antiLoop.enabled ? `开(≤${this.config.antiLoop.maxConsecutiveBotTurns})` : '关', tone: this.config.antiLoop.enabled ? 'on' : 'plain' },
        { label: '模式', value: this.config.mode === 'reverse' ? '反向' : '正向', tone: 'plain' },
        { label: '情绪', value: this.emotion?.isEnabled() ? '开' : '关', tone: this.emotion?.isEnabled() ? 'on' : 'plain' },
        { label: '好感度', value: this.affinity?.count() ?? 0, tone: this.config.affinity.enabled ? 'on' : 'plain' },
      ],
      panels,
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      stream: (panel, socket) => this.stream(panel, socket),
      promptDocs: [
        {
          key: 'worlds.qqbot.envPrompt',
          title: 'QQ 环境描述',
          description: '注入 system 前缀的 QQ 身份与监听名单说明。',
          role: 'envPrompt',
          path: ENV_PROMPT_FILE,
          vars: [
            { name: 'qq.self', description: '当前 QQ 身份说明。' },
            { name: 'qq.activeGroups', description: '正在监听的群列表。', multiline: true },
            { name: 'qq.activePrivates', description: '正在监听的私聊列表。', multiline: true },
            { name: 'qq.unread', description: '未读摘要。' },
            { name: 'qq.now', description: '当前时间（时区见配置），用于回答"现在几点/星期几/几号"等问题。' },
            { name: 'qq.qzone', description: 'QQ 空间动态能力说明（是否开启、可用工具）。', multiline: true },
            { name: 'qq.groupSpeak', description: '群聊发言限速说明（是否开启、窗口与上限）。' },
            { name: 'qq.antiLoop', description: '话题防死循环规则说明（连续发言上限、静默收尾、何时该停）。' },
            { name: 'qq.affinity', description: '好感度（关系分）系统说明：每用户独立、可正可负、随互动浮动，及可用工具；当前好感度会在对话时注入上下文影响态度。', multiline: true },
            { name: 'qq.emotion', description: '当前情绪状态提示（心情值 + 主导情绪 + 行为引导），注入全局上下文。', multiline: true },
            { name: 'qq.routine', description: 'AI 作息说明（当前时段、是否在线/睡眠/午休，以及主动冒泡规则）。' },
          ],
        },
      ],
      config: [QQ_CONFIG_GROUP, QQ_VOICE_GROUP],
    };
  }

  private async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel === 'roster' && method === 'getRoster') {
      const list = [...this.convs.values()].map((c) => ({
        address: c.address,
        label: c.label,
        kind: c.kind,
        active: c.active,
        members: c.members?.size ?? 0,
        lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null,
      }));
      return { selfId: this.identity?.selfId ?? null, mode: this.config.mode, groups: toIds(this.config.groups), privates: toIds(this.config.privates), convs: list };
    }
    return { error: 'unknown method' };
  }

  private stream(panel: string, socket: WorldStreamSocket): void {
    if (panel !== 'events') {
      socket.close('no such stream');
      return;
    }
    this.eventSockets.add(socket);
    socket.onClose(() => this.eventSockets.delete(socket));
    // 先回放最近 20 条
    if (this.host) {
      const recent = this.host.store.range({ source: SOURCE, limit: 20 }).reverse();
      for (const e of recent) socket.send(JSON.stringify({ ts: e.ts, type: e.type, senderKey: e.senderKey, text: e.text }));
    }
  }

  private broadcastEvent(e: EventEnvelope): void {
    const payload = JSON.stringify({ ts: e.ts, type: e.type, senderKey: e.senderKey, text: e.text });
    for (const s of this.eventSockets) s.send(payload);
  }

  // ---- 环境提示词 ----
  envPromptVars(): Record<string, string> | null {
    const self = this.identity
      ? `你当前以 QQ 号 ${this.identity.selfId}（昵称「${this.identity.nickname}」）的身份在 QQ 上活动。`
      : 'QQ 身份尚未加载，等待 NapCat 连接。';
    const activeGroups = [...this.convs.values()].filter((c) => c.kind === 'group' && c.active);
    const activePrivates = [...this.convs.values()].filter((c) => c.kind === 'private' && c.active);
    const groupLines = activeGroups.map((c) => `- ${c.label}（群号 ${c.id}）`).join('\n') || '- 无';
    const privLines = activePrivates.map((c) => `- 与 ${c.label} 的私聊`).join('\n') || '- 无';
    const nowStr = this.nowText();
    const festivalLine = this.festivalLine();
    const qzoneLine = this.qzone
      ? '已开启 QQ 空间动态能力：你可以用 qq_qzone_post 以第一人称发一条动态（说说），按最近聊天与记忆发表对某人/某事的真实看法、吐槽、安利或简介，可附图与 @人；qq_qzone_delete 删除动态；qq_qzone_reply 回复评论；qq_qzone_status 看状态。也可以在对话里自然地说「帮我发条空间动态说说今天…」来触发。'
      : 'QQ 空间动态未开启（如需请在控制台开 worlds.qqbot.qzone.enabled 并重启）。';
    const gs = this.config.groupSpeak;
    const groupSpeakLine = gs.enabled
      ? `群聊发言限速已开启：每个群在 ${gs.windowSec}s 内最多发出 ${gs.maxPerWindow} 条消息（含主动冒泡与你的回复），超过会被拦截并返回「发言频率已达上限」。注意别在群里刷屏。`
      : '群聊发言限速未开启。';
    const al = this.config.antiLoop;
    const antiLoopLine = al.enabled
      ? `话题防死循环已开启：同一会话里你连续发言达到 ${al.maxConsecutiveBotTurns} 条（对方发来任意消息即清零），或对方静默超过 ${al.idleToEndSec}s 且你已经发过言，下一次发言会被自动拦截并提示「话题自动收尾」。请主动把握分寸：对方不接话、只回敷衍或已明显不想聊时，就该停，不要硬聊、不要反复抛同一话题制造死循环。`
      : '话题防死循环未开启。';
    const affinityLine = this.affinity && this.config.affinity.enabled
      ? '好感度（关系分）系统已开启：你对每个用户有一份独立的好感度，范围 -100~100，初始 0=普通，会随互动上下浮动（不是只增不减——让人舒服就加、让人反感/越界就减）。相关工具：qq_affinity_adjust 调整、qq_affinity_get 查询、qq_affinity_list 总览。你与该用户对话时，其当前好感度会自动作为「关系备忘」注入上下文，你要据此自然把握态度与分寸（高好感更亲昵放松，低/负好感更客气疏远、保持距离），但不要生硬念数字、不要刻意强调关系分。'
      : '好感度系统未开启（开启后会对每位用户维护一份可正可负、随互动浮动的好感度，并注入当前对话上下文）。';
    return {
      'qq.self': self,
      'qq.activeGroups': groupLines,
      'qq.activePrivates': privLines,
      'qq.unread': this.unreadSummary(),
      'qq.now': `当前时间：${nowStr}（时区 ${this.config.timezone}）。若用户问「现在几点」「今天星期几」「几号了」等，据此回答，不要乱编。`,
      'qq.festival': festivalLine,
      'qq.qzone': qzoneLine,
      'qq.groupSpeak': groupSpeakLine,
      'qq.antiLoop': antiLoopLine,
      'qq.affinity': affinityLine,
      'qq.emotion': this.emotion?.isEnabled() ? this.emotion.buildHint() : '',
      'qq.routine': this.routineSegmentText(),
    };
  }

  private unreadSummary(): string {
    const parts: string[] = [];
    for (const c of this.convs.values()) {
      const u = c.unread;
      if (u && u.count > 0) parts.push(`${c.label} 有 ${u.count} 条未读`);
    }
    return parts.length ? parts.join('；') : '无未读。';
  }

  // ---- 工具：抓取与解码 ----
  private async fetchBytes(url: string): Promise<Uint8Array | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** 语音 best-effort 解码：用系统 ffmpeg 把 NapCat 提供的语音转成 wav；失败返回 null（不阻塞）。 */
  private decodeVoice(url: string): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      let proc: ReturnType<typeof spawn> | null = null;
      try {
        proc = spawn('ffmpeg', ['-y', '-i', url, '-f', 'wav', '-ac', '1', '-ar', '16000', 'pipe:1'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const chunks: Buffer[] = [];
        proc.stdout?.on('data', (d) => chunks.push(d as Buffer));
        proc.on('close', (code) => resolve(code === 0 ? Buffer.concat(chunks) : null));
        proc.on('error', () => resolve(null));
        setTimeout(() => {
          try {
            proc?.kill();
          } catch {
            /* ignore */
          }
          resolve(null);
        }, 20000);
      } catch {
        resolve(null);
      }
    });
  }

  shutdownVerification() {
    return [
      {
        key: 'qq-conn',
        label: 'NapCat 连接',
        status: this.connected ? ('verified-ended' as const) : ('still-live' as const),
        detail: this.connected ? '已连接，停止后连接将关闭。' : '未连接。',
        manualAction: '在 NapCat 中停止 OneBot 连接或关闭本扩展。',
      },
    ];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function consoleLogger(): Logger {
  const noop = () => {};
  const l: Logger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, emit: noop, child: () => l };
  return l;
}
