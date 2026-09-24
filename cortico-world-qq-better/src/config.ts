import type { ConfigGroup } from 'cortico/core/types.ts';
import type { WorldSection } from 'cortico/world.ts';
import type { QZoneConfig } from './qzone.ts';
import type { RoutineConfig } from './proactive.ts';
import { voiceProviderIds } from './voice.ts';

/** fat-fish qq_bot 的关键参数 + Cortico 内置 world 的可选项，统一为一份配置。 */
export interface QQWorldConfig {
  /** 连接模式：reverse=Cortico 开 WS 服务端等 NapCat 连（fat-fish 风格）；forward=Cortico 连 NapCat 的 wsUrl（内置风格）。 */
  mode: 'reverse' | 'forward';
  /** forward 模式：NapCat 暴露的 WebSocket 地址。 */
  wsUrl: string;
  /** reverse 模式：Cortico 在哪个 host/port/path 监听 NapCat 反向连接。 */
  wsHost: string;
  wsPort: number;
  wsPath: string;
  /** NapCat 接入 Token（OneBot access_token），二选一生效。 */
  token: string;
  /** 监听中的群（fat-fish 的 GROUP_WHITELIST / 内置的 activeGroupIds）；控制台以空格/逗号分隔字符串编辑。 */
  groups: string | number[];
  /** 监听中的私聊对方 QQ（activePrivatePeers）；同上，字符串或数组皆可。 */
  privates: string | number[];
  /** 私聊聚合窗口（ms），fat-fish PRIVATE_AGGREGATION_WINDOW。 */
  privateAggregationWindow: number;
  /** 连续消息最大间隔（ms），超出视为新主题（fat-fish MAX_SEQUENCE_GAP）。 */
  maxSequenceGap: number;
  /** 引用回看窗口（秒），fat-fish REPLY_MAX_GAP_SEC。 */
  replyMaxGapSec: number;
  /** 长文本按此字节数强制分句（fat-fish IMAGE_URL_MAX_CHARS 思路复用）。 */
  maxMessageBytes: number;
  /** 合并转发消息最多展开条数。 */
  forwardExpandLimit: number;
  /** 本地表情包图片目录（相对扩展或绝对路径），供发送 `[表情包:文件名]` 标记使用。 */
  emojiDir: string;
  /** 是否把图片作为附件交给模型（需要模型支持图像）。 */
  deliverImageAttachments: boolean;
  /** 发送时按句拆分多条（fat-fish SPLIT_REPLY_BY_SENTENCE）。 */
  splitReplyBySentence: boolean;
  /** 每条消息最多容纳句数（fat-fish SENTENCES_PER_MESSAGE）。 */
  sentencesPerMessage: number;
  /** 逐条发送之间的间隔毫秒（fat-fish SEND_INTERVAL_SECONDS），0 表示不限速。 */
  sendIntervalMs: number;
  /** 被动视觉：自动用 VLM 描述图片（off 则不调用外部 API，仅留占位）。 */
  vision: {
    enabled: boolean;
    endpoint: string;
    apiKeySecret: string;
    model: string;
    maxConcurrent: number;
    maxBytes: number;
    timeoutMs: number;
  };
  /** 表情包自动收藏：下载 + 情感/用处标注 + 内容去重。 */
  sticker: {
    /** 是否自动收藏表情包。 */
    enabled: boolean;
    /** 采集范围：sticker=仅 OneBot sticker/image.subType=sticker；allImages=所有图片都当表情候选。 */
    captureMode: 'sticker' | 'allImages';
    /** 表情包落盘目录（相对扩展或绝对），空则复用 emojiDir。 */
    dir: string;
  };
  /** 主动说话调度器：后台按状态机向监听会话主动冒泡闲聊（移植自 fat-fish ProactiveSpeaker）。 */
  proactive: {
    enabled: boolean;
    mode: 'private' | 'group' | 'both';
    systemPrompt: string;
    endpoint: string;
    apiKeySecret: string;
    model: string;
    tickSec: number;
    warmupMin: number;
    stableChancePerTick: number;
    warmupChance: number;
    privateCooldownSec: number;
    groupCooldownSec: number;
    unrepliedThreshold: number;
    silentHours: number;
    dailyQuota: number;
    dedupWindow: number;
    /** 主动消息与近期已发内容的相似度上限（0~1，字符二元组 Jaccard），超过则跳过，防同一话题反复换汤不换药。 */
    topicSimilarity: number;
  };
  /** QQ 空间（动态/说说）：按对话与记忆发表自己的看法/吐槽/简介，可附图与@，支持删除与评论回复。 */
  qzone: QZoneConfig;
  /** 群聊发言频率限制：限制每个群在单位时间窗口内被 bot 主动+回复发出的消息总量，防止刷屏。 */
  groupSpeak: {
    /** 是否启用群聊发言频率限制。 */
    enabled: boolean;
    /** 滑动窗口内允许发出的最大消息条数。 */
    maxPerWindow: number;
    /** 滑动窗口长度（秒）。 */
    windowSec: number;
  };
  /** 话题自动结束 / 防死循环：统计单会话内 bot 连续发言次数，超过阈值或对方长时间未接话则自动收尾。 */
  antiLoop: {
    /** 是否启用防死循环。 */
    enabled: boolean;
    /** 单会话内 bot 连续发言上限（对方发来任意消息即清零），超过则本次发言被拦截并提示收尾。 */
    maxConsecutiveBotTurns: number;
    /** 对方静默超过该秒数且 bot 已发过言，则自动收尾（0=关闭该规则）。 */
    idleToEndSec: number;
  };
  /** 情绪系统：移植自 fat-fish qq_bot 的 emotion 模块，全局维护一份心情，注入上下文并支持 /心情 查询。 */
  emotion: {
    /** 是否启用情绪感知与注入。 */
    enabled: boolean;
    /** 情绪感知所用 chat 端点（OpenAI 兼容）。 */
    endpoint: string;
    /** 端点密钥的环境变量名。 */
    apiKeySecret: string;
    /** 感知模型。 */
    model: string;
    /** 心情自然衰减半衰期（小时），越小忘得越快。对齐 fat-fish EMOTION_DECAY_HOURS。 */
    decayHours: number;
    /** 主导情绪标签冷却（分钟）：冷却期内不切换到新标签，避免来回横跳。对齐 EMOTION_LABEL_MINUTES。 */
    labelMinutes: number;
  };
  /** 时区，用于时间戳与 env 提示。 */
  timezone: string;
  /** 作息功能：按真实时间切换「睡眠/午休/活跃」状态，睡眠段暂停主动冒泡并到点播报。 */
  routine: RoutineConfig;
  /** 闹钟 / 记事本：记录需要定时做的事或约定，到点自动提醒。 */
  reminder: {
    /** 是否启用“到点自动发提醒”。记录 / 查询 / 取消不受此开关影响（始终可用）。 */
    enabled: boolean;
  };
  /** 好感度（关系分）系统：每位用户独立、可正可负、随互动上下浮动，注入上下文影响聊天态度。 */
  affinity: {
    /**
     * 是否启用好感度系统。
     * - 记录 / 查询 / 调整工具（qq_affinity_*）始终可用；
     * - 此开关决定是否在「与该用户对话时把当前好感度自动注入上下文」，影响语气与分寸。
     */
    enabled: boolean;
  };
  /** 自称（第一人称昵称）：用于主动说话调度器与作息状态文本里替代硬编码的「本鱼」。
   *  - 留空（默认）：优先从部署人设 prompts/ORIENTATION.md 推断自称（昵称/名字/「你是X」），
   *    推断不到则回退到登录 QQ 昵称，再不行回退「我」。
   *  - 填了：强制用这个值（如「肥鱼娘」「小鱼」），与 ORIENTATION 解耦，换人设零改码。 */
  selfName: string;
  /** 语音收发：收语音转文字(ASR)+发语音(TTS)，实现方式由 voice.ts 注册表供应商决定（当前内置 native，可扩展）。 */
  voice: {
    /** 总开关。 */
    enabled: boolean;
    /** 实现方式（语音供应商 id）：当前内置 native=OneBot 原生 translate_record/tts(零依赖)；可在 voice.ts 注册更多供应商。 */
    provider: string;
    /** 收：把用户语音转成文字进入对话。 */
    asr: boolean;
    /** 发：用语音回复（受 semanticJudge 控制是否触发）。 */
    tts: boolean;
    /** 语义判定：通过 LLM 判断本次回复是否应当说语音（对齐 qq_bot _judge_voice）。 */
    semanticJudge: boolean;
    /** ASR 失败且无文字时的回退：把音频作为 blob 丢给多模态模型听（需模型支持 audio/wav）。 */
    audioFallback: boolean;
    /** 语义判定所用 chat 端点（OpenAI 兼容）。 */
    judgeEndpoint: string;
    /** 端点密钥的环境变量名。 */
    judgeApiKeySecret: string;
    /** 判定模型。 */
    judgeModel: string;
    /** 自定义(custom)语音供应商的 OpenAI 兼容音频端点基址；选 custom 供应商时必填。 */
    voiceBaseUrl: string;
    /** 自定义语音供应商 API Key 的环境变量名（控制台密钥库填写）。 */
    voiceApiKeySecret: string;
    /** 音色/声音名：仅当所选语音模型支持时填写（如 tongtong）；留空用默认音色。 */
    voiceVoice: string;
    /** 自定义供应商 ASR 模型名（/audio/transcriptions 用，缺省 whisper-1）。 */
    voiceAsrModel: string;
    /** 自定义供应商 TTS 模型名（/audio/speech 用，缺省 tts-1）。 */
    voiceTtsModel: string;
    /** 语音请求超时（秒）：TTS/ASR 单次请求最长等待，本地推理慢可调大（默认 120）。custom 与 local 共用。 */
    voiceTimeout: number;
    /** TTS 额外参数(JSON 字符串)：合并进 /audio/speech 请求体，用于本地模型的声音克隆/声音设计等高级特性（如 VoxCPM2 的 reference_audio / voice_design / language）。留空 {} 表示无。 */
    voiceExtraTts: string;
    /** ASR 额外参数(JSON 字符串)：合并进 /audio/transcriptions 表单，如 language=zh。留空 {} 表示无。 */
    voiceExtraAsr: string;
    /** 专用识别服务地址（alont1 风格 ASR）：POST {地址}/asr 收 WAV 字节 → {text}。非空时优先走此路（ffmpeg 解码 SILK/AMR 后送识别），比 OpenAI /audio/transcriptions 更稳地处理 QQ 原生 SILK 语音；空=走供应商自带 ASR。 */
    voiceTranscribeUrl: string;
    /** 识别服务单次超时（毫秒，默认 60000）：解码与 /asr 请求共用。 */
    voiceTranscribeTimeout: number;
    /** ffmpeg 可执行文件路径（用于把 SILK/AMR 解码成 WAV）。空=依次找 PATH 与仓库 node_modules/ffmpeg-static。 */
    voiceFfmpegPath: string;
  };
}


