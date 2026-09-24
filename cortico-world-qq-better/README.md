# cortico-world-qq-better

Cortico 的 **QQ（OneBot v11 / NapCat）** World 扩展。以 `fat-fish` 仓库的 `qq_bot` 插件为**本体**，并增量吸收了 Cortico 内置 `qq` world 的特性。

- 包名：`cortico-world-qq-better`
- World id：`qqbot`（与内置 `qq` 区分，可并存；如需独占可禁用内置 world）
- 框架契约：`api: 5`

## 与 fat-fish / 内置 qq 的关系

| 能力 | fat-fish 插件 | 本扩展 | 说明 |
|---|---|---|---|
| 连接方式 | 反向 WS（Cortico 开服务端等 NapCat 连） | ✅ 反向（默认）+ 正向 | 配置 `mode` 切换 |
| 消息解析 | 文本/图片/语音(SILK)/视频、@判断、表情码、私聊聚合、群白名单、引用回复 | ✅ 全部移植 | fat-fish 的 `QQPlugin`/`QQAdapter` 逻辑 |
| 文本分句发送 | `split_for_sending` 按句拆分 + 发送限速 | ✅ 按句拆分（含表情包图片/中文表情名）+ 分片 `send_msg` + `sendIntervalMs` 间隔限速 | 单条仍超 `maxMessageBytes` 再按字节硬切 |
| 草稿-确认门 | — | ✅ 增量吸收 | `qq_send` 起草 + `qq_confirm_send` 确认 |
| 控制台面板 | — | ✅ 增量吸收 | 连接/监听名单/实时事件流 |
| 环境提示词 | — | ✅ 增量吸收 | `envPromptVars` + `ENV_PROMPT.md` |
| 通知事件 | 撤回/退群等 | ✅ 增量吸收 | recall / member / poke / emoji |
| 被动视觉(VLM) | — | ✅ 增量吸收（默认关） | 可选 OpenAI 兼容端点描述图片 |
| 历史查询 | — | ✅ 增量吸收 | `qq_recent` / `qq_search` |
| QQ 空间动态（说说） | — | ✅ 增量吸收 | 自动/手动发表、附图、@、回评、删除（`qq_qzone_*`） |
| 群聊发言频率限制 | — | ✅ 增量吸收 | 每个群在滑动窗口内可发消息总量的硬上限（含主动与回复），防刷屏 |
| 话题自动结束 / 防死循环 | — | ✅ 增量吸收 | 单会话 bot 连续发言超上限、或对方长时间静默则自动收尾；主动说话还按话题相似度去重，防反复换汤不换药 |
| 情绪系统（全局心情） | `emotion.py` | ✅ 移植自 fat-fish | 每轮用户发言后由 LLM 抽取心情变化（情绪/强度/起因），维护全局一份心情（自然衰减 + 主导情绪冷却），把心情提示词注入 Cortico 全局上下文；支持 `/心情` 查询与 `/心情 重置` |
| AI 作息（睡眠/午休/活跃） | — | ✅ 增量吸收 | 按真实时间切换三段：睡眠段暂停主动冒泡（被动回复照常）、午休段放缓主动节奏、活跃段正常；时段切换由 LLM 现场生成随性播报（非固定套话） |
| 闹钟 / 记事本 | — | ✅ 新增 | 让智能体把"需要定时做的事 / 约定"记下来（`qq_reminder_add`），到点自动在该会话提醒（`qq_reminder_list` 查、`qq_reminder_cancel` 删）；落盘持久化、跨重启不丢 |
| 好感度（关系分） | — | ✅ 新增 | 对**每个用户独立**维护一份好感度（-100~100，可正可负、随互动上下浮动，不是只增不减）；`qq_affinity_adjust` 加减、`qq_affinity_get` 查、`qq_affinity_list` 总览；当前用户好感度会**自动注入对话上下文**，影响语气与分寸 |
| 语音（ASR + TTS） | — | ✅ 新增 | 听语音（ASR 转文字）+ 说语音（TTS）。**供应商可插拔**，内置 `native`（OneBot 原生，零依赖）、`custom`（远程 OpenAI 兼容端点 + API Key）、`local`（本地/自建模型如 VoxCPM2 经 vLLM-Omni，免 Key、慢推理可加超时、支持额外参数透传）；是否说话由语义判定决定，并非每条都念 |

## 连接模式

- `reverse`（默认，fat-fish 风格）：本扩展开一个 WebSocketServer（配置 `wsHost`/`wsPort`/`wsPath`），在 NapCat 里把「反向 WebSocket」指向 `ws://<host>:<port><path>`，NapCat 主动连入。
- `forward`（内置风格）：本扩展作为客户端，配置 `wsUrl` 指向 NapCat 暴露的 OneBot WebSocket 地址。

