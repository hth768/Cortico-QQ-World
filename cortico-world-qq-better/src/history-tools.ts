import type { ToolDef, WorldHost } from 'cortico/core/types.ts';
import { shortTime } from 'cortico/core/util.ts';

export interface HistoryCtx {
  getHost: () => WorldHost | null;
  sourceId: string;
  timezone: string;
  convLabel: (address: string) => string;
}

/** 群聊历史查询工具（Cortico 内置 world 的可增量特性）。 */
export function makeHistoryTools(ctx: HistoryCtx): ToolDef[] {
  return [
    {
      name: 'qq_recent',
      tags: ['read'],
      description:
        '查询某个群或私聊最近的消息（按时间倒序）。用于回顾刚才说过的话、确认上下文。参数 group 为群号；查私聊时改用 peer。',
      parameters: {
        type: 'object',
        properties: {
          group: { type: 'number', description: '群号；与 peer 二选一。' },
          peer: { type: 'number', description: '私聊对方 QQ；与 group 二选一。' },
          minutes: { type: 'number', description: '回溯时间窗（分钟），默认 60。' },
          limit: { type: 'number', description: '最多返回条数，默认 30。' },
        },
        required: [],
      },
      handler: async (args) => {
        const host = ctx.getHost();
        if (!host) return '历史存储尚未就绪。';
        const group = typeof args.group === 'number' ? args.group : Number(args.group ?? 0);
        const peer = typeof args.peer === 'number' ? args.peer : Number(args.peer ?? 0);
        const address = group ? `group:${group}` : peer ? `private:${peer}` : '';
        if (!address) return '请提供 group 或 peer。';
        const limit = Math.min(Number(args.limit ?? 30), 100);
        const minutes = Number(args.minutes ?? 60);
        const fromTs = new Date(Date.now() - minutes * 60_000).toISOString();
        const events = host.store
          .range({ source: ctx.sourceId, senderKey: address, fromTs, limit: limit * 4 })
          .filter((e) => e.type === 'qq.message')
          .slice(-limit)
          .reverse();
        if (!events.length) return `${ctx.convLabel(address)} 在最近 ${minutes} 分钟内没有消息记录。`;
        const label = ctx.convLabel(address);
        const lines = events.map(
          (e) => `[${shortTime(ctx.timezone, new Date(e.ts))}] ${e.senderKey ?? ''} ${e.text}`,
        );
        return `${label} 最近消息：\n${lines.join('\n')}`;
      },
    },
    {
      name: 'qq_search',
      tags: ['read'],
      description: '在 QQ 消息记录中按关键词检索历史消息，返回匹配片段及上下文。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '不区分大小写的包含匹配关键词。' },
          limit: { type: 'number', description: '最多返回的命中组数，默认 10。' },
        },
        required: ['keyword'],
      },
      handler: async (args) => {
        const host = ctx.getHost();
        if (!host) return '历史存储尚未就绪。';
        const keyword = String(args.keyword ?? '').trim();
        if (!keyword) return '请提供 keyword。';
        const limit = Math.min(Number(args.limit ?? 10), 30);
        const hits = host.store.grep({ keyword, source: ctx.sourceId, limit, context: 1 });
        if (!hits.length) return `没有找到包含「${keyword}」的 QQ 消息。`;
        const blocks = hits.map((h) => {
          const lines = h.events.map((e) => `[${shortTime(ctx.timezone, new Date(e.ts))}] ${e.senderKey ?? ''} ${e.text}`);
          return lines.join('\n');
        });
        return `检索「${keyword}」命中 ${hits.length} 处：\n\n${blocks.join('\n\n')}`;
      },
    },
  ];
}