export const QQ_DEFAULTS: QQWorldConfig = {
  mode: 'reverse',
  wsUrl: 'ws://127.0.0.1:3001',
  wsHost: '0.0.0.0',
  wsPort: 8080,
  wsPath: '/onebot/v11/ws',
  token: '',
  groups: [],
  privates: [],
  privateAggregationWindow: 0,
  maxSequenceGap: 8000,
  replyMaxGapSec: 600,
  maxMessageBytes: 1500,
  forwardExpandLimit: 20,
  emojiDir: 'emoji',
  deliverImageAttachments: true,
  splitReplyBySentence: true,
  sentencesPerMessage: 1,
  sendIntervalMs: 600,
  vision: {
    enabled: false,
    endpoint: 'https://openrouter.ai/api/v1',
    apiKeySecret: 'OPENROUTER_API_KEY',
    model: 'google/gemini-2.5-flash',
    maxConcurrent: 3,
    maxBytes: 8_000_000,
    timeoutMs: 30000,
  },
  sticker: {
    enabled: true,
    captureMode: 'sticker',
    dir: '',
  },
  proactive: {
    enabled: false,
    mode: 'private',
    systemPrompt:
      '你要主动找对方说话（不是回复，是主动冒泡）。' +
      '说点自然、轻松、像真人在摸鱼时随手发的闲聊：关心一下、抛个小话题、分享点碎碎念都行。' +
      '一两句就够，别太长别太正式，别用「请问/您好」这种客服腔，也别每条都问「在吗」。' +
      '保持你自己的人设口吻（人设由部署级 ORIENTATION 决定）。',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKeySecret: 'OPENROUTER_API_KEY',
    model: 'google/gemini-2.5-flash',
    tickSec: 45,
    warmupMin: 2,
    stableChancePerTick: 0.2,
    warmupChance: 0.7,
    privateCooldownSec: 120,
    groupCooldownSec: 20,
    unrepliedThreshold: 3,
    silentHours: 6,
    dailyQuota: 20,
    dedupWindow: 12,
    topicSimilarity: 0.6,
  },
  qzone: {
    enabled: false,
    systemPrompt:
      '你现在要以第一人称在 QQ 空间发一条动态（说说）。内容要像你自己真实的朋友圈碎碎念：可以对最近聊天里某件事、某个人发表你的真实看法、吐槽、安利或简介，也可以分享当下的心情。保持你自己的人设口吻（人设由部署级 ORIENTATION 决定），自然、有梗、带点小情绪，别太长（1-3 句最佳，最多不超 100 字）。不要写成回复、不要加「在吗」、不要客服腔，可带少量 emoji。',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKeySecret: 'OPENROUTER_API_KEY',
    model: 'google/gemini-2.5-flash',
    tickSec: 900,
    chancePerTick: 0.15,
    dailyQuota: 5,
    permission: 1,
    imageMode: 'none',
    autoReplyComments: {
      enabled: false,
      systemPrompt:
        '你在 QQ 空间收到别人对你动态的评论，要回一句。自然、贴合你自己的人设口吻（由部署级 ORIENTATION 决定），像真朋友随口接话，别太长别客套，可带 emoji。',
      dailyQuota: 20,
      cooldownSec: 30,
    },
    commentAction: 'send_qzone_comment',
  },
  groupSpeak: {
    enabled: true,
    maxPerWindow: 12,
    windowSec: 60,
  },
  antiLoop: {
    enabled: true,
    maxConsecutiveBotTurns: 5,
    idleToEndSec: 300,
  },
  emotion: {
    enabled: true,
    endpoint: 'https://api.deepseek.com/v1',
    apiKeySecret: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat',
    decayHours: 2.0,
    labelMinutes: 40,
  },
  timezone: 'Asia/Shanghai',
  routine: {
    enabled: false,
    sleepStart: '23:00',
    sleepEnd: '07:30',
    lazyStart: '12:00',
    lazyEnd: '14:00',
    greetSleep: '时间不早啦，我先去睡一会儿，你们也别熬太狠~有事留言，我醒了回。',
    greetWake: '早呀，我醒啦，今天也要好好摸鱼。',
    greetLazy: '中午啦，我去扒口饭眯一眯，有事儿留言~',
  },
  reminder: {
    enabled: true,
  },
  affinity: {
    enabled: true,
  },
  selfName: '',
  voice: {
    enabled: false,
    provider: 'native',
    asr: true,
    tts: true,
    semanticJudge: true,
    audioFallback: true,
    judgeEndpoint: 'https://api.deepseek.com/v1',
    judgeApiKeySecret: 'DEEPSEEK_API_KEY',
    judgeModel: 'deepseek-chat',
    voiceBaseUrl: '',
    voiceApiKeySecret: 'VOICE_API_KEY',
    voiceVoice: '',
    voiceAsrModel: 'whisper-1',
    voiceTtsModel: 'tts-1',
    voiceTimeout: 120,
    voiceExtraTts: '{}',
    voiceExtraAsr: '{}',
    voiceTranscribeUrl: '',
    voiceTranscribeTimeout: 60000,
    voiceFfmpegPath: '',
  },
};