两种模式走同一套帧处理：带 `echo` 的是 API 回包，带 `post_type` 的是事件。

## 配置（`config.json` 的 `worlds.qqbot` 节）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 启用本 world |
| `mode` | `reverse` | `reverse` / `forward` |
| `wsUrl` | `ws://127.0.0.1:3001` | 正向模式地址 |
| `wsHost` / `wsPort` / `wsPath` | `0.0.0.0` / `8080` / `/onebot/v11` | 反向模式监听 |
| `token` | `""` | OneBot access_token（两端一致；空=不校验） |
| `groups` / `privates` | `[]` | 监听群号 / 私聊 QQ；`groups` 为空=接入全部群 |
| `privateAggregationWindow` | `30000` | 私聊连续消息聚合窗口(ms) |
| `maxMessageBytes` | `1500` | 长文本强制分片字节数 |
| `deliverImageAttachments` | `true` | 图片作为模型附件（需模型支持图像） |
| `vision.enabled` | `false` | 被动视觉描述图片（需配置 OPENROUTER_API_KEY） |
| `vision.model` | `google/gemini-2.5-flash` | VLM 模型 |
| `qzone.enabled` | `false` | 启用 QQ 空间动态（说说）功能 |
| `qzone.systemPrompt` | 中性占位（见下） | 发表/回评时的第一人称人设（默认中性占位，实际人设由部署级 ORIENTATION 决定） |
| `qzone.endpoint` / `qzone.model` | OpenRouter / `google/gemini-2.5-flash` | 生成动态文案的 OpenAI 兼容端点 |
| `qzone.tickSec` / `qzone.chancePerTick` | `900` / `0.15` | 后台自动冒泡间隔(秒)与每次触发概率 |
| `qzone.dailyQuota` | `5` | 每日自动发表上限 |
| `qzone.permission` | `1` | 动态可见范围（0=公开/1=好友/...，取决于 NapCat） |
| `qzone.imageMode` | `none` | `none`=不带图 / `recent`=附上最近一张收到/发出的图 |
| `qzone.autoReplyComments.enabled` | `false` | 收到空间评论时自动回复 |
| `qzone.autoReplyComments.chance` | `0.5` | 单条评论自动回复概率 |
| `qzone.commentAction` | `send_qzone_comment` | 回评所用的 OneBot action 名（NapCat 可能为其它名，可改） |
| `proactive.topicSimilarity` | `0.6` | 主动消息与近期已发内容的相似度上限（0~1，字符二元组 Jaccard）；超过则跳过，防同一话题反复换汤不换药。0=关闭 |
| `groupSpeak.enabled` | `true` | 群聊发言频率限制开关（含主动与回复） |
| `groupSpeak.maxPerWindow` | `12` | 滑动窗口内每个群允许发出的消息上限 |
| `groupSpeak.windowSec` | `60` | 限速滑动窗口长度（秒） |
| `antiLoop.enabled` | `true` | 话题防死循环开关 |
| `antiLoop.maxConsecutiveBotTurns` | `5` | 单会话内 bot 连续发言上限（对方发来任意消息即清零），超过则本次发言被拦截并提示收尾 |
| `antiLoop.idleToEndSec` | `300` | 对方静默超过该秒数且 bot 已发过言，则自动收尾（0=关闭该规则） |
| `emotion.enabled` | `true` | 是否启用情绪感知与注入（移植自 fat-fish emotion） |
| `emotion.decayHours` | `2.0` | 心情值自然回落到中性（0）的半衰期（小时），越小忘得越快 |
| `emotion.labelMinutes` | `40` | 主导情绪标签冷却（分钟）；实际生效冷却为 `labelMinutes × 当前强度`，冷却期内不切换标签，避免来回横跳 |
| `emotion.model` | `deepseek-chat` | 用于分析用户消息情绪、抽取心情变化（情绪/强度/起因）的 chat 模型（OpenAI 兼容端点） |
| `emotion.endpoint` | `https://api.deepseek.com/v1` | 情绪感知所用 chat 端点 |
| `emotion.apiKeySecret` | `DEEPSEEK_API_KEY` | 端点密钥的环境变量名 |
| `routine.enabled` | `false` | **AI 作息**开关（默认关）。开启后 bot 按真实时间切换睡眠/午休/活跃三段 |
| `routine.sleepStart` / `routine.sleepEnd` | `23:00` / `07:30` | 睡眠段起止（`HH:MM`，可跨午夜）。睡眠段内**自动暂停主动冒泡**（被动回复照常）|
| `routine.lazyStart` / `routine.lazyEnd` | `12:00` / `14:00` | 午休段起止。该段内主动说话节奏放缓（更短更随意）|
| `routine.greetSleep` / `routine.greetWake` / `routine.greetLazy` | 见源码默认值 | 时段切换时的**兜底**文案：正常播报由 LLM 现场生成（每次说法不固定），仅当生成失败才回退到这几句；留空=无兜底直接跳过 |
| `reminder.enabled` | `true` | **到点提醒**开关。开启后到点自动把提醒发到对应会话；记录/查询/取消不受此开关影响（始终可用）|
| `affinity.enabled` | `true` | **好感度系统**开关。开启后，与该用户对话时其当前好感度会自动注入上下文、影响态度与分寸；`qq_affinity_*` 工具始终可用 |
| `voice.enabled` | `false` | **语音（ASR+TTS）**开关 |
| `voice.provider` | `native` | 语音供应商（实现方式）。可选项由 `src/voice.ts` 注册表动态生成：`native`=OneBot 原生 `translate_record`/`tts`（零依赖、开箱即用）；`custom`=用「网址+API Key」对接远程 OpenAI 兼容音频服务（GLM/OpenAI/自建等）；`local`=本地/自建模型（OpenAI 兼容、免 API Key、慢推理可加超时、支持额外参数做声音克隆/设计，如 VoxCPM2 经 vLLM-Omni）。新增供应商只需在 `voice.ts` 用 `registerVoiceProvider` 注册 |
| `voice.asr` | `true` | 开启语音识别（收到语音→转文字） |
| `voice.tts` | `true` | 开启语音合成（回复时念成语音） |
| `voice.semanticJudge` | `true` | 是否用 LLM 判断"这条回复要不要念出来"，避免每条都念 |
| `voice.audioFallback` | `true` | 当语音合成失败（如本地模型崩溃/超时）时，是否回退为纯文字发送，而不是吞掉这条回复 |
| `voice.judgeEndpoint` | `https://api.deepseek.com/v1` | 语义判定所用 OpenAI 兼容 chat 端点（**不绑定任何模型商**，可填你自己的） |
| `voice.judgeApiKeySecret` | `DEEPSEEK_API_KEY` | 语义判定端点密钥的环境变量名 |
| `voice.judgeModel` | `deepseek-chat` | 语义判定所用 chat 模型名 |
| `voice.voiceBaseUrl` | `""` | 选 `custom` / `local` 时必填：OpenAI 兼容音频端点基址（远程如 `https://open.bigmodel.cn/api/paas/v4` 或 `https://api.openai.com/v1`；本地如 `http://localhost:8000/v1`）。ASR 走 `{网址}/audio/transcriptions`，TTS 走 `{网址}/audio/speech` |
| `voice.voiceApiKeySecret` | `VOICE_API_KEY` | `custom` 供应商 API Key 所在的环境变量名；`local` 供应商免 Key，留空即可 |
| `voice.voiceVoice` | `""` | 音色（仅当所选语音模型支持时填写，如 `tongtong`）；留空用服务商默认 |
| `voice.voiceAsrModel` | `whisper-1` | 语音识别模型名（OpenAI 兼容 `/audio/transcriptions`，GLM 用 `glm-asr-2512`） |
| `voice.voiceTtsModel` | `tts-1` | 语音合成模型名（OpenAI 兼容 `/audio/speech`，GLM 用 `glm-tts`，VoxCPM2 一般为 `openbmb/VoxCPM2`） |
| `voice.voiceTimeout` | `120` | 请求超时（秒）：TTS/ASR 单次请求最长等待，`custom` 与 `local` 共用，本地推理慢可调大（1~1800） |
| `voice.voiceExtraTts` | `{}` | TTS 额外参数（JSON 字符串）：合并进 `/audio/speech` 请求体，用于本地模型高级特性（如 VoxCPM2 声音克隆 `{"reference_audio":"<url或base64>"}`、声音设计 `{"voice_design":"一个温柔的少年音"}`、或 `{"language":"zh"}`） |
| `voice.voiceExtraAsr` | `{}` | ASR 额外参数（JSON 字符串）：合并进 `/audio/transcriptions` 表单（如 `{"language":"zh"}`） |
| `voice.voiceTranscribeUrl` | `""` | **专用识别服务地址（alont1 风格 ASR）**：POST `{地址}/asr` 收 WAV 字节 → `{text}`。非空时**优先**走此路（ffmpeg 把 SILK/AMR 解码成 WAV 再送识别），比 OpenAI `/audio/transcriptions` 更稳地处理 QQ 原生 SILK 语音；空=走供应商自带 ASR |
| `voice.voiceTranscribeTimeout` | `60000` | 识别超时（毫秒）：单次 ffmpeg 解码 + `/asr` 请求共用，超时回退供应商自带 ASR 或文字（1000~600000） |
| `voice.voiceFfmpegPath` | `""` | ffmpeg 可执行文件路径（用于把 SILK/AMR 解码成 WAV）。空=依次找 PATH 与仓库 `node_modules/ffmpeg-static`（win 用 `ffmpeg.exe`）；找不到则识别服务不可用 |

> 连接类参数（mode/地址/端口/token）改动后需**整机重启**生效；监听名单（groups/privates）同理。群聊限速/防死循环/**主动相似度**/作息/闹钟均为热配置，控制台改完即时生效（`routine.*` / `reminder.*` 也是 `x-hot`）。

## AI 作息（routine）

让 bot 按真实时间过"作息"：

- **睡眠段**（`sleepStart`→`sleepEnd`，可跨午夜）：暂停"主动冒泡"定时器（不对着没找它的人发起话题），但被动回复照常——即"睡着了但被戳醒仍会回"。
- **午休段**（`lazyStart`→`lazyEnd`）：主动说话节奏放缓。
- **活跃段**：正常主动冒泡。
- 进入/离开某个时段时，会向所有可主动说话的会话**播报一句**（去睡 / 醒来 / 午休）。这句文案**由 LLM 现场生成**（带人设+记忆），所以每次说法都不一样、不会念固定套话；只有在 LLM 生成失败时才回退到 `routine.greetSleep/Wake/Lazy` 兜底文案。
- 时段状态与"上次切换到的段"会持久化到 `proactive-state.json`；首次上线（无存档）不会立刻补播报，从下一次真实切换开始播。

> 作息与情绪、记忆互不冲突：睡眠段只是收起"主动找人"，并不清空心情或记忆。