export const QQ_SECRETS = ['QQ_ACCESS_TOKEN', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'VOICE_API_KEY'];

/** worlds.qq 配置段：业务参数 + 必需的 enabled 开关。 */
export type QQConfigSection = QQWorldConfig & WorldSection;

export function qqDefaults(): QQConfigSection {
  return { ...QQ_DEFAULTS, enabled: false };
}

/** 控制台可编辑的连接/监听配置组（JSON Schema 形态）。 */
export const QQ_CONFIG_GROUP: ConfigGroup = {
  id: 'world:qqbot',
  owner: 'world:qqbot',
  schema: {
    type: 'object',
    title: 'QQ · 连接与监听',
    description: 'OneBot v11 / NapCat 连接参数与监听名单；连接类改动需重启生效。',
    properties: {
      'worlds.qqbot.mode': {
        type: 'string',
        title: '连接模式',
        enum: ['reverse', 'forward'],
        'x-hot': false,
        description: 'reverse=Cortico 开 WS 服务端等 NapCat 反向连（fat-fish 风格）；forward=Cortico 主动连 NapCat 的 wsUrl。',
      },
      'worlds.qqbot.wsUrl': { type: 'string', title: '正向 WS 地址', 'x-hot': false },
      'worlds.qqbot.wsHost': { type: 'string', title: '反向监听地址', 'x-hot': false },
      'worlds.qqbot.wsPort': { type: 'integer', title: '反向监听端口', minimum: 1, maximum: 65535, 'x-hot': false },
      'worlds.qqbot.wsPath': { type: 'string', title: '反向监听路径', 'x-hot': false },
      'worlds.qqbot.token': { type: 'string', title: 'OneBot Token', 'x-hot': false },
      'worlds.qqbot.groups': { type: 'string', title: '监听群', 'x-hot': true, description: '监听的群号，用空格或逗号分隔；空=全部群。改完即时生效，不用重启。' },
      'worlds.qqbot.privates': { type: 'string', title: '监听私聊', 'x-hot': true, description: '监听的私聊对方 QQ 号，用空格或逗号分隔。改完即时生效，不用重启。' },
      'worlds.qqbot.deliverImageAttachments': { type: 'boolean', title: '图片作为模型附件', 'x-hot': true },
      'worlds.qqbot.emojiDir': { type: 'string', title: '表情包目录', 'x-hot': false, description: '本地表情包图片目录（相对扩展或绝对路径），供发送 [表情包:文件名] 标记。' },
      'worlds.qqbot.splitReplyBySentence': { type: 'boolean', title: '按句拆分发送', 'x-hot': true, description: '开启后回复按句标拆成多条消息（对齐 fat-fish）。' },
      'worlds.qqbot.sentencesPerMessage': { type: 'integer', title: '每条句数', minimum: 1, maximum: 10, 'x-hot': true },
      'worlds.qqbot.sendIntervalMs': { type: 'integer', title: '发送间隔(ms)', minimum: 0, maximum: 5000, 'x-hot': true, description: '逐条发送之间的间隔，0 表示不限速。' },
      'worlds.qqbot.vision.enabled': { type: 'boolean', title: '开启辅助视觉', 'x-hot': false },
      'worlds.qqbot.vision.model': { type: 'string', title: 'VLM 模型', 'x-hot': false },
      'worlds.qqbot.sticker.enabled': { type: 'boolean', title: '自动收藏表情包', 'x-hot': false, description: '开启后自动下载消息里的表情包并标注情感/用处、内容去重。' },
      'worlds.qqbot.sticker.captureMode': {
        type: 'string',
        title: '采集范围',
        enum: ['sticker', 'allImages'],
        'x-hot': false,
        description: 'sticker=仅 OneBot 表情包段；allImages=所有图片都当表情候选收藏。',
      },
      'worlds.qqbot.proactive.enabled': { type: 'boolean', title: '主动说话调度器', 'x-hot': false, description: '开启后后台按状态机向监听会话主动冒泡闲聊（移植自 fat-fish ProactiveSpeaker）。' },
      'worlds.qqbot.proactive.mode': {
        type: 'string',
        title: '主动范围',
        enum: ['private', 'group', 'both'],
        'x-hot': true,
        description: 'private=仅私聊；group=仅群；both=都主动。',
      },
      'worlds.qqbot.proactive.model': { type: 'string', title: '主动消息模型', 'x-hot': false, description: '生成主动闲聊用的 chat 模型（OpenAI 兼容端点）。' },
      'worlds.qqbot.proactive.dailyQuota': { type: 'integer', title: '每日上限', minimum: 0, maximum: 200, 'x-hot': true, description: '每日主动消息条数上限（0=不限）。' },
      'worlds.qqbot.qzone.enabled': { type: 'boolean', title: 'QQ空间动态', 'x-hot': false, description: '开启后可在 QQ 空间发动态、自动冒泡、回复评论。需重启生效。' },
      'worlds.qqbot.qzone.model': { type: 'string', title: '动态生成模型', 'x-hot': false, description: '生成动态/评论所用 chat 模型（OpenAI 兼容端点）。' },
      'worlds.qqbot.qzone.dailyQuota': { type: 'integer', title: '每日自动动态上限', minimum: 0, maximum: 50, 'x-hot': true, description: '后台自动发动态的每日条数上限（0=不限）。' },
      'worlds.qqbot.qzone.permission': { type: 'integer', title: '动态可见权限', minimum: 0, maximum: 10, 'x-hot': true, description: 'ugc_right：1=公开（默认），其余值随 NapCat 版本。' },
      'worlds.qqbot.qzone.imageMode': { type: 'string', title: '自动附图', enum: ['none', 'recent'], 'x-hot': true, description: 'none=不附图；recent=自动附上最近一条 QQ 图片。' },
      'worlds.qqbot.qzone.autoReplyComments.enabled': { type: 'boolean', title: '自动回复空间评论', 'x-hot': false, description: '收到空间评论时自动生成并回复。需重启生效。' },
      'worlds.qqbot.qzone.commentAction': { type: 'string', title: '评论回复 action', 'x-hot': true, description: '回复评论用的 OneBot action（不同 NapCat 版本可能不同，默认 send_qzone_comment）。' },
      'worlds.qqbot.proactive.topicSimilarity': { type: 'number', title: '话题相似度上限', minimum: 0, maximum: 1, 'x-hot': true, description: '0~1：主动消息与近期已发内容相似度超过该值则跳过（防同一话题反复换汤不换药）。0=关闭。' },
      'worlds.qqbot.groupSpeak.enabled': { type: 'boolean', title: '群聊发言限速', 'x-hot': true, description: '开启后限制每个群在单位窗口内被 bot 发出的消息总量，防止刷屏/死循环灌水。' },
      'worlds.qqbot.groupSpeak.maxPerWindow': { type: 'integer', title: '窗口内最大条数', minimum: 1, maximum: 200, 'x-hot': true, description: '滑动窗口内允许发出的群消息上限（含主动与回复）。' },
      'worlds.qqbot.groupSpeak.windowSec': { type: 'integer', title: '窗口长度(秒)', minimum: 1, maximum: 3600, 'x-hot': true, description: '限速滑动窗口长度。' },
      'worlds.qqbot.antiLoop.enabled': { type: 'boolean', title: '话题自动结束', 'x-hot': true, description: '开启后统计单会话 bot 连续发言次数与对方静默时长，超限自动收尾，避免话题死循环。' },
      'worlds.qqbot.antiLoop.maxConsecutiveBotTurns': { type: 'integer', title: '连续发言上限', minimum: 1, maximum: 50, 'x-hot': true, description: '单会话内 bot 连续发言达到该次数（对方发消息即清零），下次发言被拦截并提示收尾。' },
      'worlds.qqbot.antiLoop.idleToEndSec': { type: 'integer', title: '对方静默收尾(秒)', minimum: 0, maximum: 86400, 'x-hot': true, description: '对方静默超过该秒数且 bot 已发过言则自动收尾；0=关闭该规则。' },
      'worlds.qqbot.emotion.enabled': { type: 'boolean', title: '情绪系统', 'x-hot': true, description: '开启后每轮对话感知情绪、把心情注入全局上下文，并支持 /心情 查询（移植自 fat-fish）。' },
      'worlds.qqbot.emotion.decayHours': { type: 'number', title: '心情衰减半衰期(小时)', minimum: 0.1, maximum: 48, 'x-hot': true, description: '心情值自然回落到中性（0）的半衰期，越小忘得越快。' },
      'worlds.qqbot.emotion.labelMinutes': { type: 'number', title: '主导情绪冷却(分)', minimum: 0, maximum: 120, 'x-hot': true, description: '冷却期内不切换到新的主导情绪标签，避免来回横跳。' },
      'worlds.qqbot.emotion.model': { type: 'string', title: '情绪感知模型', 'x-hot': false, description: '用于分析用户消息情绪、抽取心情变化的 chat 模型（OpenAI 兼容端点）。' },
      'worlds.qqbot.routine.enabled': { type: 'boolean', title: '作息功能', 'x-hot': true, description: '开启后按真实时间切换「睡眠/午休/活跃」状态：睡眠段暂停主动冒泡并到点播报，午休段仅在语气里体现。改完即时生效。' },
      'worlds.qqbot.routine.sleepStart': { type: 'string', title: '睡眠开始(HH:MM)', 'x-hot': true, description: '进入睡眠时段的时间（24h，可早于 sleepEnd 形成跨午夜，如 23:00）。睡眠段内不主动冒泡，但仍能被动回复。' },
      'worlds.qqbot.routine.sleepEnd': { type: 'string', title: '睡眠结束(HH:MM)', 'x-hot': true, description: '离开睡眠时段的时间（24h）。离开时主动说「醒来」播报文案。' },
      'worlds.qqbot.routine.lazyStart': { type: 'string', title: '午休开始(HH:MM)', 'x-hot': true, description: '进入午休/打盹时段的时间；仅作为状态注入，不影响主动冒泡是否发出。' },
      'worlds.qqbot.routine.lazyEnd': { type: 'string', title: '午休结束(HH:MM)', 'x-hot': true, description: '离开午休时段的时间。' },
      'worlds.qqbot.routine.greetSleep': { type: 'string', title: '去睡播报(兜底)', 'x-hot': true, description: '进入睡眠段的兜底文案：正常播报由 LLM 现场生成（每次说法不固定），仅当生成失败才回退到这句。空=无兜底直接跳过。' },
      'worlds.qqbot.routine.greetWake': { type: 'string', title: '醒来播报(兜底)', 'x-hot': true, description: '离开睡眠段的兜底文案：正常由 LLM 生成，失败才回退。空=无兜底。' },
      'worlds.qqbot.routine.greetLazy': { type: 'string', title: '午休播报(兜底)', 'x-hot': true, description: '进入午休段的兜底文案：正常由 LLM 生成，失败才回退。空=无兜底。' },
      'worlds.qqbot.reminder.enabled': { type: 'boolean', title: '到点提醒', 'x-hot': true, description: '开启后，记下的定时提醒会在到点时自动发到对应会话；记录/查询/取消不受此开关影响（始终可用）。' },
  'worlds.qqbot.affinity.enabled': { type: 'boolean', title: '好感度系统', 'x-hot': true, description: '开启后，你对每个用户的好感度（-100~100，可正可负）会随互动增减，并在与该用户对话时自动注入上下文、影响你的态度与分寸。记录/查询/调整工具始终可用。' },
      'worlds.qqbot.selfName': { type: 'string', title: '自称(第一人称)', 'x-hot': true, description: '主动说话调度器与作息状态文本里替代硬编码「本鱼」的自称。留空=从 prompts/ORIENTATION.md 推断（昵称/名字/「你是X」），推断不到回退登录 QQ 昵称、再回退「我」；填了则强制用此值，换人设零改码。' },
  },
  },
  };

  /** 语音收发配置分组（参考 E:\qq_bot）：收语音转文字、发语音，两种实现可切。 */
  export const QQ_VOICE_GROUP: ConfigGroup = {
  id: 'world:qqbot-voice',
  owner: 'world:qqbot',
  schema: {
  type: 'object',
  title: 'QQ · 语音收发',
  description: '收语音转文字(ASR)+发语音(TTS)。「实现方式」下拉选择供应商：native=OneBot 原生 translate_record/tts（零依赖，开箱即用）；custom=用「模型网址+API Key」对接远程 OpenAI 兼容音频服务（GLM/OpenAI/自建等）；local=对接本地/自建模型（OpenAI 兼容，免 API Key，慢推理可加超时，支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）。是否说语音由语义判定决定。改完需重启生效。',
  properties: {
  'worlds.qqbot.voice.enabled': { type: 'boolean', title: '启用语音', 'x-hot': false, description: '总开关：关闭则完全不处理语音（收按原方式、发只文字）。' },
  'worlds.qqbot.voice.provider': {
    type: 'string', title: '实现方式', enum: voiceProviderIds(), 'x-hot': false,
    description: '语音供应商（实现方式）：下拉项由 voice.ts 注册的供应商动态生成。native=OneBot 原生 translate_record/tts（零依赖）；custom=用配置页填写的模型网址+API Key 对接远程 OpenAI 兼容音频服务；local=本地/自建模型（免 API Key，慢推理可加超时，支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）。新增供应商只需在 voice.ts 用 registerVoiceProvider 注册。',
  },
  'worlds.qqbot.voice.asr': { type: 'boolean', title: '收语音转文字', 'x-hot': false, description: '开启后，用户发语音会被转成文字进入对话（文字更可靠、可检索）。' },
  'worlds.qqbot.voice.tts': { type: 'boolean', title: '发语音', 'x-hot': false, description: '开启后，当语义判定认为应当说语音时，回复发成语音。' },
  'worlds.qqbot.voice.semanticJudge': { type: 'boolean', title: '语义判定是否说语音', 'x-hot': false, description: '开启后通过 LLM 判断用户是否想听语音（对齐 qq_bot _judge_voice）；关闭则仅当用户显式要求时才说语音。' },
  'worlds.qqbot.voice.audioFallback': { type: 'boolean', title: 'ASR 失败回退音频', 'x-hot': false, description: 'ASR 取不到文字时，把音频作为 blob 丢给多模态模型听（需模型支持 audio/wav）。' },
  'worlds.qqbot.voice.judgeModel': { type: 'string', title: '语义判定模型', 'x-hot': false, description: '判定“是否说语音”用的轻量 chat 模型（OpenAI 兼容端点）。' },
  'worlds.qqbot.voice.voiceBaseUrl': { type: 'string', title: '语音模型网址', 'x-hot': false, description: '选 custom / local 供应商时必填：OpenAI 兼容音频端点基址。远程如 https://open.bigmodel.cn/api/paas/v4 或 https://api.openai.com/v1；本地如 http://localhost:8000/v1（VoxCPM2 经 vLLM-Omni）。ASR 走 {网址}/audio/transcriptions，TTS 走 {网址}/audio/speech。' },
  'worlds.qqbot.voice.voiceApiKeySecret': { type: 'string', title: '语音 API Key 变量', 'x-hot': false, description: 'custom 供应商 API Key 所在的环境变量名（密钥在控制台密钥库填写，默认 VOICE_API_KEY）。local 供应商免 API Key，留空即可。' },
  'worlds.qqbot.voice.voiceVoice': { type: 'string', title: '音色', 'x-hot': false, description: '仅当所选语音模型支持音色时填写（如 tongtong）；留空使用服务商默认音色。' },
  'worlds.qqbot.voice.voiceAsrModel': { type: 'string', title: 'ASR 模型名', 'x-hot': false, description: '语音识别模型名（OpenAI 兼容 /audio/transcriptions 用，缺省 whisper-1；GLM 用 glm-asr-2512）。' },
  'worlds.qqbot.voice.voiceTtsModel': { type: 'string', title: 'TTS 模型名', 'x-hot': false, description: '语音合成模型名（OpenAI 兼容 /audio/speech 用，缺省 tts-1；GLM 用 glm-tts；VoxCPM2 一般为 openbmb/VoxCPM2）。' },
  'worlds.qqbot.voice.voiceTimeout': { type: 'integer', title: '请求超时(秒)', minimum: 1, maximum: 1800, 'x-hot': false, description: 'TTS/ASR 单次请求最长等待秒数（默认 120）。本地模型推理慢可调大，超时则回退。custom 与 local 共用。' },
  'worlds.qqbot.voice.voiceExtraTts': { type: 'string', title: 'TTS 额外参数(JSON)', 'x-hot': false, description: '合并进 /audio/speech 请求体的额外 JSON，用于本地模型高级特性：如 VoxCPM2 声音克隆传 {"reference_audio":"<音频url或base64>"}, 或声音设计传 {"voice_design":"一个温柔的少年音"}。留空 {} 表示无。' },
  'worlds.qqbot.voice.voiceExtraAsr': { type: 'string', title: 'ASR 额外参数(JSON)', 'x-hot': false, description: '合并进 /audio/transcriptions 表单的额外 JSON，如 {"language":"zh"}。留空 {} 表示无。' },
  'worlds.qqbot.voice.voiceTranscribeUrl': { type: 'string', title: '专用识别服务地址', 'x-hot': false, description: 'alont1 风格 ASR：POST {地址}/asr 收 WAV 字节返回 {text}。配了就优先走此路（ffmpeg 把 SILK/AMR 解码成 WAV 再送识别），比 OpenAI /audio/transcriptions 更稳地处理 QQ 原生 SILK 语音。如 http://127.0.0.1:7798。空=走供应商自带 ASR。' },
  'worlds.qqbot.voice.voiceTranscribeTimeout': { type: 'integer', title: '识别超时(毫秒)', minimum: 1000, maximum: 600000, 'x-hot': false, description: '单次识别（ffmpeg 解码 + /asr 请求）最长等待毫秒数（默认 60000）。超时回退供应商自带 ASR 或文字。' },
  'worlds.qqbot.voice.voiceFfmpegPath': { type: 'string', title: 'ffmpeg 路径', 'x-hot': false, description: '解码语音用的 ffmpeg 可执行文件路径。空=依次找 PATH 与仓库 node_modules/ffmpeg-static（win 用 ffmpeg.exe）；找不到则识别服务不可用。' },
  },
  },
  };