## 闹钟 / 记事本（reminder）

让智能体把"以后要做的事 / 约定"记下来，到点自动提醒，相当于它的随身备忘录 + 闹钟。

- **记提醒**：对话中用户说"提醒我三点开会""帮我记一下明天还书"，智能体调用 `qq_reminder_add`，并给出时间（`when`）和内容（`text`）。时间支持多种写法：
  - 绝对 ISO：`2026-09-24T15:00`
  - `HH:MM`（今天；已过则顺延明天）、`明天 9:00`、`今天 21:30`
  - 相对：`in 30m`、`30分钟后`、`2小时后`、`3天后`
  - 调用成功会返回 `id` 与解析后的时间，智能体应把"已记好、几点提醒"回给用户。
- **到点自动提醒**：后台每 30 秒扫描一次，到期未完成的提醒会自动发到**记录它时所在的那个会话**（群或私聊），文案形如 `⏰ 到点提醒：<内容>`；并把"我之前记的提醒到点了"回灌进上下文，便于它接话/确认。离线期间到期的提醒，重启后会自动补发。
- **查看 / 取消**：`qq_reminder_list` 列出所有待提醒（id、内容、时间），`qq_reminder_cancel` 按 id 取消。
- **持久化**：所有提醒落盘 `dataDir/reminders.json`，跨整机重启不丢。
- **开关**：`reminder.enabled`（默认开）只控制"到点自动发提醒"；记录/查询/取消始终可用。可在控制台实时开关（`x-hot`）。
- 控制台"闹钟/记事本"状态灯会显示当前待提醒条数。

> 约定时间以 bot 所在机器本地时区（`timezone`，默认 `Asia/Shanghai`）为准。

## 好感度（affinity）

对每个用户（按 QQ 号区分，跨群/私聊同一份）维护一份**关系分**，让 bot 像真人一样"亲疏有别"：

- **可正可负**：范围 `-100 ~ 100`，初始 `0 = 普通`。让人舒服/投缘就加，让人反感/越界就减——**不是只增不减**。
- **调整**：对话中 bot 判断互动质量后调用 `qq_affinity_adjust`，传 `delta`（正数加、负数减，如 `+5` / `-10`）与可选 `reason`（记一笔原因）；群聊需指定 `who`（对方 QQ 号），私聊省略则默认对方。
- **查询 / 总览**：`qq_affinity_get` 查某人，`qq_affinity_list` 按好感度从高到低列出所有人。
- **注入上下文影响聊天**：`affinity.enabled`（默认开）时，用户每条消息前会把"你对 TA 当前好感度 + 关系状态 + 该把握的分寸"作为内部上下文注入，bot 据此自然调节语气（高好感更亲昵放松、低/负好感更客气疏远保持距离）；不注入数字、不刻意强调关系分，避免生硬。
- **持久化**：落盘 `dataDir/affinity.json`，跨重启不丢。
- **控制台**："好感度"状态灯显示已记录人数；徽标显示人数。

> 说明：好感度是 bot 自发的"关系判断"，加不加、加多少由它在对话里自己拿捏（也可用工具显式调整）。开关 `affinity.enabled` 只控制是否自动注入上下文；`qq_affinity_*` 工具始终可用（`x-hot` 实时生效）。

## 语音（ASR + TTS）

让 bot 能**听语音**（ASR，语音消息转文字）也能**说语音**（TTS，文字回复念成语音）。设计目标是**供应商不写死、可插拔**，方便对接不同模型商或本地模型（例如 VoxCPM2）。

### 开关与基本行为

- `voice.enabled` 总开关；`voice.asr` / `voice.tts` 分别控制收语音转文字 / 发语音。
- **语义判定**：`voice.semanticJudge`（默认开）用 LLM 判断"这条回复要不要念出来"，避免每条都念。判定走独立的 `judgeEndpoint`/`judgeApiKeySecret`/`judgeModel`（**不绑定任何模型商**，可填你自己的 chat 端点）。关闭则"要发语音的回复一律念"。
- **失败回退**：`voice.audioFallback`（默认开）——当语音合成失败时（本地模型崩了 / 超时 / 端点挂了），回退为纯文字发送，而不是吞掉这条回复。

### 供应商（实现方式）

`voice.provider` 下拉项由 `src/voice.ts` 的**注册表**动态生成（不是写死），当前内置三档：

| 供应商 | 鉴权 | 协议 | 适用场景 |
|---|---|---|---|
| `native` | 无 | OneBot 原生 `translate_record` + `tts` | 零依赖、开箱即用；依赖 NapCat 服务端已解码 SILK 等格式 |
| `custom` | 需要 API Key | OpenAI 兼容 `/audio/transcriptions` + `/audio/speech` | 远程模型服务（OpenAI / GLM / 自建兼容服务），配 `voiceBaseUrl`+`voiceApiKeySecret` |
| `local` | **免 Key** | OpenAI 兼容 `/audio/transcriptions` + `/audio/speech` | 本地/自建模型（如 VoxCPM2 经 vLLM-Omni）；慢推理靠 `voiceTimeout` 加超时；高级特性靠 `voiceExtraTts`/`voiceExtraAsr` 额外参数透传 |

三档共用同一套 OpenAI 兼容协议：`ASR`=`POST {baseUrl}/audio/transcriptions`（表单 `file`+`model`+额外参数），`TTS`=`POST {baseUrl}/audio/speech`（JSON `model`+`voice`+`input`+额外参数）。

### 专用识别服务（alont1 风格 ASR，更稳地处理 QQ 原生 SILK 语音）

如果现有供应商的 ASR 识别不了 QQ 发来的 **SILK/AMR** 语音（OpenAI 兼容端点一般只认 wav/mp3/flac），可单独配一个**识别服务**，与上面三档供应商解耦：

- **原理**（参考 alont1 的实现）：先用 **ffmpeg** 把语音 url 解码成 `16k 单声道 WAV`（`-f wav -ac 1 -ar 16000 pipe:1`，best-effort），再把 WAV 字节 `POST {voiceTranscribeUrl}/asr`（content-type `audio/wav`）发到你的识别服务，服务返回 `{ text: "..." }`。
- **配置**：`voice.voiceTranscribeUrl` 填识别服务地址（如 `http://127.0.0.1:7798`），配了之后**优先走这条**；识别失败/超时则自动回退到供应商自带 ASR（native 的 `translate_record` / custom·local 的 `/audio/transcriptions`），再不行就当无文字处理，绝不阻塞消息。
- **ffmpeg**：`voice.voiceFfmpegPath` 可指定 ffmpeg 路径；留空则依次找 `PATH` 与仓库 `node_modules/ffmpeg-static`（win 用 `ffmpeg.exe`）。找不到 ffmpeg 时识别服务不可用，会自动跳过走其他 ASR。
- **超时**：`voice.voiceTranscribeTimeout`（毫秒，默认 60000）约束"解码 + /asr 请求"的单次耗时。
- **服务契约**：你只需提供一个 `POST /asr` 接口，收 WAV 字节、回 `{text}`，即可对接任意后端（faster-whisper、VoxCPM2 的 ASR、私有 ASR 等），无需改本插件代码。