/**
 * 原地补全缺省值并保持对象身份：让 World 持有的 this.config 就是 ctx.cfg 的同一引用，
 * 这样控制台的 x-hot 配置改动（groups / privates / 发送节奏等）能即时对 World 生效，无需重启。
 */
/** 把“空格/逗号分隔字符串”或“数字数组”统一成数字数组（过滤非有限值）。控制台以字符串编辑，运行时以数组使用。 */
export function toIds(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => Number.isFinite(n));
  if (typeof raw === 'string') return raw.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  return [];
}

export function normalizeConfig(raw: QQConfigSection): QQWorldConfig {
  const c = raw as unknown as QQWorldConfig & Record<string, unknown>;
  for (const [k, v] of Object.entries(QQ_DEFAULTS)) {
    if (c[k] === undefined) c[k] = v;
  }
  c.groups = toIds(c.groups);
  c.privates = toIds(c.privates);
  if (typeof c.privateAggregationWindow !== 'number') c.privateAggregationWindow = QQ_DEFAULTS.privateAggregationWindow;
  if (typeof c.maxSequenceGap !== 'number') c.maxSequenceGap = QQ_DEFAULTS.maxSequenceGap;
  if (typeof c.replyMaxGapSec !== 'number') c.replyMaxGapSec = QQ_DEFAULTS.replyMaxGapSec;
  if (typeof c.maxMessageBytes !== 'number') c.maxMessageBytes = QQ_DEFAULTS.maxMessageBytes;
  if (typeof c.forwardExpandLimit !== 'number') c.forwardExpandLimit = QQ_DEFAULTS.forwardExpandLimit;
  if (typeof c.splitReplyBySentence !== 'boolean') c.splitReplyBySentence = true;
  if (typeof c.sentencesPerMessage !== 'number') c.sentencesPerMessage = 1;
  if (typeof c.sendIntervalMs !== 'number') c.sendIntervalMs = QQ_DEFAULTS.sendIntervalMs;
  if (typeof c.deliverImageAttachments !== 'boolean') c.deliverImageAttachments = QQ_DEFAULTS.deliverImageAttachments;
  if (typeof c.emojiDir !== 'string' || !c.emojiDir) c.emojiDir = QQ_DEFAULTS.emojiDir;
  if (typeof c.timezone !== 'string' || !c.timezone) c.timezone = QQ_DEFAULTS.timezone;
  if (typeof c.mode !== 'string') c.mode = 'reverse';
  if (typeof c.token !== 'string') c.token = '';
  if (typeof c.wsUrl !== 'string') c.wsUrl = QQ_DEFAULTS.wsUrl;
  if (typeof c.wsHost !== 'string') c.wsHost = QQ_DEFAULTS.wsHost;
  if (typeof c.wsPort !== 'number') c.wsPort = QQ_DEFAULTS.wsPort;
  if (typeof c.wsPath !== 'string') c.wsPath = QQ_DEFAULTS.wsPath;
  // vision 子对象原地合并，保持引用身份（x-hot 生效）
  c.vision = c.vision ?? {};
  Object.assign(c.vision, { ...QQ_DEFAULTS.vision, ...(c.vision as object) });
  // sticker 子对象原地合并
  c.sticker = c.sticker ?? {};
  Object.assign(c.sticker, { ...QQ_DEFAULTS.sticker, ...(c.sticker as object) });
  if (typeof c.sticker.enabled !== 'boolean') c.sticker.enabled = true;
  if (c.sticker.captureMode !== 'sticker' && c.sticker.captureMode !== 'allImages') c.sticker.captureMode = 'sticker';
  if (typeof c.sticker.dir !== 'string') c.sticker.dir = '';
  // proactive 子对象原地合并
  c.proactive = c.proactive ?? {};
  Object.assign(c.proactive, { ...QQ_DEFAULTS.proactive, ...(c.proactive as object) });
  const p = c.proactive as Record<string, unknown>;
  if (typeof p.enabled !== 'boolean') p.enabled = false;
  if (p.mode !== 'private' && p.mode !== 'group' && p.mode !== 'both') p.mode = 'private';
  if (typeof p.systemPrompt !== 'string' || !p.systemPrompt) p.systemPrompt = QQ_DEFAULTS.proactive.systemPrompt;
  if (typeof p.endpoint !== 'string' || !p.endpoint) p.endpoint = QQ_DEFAULTS.proactive.endpoint;
  if (typeof p.apiKeySecret !== 'string' || !p.apiKeySecret) p.apiKeySecret = QQ_DEFAULTS.proactive.apiKeySecret;
  if (typeof p.model !== 'string' || !p.model) p.model = QQ_DEFAULTS.proactive.model;
  if (typeof p.tickSec !== 'number') p.tickSec = QQ_DEFAULTS.proactive.tickSec;
  if (typeof p.warmupMin !== 'number') p.warmupMin = QQ_DEFAULTS.proactive.warmupMin;
  if (typeof p.stableChancePerTick !== 'number') p.stableChancePerTick = QQ_DEFAULTS.proactive.stableChancePerTick;
  if (typeof p.warmupChance !== 'number') p.warmupChance = QQ_DEFAULTS.proactive.warmupChance;
  if (typeof p.privateCooldownSec !== 'number') p.privateCooldownSec = QQ_DEFAULTS.proactive.privateCooldownSec;
  if (typeof p.groupCooldownSec !== 'number') p.groupCooldownSec = QQ_DEFAULTS.proactive.groupCooldownSec;
  if (typeof p.unrepliedThreshold !== 'number') p.unrepliedThreshold = QQ_DEFAULTS.proactive.unrepliedThreshold;
  if (typeof p.silentHours !== 'number') p.silentHours = QQ_DEFAULTS.proactive.silentHours;
  if (typeof p.dailyQuota !== 'number') p.dailyQuota = QQ_DEFAULTS.proactive.dailyQuota;
  if (typeof p.dedupWindow !== 'number') p.dedupWindow = QQ_DEFAULTS.proactive.dedupWindow;
  if (typeof p.topicSimilarity !== 'number' || (p.topicSimilarity as number) < 0 || (p.topicSimilarity as number) > 1) p.topicSimilarity = QQ_DEFAULTS.proactive.topicSimilarity;
  // qzone 子对象原地合并
  c.qzone = c.qzone && typeof c.qzone === 'object' ? c.qzone : {};
  Object.assign(c.qzone, { ...QQ_DEFAULTS.qzone, ...(c.qzone as Record<string, unknown>) });
  const q = c.qzone as Record<string, unknown>;
  if (typeof q.enabled !== 'boolean') q.enabled = false;
  if (typeof q.systemPrompt !== 'string' || !q.systemPrompt) q.systemPrompt = QQ_DEFAULTS.qzone.systemPrompt;
  if (typeof q.endpoint !== 'string' || !q.endpoint) q.endpoint = QQ_DEFAULTS.qzone.endpoint;
  if (typeof q.apiKeySecret !== 'string' || !q.apiKeySecret) q.apiKeySecret = QQ_DEFAULTS.qzone.apiKeySecret;
  if (typeof q.model !== 'string' || !q.model) q.model = QQ_DEFAULTS.qzone.model;
  if (typeof q.tickSec !== 'number') q.tickSec = QQ_DEFAULTS.qzone.tickSec;
  if (typeof q.chancePerTick !== 'number') q.chancePerTick = QQ_DEFAULTS.qzone.chancePerTick;
  if (typeof q.dailyQuota !== 'number') q.dailyQuota = QQ_DEFAULTS.qzone.dailyQuota;
  if (typeof q.permission !== 'number') q.permission = QQ_DEFAULTS.qzone.permission;
  if (q.imageMode !== 'none' && q.imageMode !== 'recent') q.imageMode = 'none' as const;
  const ar = (q.autoReplyComments ??= {}) as Record<string, unknown>;
  Object.assign(ar, { ...QQ_DEFAULTS.qzone.autoReplyComments, ...ar });
  if (typeof ar.enabled !== 'boolean') ar.enabled = false;
  if (typeof ar.systemPrompt !== 'string' || !ar.systemPrompt) ar.systemPrompt = QQ_DEFAULTS.qzone.autoReplyComments.systemPrompt;
  if (typeof ar.dailyQuota !== 'number') ar.dailyQuota = QQ_DEFAULTS.qzone.autoReplyComments.dailyQuota;
  if (typeof ar.cooldownSec !== 'number') ar.cooldownSec = QQ_DEFAULTS.qzone.autoReplyComments.cooldownSec;
  if (typeof q.commentAction !== 'string' || !q.commentAction) q.commentAction = QQ_DEFAULTS.qzone.commentAction;
  // groupSpeak / antiLoop 子对象原地合并
  c.groupSpeak = c.groupSpeak ?? {};
  Object.assign(c.groupSpeak, { ...QQ_DEFAULTS.groupSpeak, ...(c.groupSpeak as object) });
  const gs = c.groupSpeak as Record<string, unknown>;
  if (typeof gs.enabled !== 'boolean') gs.enabled = true;
  if (typeof gs.maxPerWindow !== 'number' || (gs.maxPerWindow as number) < 1) gs.maxPerWindow = QQ_DEFAULTS.groupSpeak.maxPerWindow;
  if (typeof gs.windowSec !== 'number' || (gs.windowSec as number) < 1) gs.windowSec = QQ_DEFAULTS.groupSpeak.windowSec;
  c.antiLoop = c.antiLoop ?? {};
  Object.assign(c.antiLoop, { ...QQ_DEFAULTS.antiLoop, ...(c.antiLoop as object) });
  const al = c.antiLoop as Record<string, unknown>;
  if (typeof al.enabled !== 'boolean') al.enabled = true;
  if (typeof al.maxConsecutiveBotTurns !== 'number' || (al.maxConsecutiveBotTurns as number) < 1) al.maxConsecutiveBotTurns = QQ_DEFAULTS.antiLoop.maxConsecutiveBotTurns;
  if (typeof al.idleToEndSec !== 'number' || (al.idleToEndSec as number) < 0) al.idleToEndSec = QQ_DEFAULTS.antiLoop.idleToEndSec;
  // emotion 子对象原地合并
  c.emotion = c.emotion ?? {};
  Object.assign(c.emotion, { ...QQ_DEFAULTS.emotion, ...(c.emotion as object) });
  const em = c.emotion as Record<string, unknown>;
  if (typeof em.enabled !== 'boolean') em.enabled = true;
  if (typeof em.endpoint !== 'string' || !em.endpoint) em.endpoint = QQ_DEFAULTS.emotion.endpoint;
  if (typeof em.apiKeySecret !== 'string' || !em.apiKeySecret) em.apiKeySecret = QQ_DEFAULTS.emotion.apiKeySecret;
  if (typeof em.model !== 'string' || !em.model) em.model = QQ_DEFAULTS.emotion.model;
  if (typeof em.decayHours !== 'number' || (em.decayHours as number) <= 0) em.decayHours = QQ_DEFAULTS.emotion.decayHours;
  if (typeof em.labelMinutes !== 'number' || (em.labelMinutes as number) < 0) em.labelMinutes = QQ_DEFAULTS.emotion.labelMinutes;
  // routine 子对象原地合并
  c.routine = c.routine && typeof c.routine === 'object' ? c.routine : {};
  Object.assign(c.routine, { ...QQ_DEFAULTS.routine, ...(c.routine as object) });
  const rt = c.routine as Record<string, unknown>;
  if (typeof rt.enabled !== 'boolean') rt.enabled = false;
  if (typeof rt.sleepStart !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.sleepStart as string)) rt.sleepStart = QQ_DEFAULTS.routine.sleepStart;
  if (typeof rt.sleepEnd !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.sleepEnd as string)) rt.sleepEnd = QQ_DEFAULTS.routine.sleepEnd;
  if (typeof rt.lazyStart !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.lazyStart as string)) rt.lazyStart = QQ_DEFAULTS.routine.lazyStart;
  if (typeof rt.lazyEnd !== 'string' || !/^\d{1,2}:\d{2}$/.test(rt.lazyEnd as string)) rt.lazyEnd = QQ_DEFAULTS.routine.lazyEnd;
  if (typeof rt.greetSleep !== 'string') rt.greetSleep = QQ_DEFAULTS.routine.greetSleep;
  if (typeof rt.greetWake !== 'string') rt.greetWake = QQ_DEFAULTS.routine.greetWake;
  if (typeof rt.greetLazy !== 'string') rt.greetLazy = QQ_DEFAULTS.routine.greetLazy;
  // reminder 子对象原地合并
  c.reminder = c.reminder && typeof c.reminder === 'object' ? c.reminder : {};
  Object.assign(c.reminder, { ...QQ_DEFAULTS.reminder, ...(c.reminder as object) });
  const rm = c.reminder as Record<string, unknown>;
  if (typeof rm.enabled !== 'boolean') rm.enabled = true;
  // affinity 子对象原地合并
  c.affinity = c.affinity && typeof c.affinity === 'object' ? c.affinity : {};
  Object.assign(c.affinity, { ...QQ_DEFAULTS.affinity, ...(c.affinity as object) });
  const af = c.affinity as Record<string, unknown>;
  if (typeof af.enabled !== 'boolean') af.enabled = true;
  // voice 子对象原地合并
  c.voice = c.voice && typeof c.voice === 'object' ? c.voice : {};
  Object.assign(c.voice, { ...QQ_DEFAULTS.voice, ...(c.voice as object) });
  const vc = c.voice as Record<string, unknown>;
  if (typeof vc.enabled !== 'boolean') vc.enabled = false;
  if (!voiceProviderIds().includes(vc.provider as string)) vc.provider = 'native';
  if (typeof vc.asr !== 'boolean') vc.asr = true;
  if (typeof vc.tts !== 'boolean') vc.tts = true;
  if (typeof vc.semanticJudge !== 'boolean') vc.semanticJudge = true;
  if (typeof vc.audioFallback !== 'boolean') vc.audioFallback = true;
  if (typeof vc.judgeEndpoint !== 'string' || !vc.judgeEndpoint) vc.judgeEndpoint = QQ_DEFAULTS.voice.judgeEndpoint;
  if (typeof vc.judgeApiKeySecret !== 'string' || !vc.judgeApiKeySecret) vc.judgeApiKeySecret = QQ_DEFAULTS.voice.judgeApiKeySecret;
  if (typeof vc.judgeModel !== 'string' || !vc.judgeModel) vc.judgeModel = QQ_DEFAULTS.voice.judgeModel;
  if (typeof vc.voiceBaseUrl !== 'string') vc.voiceBaseUrl = QQ_DEFAULTS.voice.voiceBaseUrl;
  if (typeof vc.voiceApiKeySecret !== 'string' || !vc.voiceApiKeySecret) vc.voiceApiKeySecret = QQ_DEFAULTS.voice.voiceApiKeySecret;
  if (typeof vc.voiceVoice !== 'string') vc.voiceVoice = QQ_DEFAULTS.voice.voiceVoice;
  if (typeof vc.voiceAsrModel !== 'string' || !vc.voiceAsrModel) vc.voiceAsrModel = QQ_DEFAULTS.voice.voiceAsrModel;
  if (typeof vc.voiceTtsModel !== 'string' || !vc.voiceTtsModel) vc.voiceTtsModel = QQ_DEFAULTS.voice.voiceTtsModel;
  if (typeof vc.voiceTimeout !== 'number' || !(vc.voiceTimeout > 0)) vc.voiceTimeout = QQ_DEFAULTS.voice.voiceTimeout;
  if (typeof vc.voiceExtraTts !== 'string') vc.voiceExtraTts = QQ_DEFAULTS.voice.voiceExtraTts;
  if (typeof vc.voiceExtraAsr !== 'string') vc.voiceExtraAsr = QQ_DEFAULTS.voice.voiceExtraAsr;
  if (typeof vc.voiceTranscribeUrl !== 'string') vc.voiceTranscribeUrl = QQ_DEFAULTS.voice.voiceTranscribeUrl;
  if (typeof vc.voiceTranscribeTimeout !== 'number' || !(vc.voiceTranscribeTimeout > 0)) vc.voiceTranscribeTimeout = QQ_DEFAULTS.voice.voiceTranscribeTimeout;
  if (typeof vc.voiceFfmpegPath !== 'string') vc.voiceFfmpegPath = QQ_DEFAULTS.voice.voiceFfmpegPath;
  return c;
}

export function parseNumberSeq(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  if (typeof v === 'string') {
    return v
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}