### 接入本地模型（以 VoxCPM2 为例）

VoxCPM2（OpenBMB，2B 参数 TTS）经 **vLLM-Omni** 提供 OpenAI 兼容接口，启动后自带 `/audio/speech`：

```bash
# 启动本地服务（具体命令随 vLLM-Omni 版本，端口自定）
vllm serve openbmb/VoxCPM2 --omni --port 8000
```

然后在语音配置组里：

1. **实现方式**选 `local`
2. **语音模型网址**填 `http://localhost:8000/v1`（即上面的 `--port` 对应 base url）
3. **语音 API Key 变量**留空（`local` 免 Key）
4. **TTS 模型名**填 `openbmb/VoxCPM2`（或该服务暴露的模型 id）
5. **请求超时(秒)**按机器显卡调到合适值（本地推理慢，默认 120，可到几百）
6. **TTS 额外参数(JSON)**可选做声音克隆 / 声音设计：
   - 声音克隆：`{"reference_audio":"<音频 url 或 base64>"}`
   - 声音设计：`{"voice_design":"一个温柔的少年音"}`
   - 指定语言：`{"language":"zh"}`

> 说明：VoxCPM2 主要做 **TTS**，一般不做 ASR。需要本地语音识别时，可另跑一个本地 faster-whisper（同样暴露 OpenAI 兼容 `/audio/transcriptions`，与 TTS 同址即可），或把 ASR 保持 `native`（由 NapCat 服务端解码）。

### 新增自定义供应商（进阶）

若某模型接口不是 OpenAI 兼容（例如某厂商私有协议），在 `src/voice.ts` 实现 `VoiceProvider` 接口并 `registerVoiceProvider(...)` 即可，下拉项会自动出现，无需改 UI 代码：

```ts
interface VoiceProvider {
  id: string;                                  // 下拉项 key
  transcribe(ctx): Promise<string | null>;    // 返回转写文本；null=回退文字
  synthesize(ctx): Promise<RecordSeg | null>;  // 返回 { type:'record', data:{ file } }；null=回退文字
  checkDeps?(cfg, log): boolean;               // 可选：依赖检查/告警
}
```

## 工具

- `qq_send`：起草要发送的消息（群或私聊），返回草稿编号。**不会立即发送**。
- `qq_confirm_send`：确认并真正发送草稿（带 `barrierAfter`，防止连续误发）。
- `qq_recent`：查询某群/私聊最近消息。
- `qq_search`：按关键词检索历史消息。
- `qq_qzone_post`：发表 QQ 空间动态（说说）。支持 `content`（正文）、`topic`（话题）、`images`（图片数组）、`ats`（@ 的 QQ 号数组）、`permission`（可见范围）。正文由 LLM 依据对话与记忆以第一人称自动生成；`content` 留空时由人设驱动。
- `qq_qzone_delete`：删除指定 `tid` 的动态。
- `qq_qzone_reply`：回复某条动态的评论（`tid` + `comment_id` + `content`）。
- `qq_qzone_feeds`：拉取自己的空间动态列表（`num`）。
- `qq_qzone_status`：返回空间功能开关、今日已发数/配额、待回评等状态。
- 群聊发言限速 / 话题防死循环在 `qq_send` 发送环节统一生效：当某群达到窗口上限，或某会话 bot 连续发言超限/对方久未接话时，`qq_send` 会返回「未能发送：…（发言频率已达上限 / 话题自动收尾）」而不是真正发出。这是正常节流，不是报错。
- **语音工具 / 命令**：
  - 收语音：QQ 语音消息经 `voice.provider` 指定的 ASR 后（如 `native` 的 `translate_record`、或 OpenAI 兼容 `/audio/transcriptions`）转成文字进入对话；SILK 等编码能否被识别取决于所选供应商（QQ 语音多为 SILK，`native` 由 NapCat 服务端解码最稳，`custom`/`local` 一般要 wav/mp3/flac）。
  - 说语音：`voice.tts` 开启且语义判定认为该念时，回复文字经 TTS 合成成语音段（如 `native` 的 `tts` 或 OpenAI 兼容 `/audio/speech`，`local` 可透传 `voiceExtraTts` 做声音克隆/设计）发出；失败且 `voice.audioFallback` 开启时回退文字。
  - 运行时命令（聊天里即时生效，优先级高于控制台配置）：`/语音 开` / `/语音 关`（整体开关）、`/语音 asr 开|关`、`/语音 tts 开|关`、`/语音 判定 开|关`、`/语音 状态`（查看当前开关与所选供应商）。开关为运行时内存态，整机重启回到控制台 `voice.*` 默认值。
- **情绪系统（移植自 fat-fish `emotion.py`）**：
  - 每轮用户发言后，由 LLM 抽取本次心情变化（情绪/强度/起因），维护**全局一份**心情状态（多情绪叠加、自然衰减、主导情绪冷却）。
  - 把当前心情提示词（心情值 + 主导情绪 + 行为引导）注入 **Cortico 全局上下文**（`ENV_PROMPT.md` 的 `{{qq.emotion}}`），让模型在回复中带上情绪质感。
  - 用户问「你心情怎么样 / 你现在什么情绪 / /心情」时，自动把心情描述追加进 system 提示，让模型据实回答；`/心情 重置` 可把心情清零回平静。
  - **运行时开关（聊天命令，即时生效，优先级高于控制台配置）**：`/心情 开` 开启、`/心情 关` 关闭（关闭后不再感知新消息、不再把情绪注入上下文，但 `/心情` 仍可查当前残留状态）、`/心情 状态` 查看当前开/关。该开关是运行时内存态，整机重启后回到控制台 `emotion.enabled` 的默认值。控制台里 `emotion.enabled` 仍是持久默认开关（热保存）。
  - 迁怒防护：当检测到"别人骂你，但你却想对另一个人发火"时，提示里会加提醒，避免迁怒无辜。
- **好感度系统（affinity）**：
  - `qq_affinity_adjust`：调整某用户好感度。`who`（群聊必填、私聊可省）填对方 QQ 号；`delta` 正数加、负数减（如 `+5` / `-10`）；`reason` 可选，记一笔加减原因。调整后好感度会在该用户下条消息时自动注入上下文。
  - `qq_affinity_get`：查询某人当前好感度（`who` 规则同上）。
  - `qq_affinity_list`：按好感度从高到低列出所有人（qq / 昵称 / 分数 / 状态 / 上次原因）。
  - 当前用户好感度会以"关系备忘"形式自动注入对话上下文（受 `affinity.enabled` 控制），bot 据此调节语气分寸。
- **智能体私人笔记本（notebook）**：让 AI 记录自己想记的东西，独立于聊天/记忆系统之外。
  - `qq_note_save`：记一条笔记（`text` 必填）。记忆插件（`cortico-world-memory`）启用时写入其笔记库 `qq` scope（常驻环境提示词、可混合检索）；未启用时落到本插件 `dataDir/notebook.jsonl`（原生）。
  - `qq_note_list`：列出全部笔记，返回编号/条目 id 与内容。
  - `qq_note_get`：按 id 查看某条笔记完整内容。
  - `qq_note_forget`：按 id 删除一条笔记。

## 智能体私人笔记本（notebook）

让 AI 拥有自己的「私人笔记本」，记录它想记的东西（灵感、待办、对某人的看法、不想忘的小事……），与对话历史、闹钟/记事本、长期记忆系统解耦。

- **后端自动路由（零配置）**：
  - 当 `cortico-world-memory` 记忆插件启用时，笔记走记忆插件的笔记库 `qq` scope：享受常驻环境提示词（记忆插件会把 `qq` scope 笔记并入 agent 的上下文）与混合检索（BM25 + 向量 + RRF）；同一台机器上多个 world 共享记忆库。
  - 当记忆插件未安装或未启用时，自动回退到本插件的原生 JSONL 文件：`<dataDir>/notebook.jsonl`，每条用稳定字符串 id（`n_<时间戳>_<随机>`）标识，完全离线、无外部依赖。
  - 路由在**每次调用时惰性判定**，与 world 启动顺序无关：即使记忆插件中途启/停，笔记也能正确切换后端，不会写错地方。
- **工具**：`qq_note_save` / `qq_note_list` / `qq_note_get` / `qq_note_forget`（见上方「工具」节）。`qq_note_save` 的返回会告诉模型当前记到了哪个后端（`memory` / `native`）。
- **典型用法**：在对话中模型自发调用 `qq_note_save` 记下灵感；想回顾时 `qq_note_list` 列出、`qq_note_get` 看详情；确定不再需要时 `qq_note_forget` 删除。
- **与闹钟/记事本的区别**：闹钟/记事本（`reminder`）是带时间的提醒，会被触发；笔记本是纯「想记就记」的随手记，不会被主动触发，只被动查询/注入（记忆插件模式下）。

## 控制台

- **面板「监听名单」**：显示当前监听的群/私聊、成员数、最后消息时间。
- **面板「实时事件」**：订阅并实时回放 QQ 消息与通知流。
- **配置组「QQ · 连接与监听」**：在控制台编辑连接参数与监听名单（热保存，连接类需重启）。
- **配置组「QQ 空间动态」**：在控制台开关空间功能、调人设/概率/配额/附图模式（热保存）。
- **面板「QQ 空间动态」状态灯**：显示是否开启、今日已发/配额、待回评数徽章。
- **配置组「QQ · 语音（ASR/TTS）」**：在控制台切换供应商（`native`/`custom`/`local`）、开/关收发语音、调语义判定与回退、填模型网址/API Key/音色/ASR/TTS 模型名/超时/额外参数（热保存，改完一般即时生效；部分连接类无需重启）。
- **状态灯「语音」**：显示语音总开关、所选供应商、ASR/TTS/语义判定各自的开关状态。
- **状态灯「群聊限速/防死循环」**：显示群发言限速（窗口/上限）与防死循环（连续上限/静默收尾）的当前配置。
- **徽章「群限速」「防死循环」**：控制台顶栏实时显示两者开关与阈值。

## 部署

1. 把本目录装进部署副本：`Cortico/extensions/node_modules/cortico-world-qq-better/`（保留 `src/`、`package.json`、`README.md`、`ENV_PROMPT.md`）。
2. `cd` 到该副本，`corepack pnpm install --prod` 安装 `ws` 依赖。
3. 在部署的 `config.json` 写入：
   ```json
   { "worlds": { "qqbot": { "enabled": true, "mode": "reverse", "wsPort": 8080, "groups": [123456789] } } }
   ```
4. 整机重启 Cortico（`POST /api/run/restart` 或重启进程）。
5. 在 NapCat 配置反向/正向 WebSocket 指向本扩展。

## 已知限制 / 与原版的差异

- 语音解码：QQ 语音多为 **SILK** 编码。`native` 供应商由 NapCat 服务端（如 NapCat 的 `translate_record`）解码最稳；`custom`/`local` 供应商走 OpenAI 兼容接口，一般要求 wav/mp3/flac，对 SILK 支持不稳。若识别不了 SILK，可配 **`voice.voiceTranscribeUrl` 专用识别服务**（ffmpeg 解码 SILK→WAV 后 `POST /asr`），该路径优先于供应商自带 ASR；需本机有 ffmpeg（见 `voice.voiceFfmpegPath`）。本地/远程服务不可达或超时（`voiceTimeout` / `voiceTranscribeTimeout` 控制）时不阻塞对话，按 `voice.audioFallback` 回退文字。
- 合并转发展开、视频/文件等大二进制默认只做文本占位（不自动作为附件，避免撑爆上下文）。
- 群成员名片为空时尝试补一次 `get_group_member_info`，但离线名片仍以 NapCat 推送为准。
- 引用回复走实时 `get_msg`（与 fat-fish 一致），需要 NapCat 暴露该 API；引用库外消息也能正确拉取。
- 表情包图片通过 `[表情包:文件名]` 发送，文件需放在 `emojiDir` 配置目录（默认 `<扩展>/emoji`）；文件缺失则该标记被丢弃，不报错。
- 中文表情名（如 `[旺柴]`/`[笑哭]`）按 fat-fish 的 `FACE_MAP` 映射到 face id；未知方括号文本原样保留。
- 系统表情标记 `[表情22：白眼]` / `[表情22:白眼]`（数字为 QQ face id，支持全角/半角冒号与可选空格）会被解析成真正的 `face` 段发送。早期版本只认半角冒号，bot 照着入站的全角冒号写法输出时会变成"不存在的表情"文本，已于 0.1.8 修复。
- 被动视觉默认关闭；开启需自备 OpenAI 兼容（如 OpenRouter）Key 与可访问的图片 URL。
- QQ 空间功能依赖 NapCat 的 `send_qzone_msg` / `delete_qzone_msg`；部分 NapCat 版本未暴露空间 API，开启后调用会失败（可在控制台看错误）。
- 回评 action 名（默认 `send_qzone_comment`）按 NapCat 版本不同可能变化，失败请在控制台改 `qzone.commentAction`。
- `qq_qzone_feeds` 拉取列表为 best-effort，取决于 NapCat 是否实现 `get_qzone_msg_list`；取不到时返回空。
- 动态文案默认走 OpenRouter `google/gemini-2.5-flash` 生成，需配置对应 API Key；`content` 留空且未配 Key 时退化为简短占位文案。
