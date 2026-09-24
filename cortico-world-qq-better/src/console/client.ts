// QQ 扩展控制台面板 bundle（浏览器端，ESM）。
// 自包含类型，不 import cortico/*，便于 esbuild 独立打包（框架只要求 default 导出 ConsoleClientBundle）。

interface ConsoleUi {
  sheet(opts: { title: string; en?: string; desc?: string }): {
    el: HTMLElement;
    body: HTMLElement;
    note: HTMLElement;
    desc: HTMLElement | null;
  };
  rowbar(): HTMLDivElement;
  pill(text: string, tone?: string): HTMLSpanElement;
  placeholder(text: string): HTMLDivElement;
  msgline(text?: string, bad?: boolean): HTMLDivElement;
  table(opts?: { head?: readonly string[]; maxHeight?: string }): {
    el: HTMLDivElement;
    body: HTMLTableSectionElement;
    addRow(cells: readonly (string | number | null | undefined | HTMLElement)[]): HTMLTableRowElement;
    clear(empty?: string): void;
  };
  log(opts?: {
    variant?: string;
    max?: number;
    maxHeight?: string;
    empty?: string;
  }): {
    el: HTMLElement;
    append(line: string, tone?: string): HTMLDivElement;
    clear(): void;
    count: number;
    stuck: boolean;
    scrollToEnd(): void;
  };
}

interface ConsolePanelContext {
  pageId: string;
  panelId: string;
  language: string;
  root: HTMLElement;
  signal: AbortSignal;
  invoke<T = unknown>(method: string, args?: unknown[]): Promise<T>;
  stream(handlers: {
    message: (text: string) => void;
    open?: () => void;
    close?: (willRetry: boolean) => void;
  }): { dispose(): void };
  own<T>(d: T): T;
  ui: ConsoleUi;
}

interface ConsolePanel {
  mount(ctx: ConsolePanelContext): unknown;
}

interface ConsoleClientBundle {
  panels: Record<string, ConsolePanel>;
}

interface RosterConv {
  address: string;
  label?: string | null;
  kind: 'group' | 'private' | string;
  active?: boolean;
  members?: number;
  lastMessageAt?: string | null;
}

interface RosterResult {
  selfId?: string | number | null;
  mode?: string;
  groups?: number[];
  privates?: number[];
  convs?: RosterConv[];
}

interface EventFrame {
  ts?: number;
  type?: string;
  senderKey?: string | null;
  text?: string | null;
}

function fmtClock(ts: unknown): string {
  const n = typeof ts === 'number' ? ts : typeof ts === 'string' ? Date.parse(ts) : NaN;
  if (!Number.isFinite(n)) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtTime(ts: unknown): string {
  const n = typeof ts === 'number' ? ts : typeof ts === 'string' ? Date.parse(ts) : NaN;
  if (!Number.isFinite(n)) return '—';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(n)}`;
}

const rosterPanel: ConsolePanel = {
  async mount(ctx) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: '监听名单', en: 'roster', desc: '当前监听的群聊与私聊，及最近消息时间。' });

    let data: RosterResult;
    try {
      data = await ctx.invoke<RosterResult>('getRoster');
    } catch (err) {
      sheet.body.appendChild(ui.msgline(`读取监听名单失败: ${(err as Error).message}`, true));
      ctx.root.append(sheet.el);
      return;
    }
    data ??= {};
    const groups = data.groups ?? [];
    const privates = data.privates ?? [];
    const convs = data.convs ?? [];

    const bar = ui.rowbar();
    bar.append(
      ui.pill(`本号 ${data.selfId ?? '?'}`, 'plain'),
      ui.pill(`模式 ${data.mode ?? '?'}`, 'plain'),
      ui.pill(`群 ${groups.length}`, 'plain'),
      ui.pill(`私聊 ${privates.length}`, 'plain'),
    );
    sheet.body.append(bar);

    if (convs.length === 0) {
      sheet.body.append(ui.placeholder('还没有任何会话。让 bot 收到消息或把它加入监听名单后，这里会出现记录。'));
    } else {
      const table = ui.table({
        head: ['类型', '名称', '账号', '人数', '已激活', '最近消息'],
        maxHeight: 'calc(100vh - 320px)',
      });
      for (const c of convs) {
        const kindLabel = c.kind === 'group' ? '群' : c.kind === 'private' ? '私聊' : String(c.kind);
        table.addRow([
          kindLabel,
          c.label ?? '',
          String(c.address),
          String(c.members ?? 0),
          c.active ? '是' : '否',
          fmtTime(c.lastMessageAt),
        ]);
      }
      sheet.body.append(table.el);
    }

    ctx.root.append(sheet.el);
  },
};

const eventsPanel: ConsolePanel = {
  mount(ctx) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: '实时事件', en: 'events', desc: 'QQ 消息与通知的实时流（含最近 20 条回放）。' });

    const log = ui.log({ variant: 'conversation', empty: '等待事件…' });
    sheet.body.append(log.el);

    const handle = ctx.stream({
      open() {
        log.append('已连接事件通道', 'dim');
      },
      message(raw) {
        let f: EventFrame;
        try {
          f = JSON.parse(raw) as EventFrame;
        } catch {
          log.append(raw, 'dim');
          return;
        }
        const sign = f.type?.endsWith('.recall')
          ? '↩'
          : f.type === 'qq.message'
            ? '←'
            : '·';
        const tone = f.type?.endsWith('.recall') ? 'warn' : 'plain';
        const line = `${fmtClock(f.ts)} ${sign} ${f.senderKey ?? ''}: ${f.text ?? ''}`.trim();
        log.append(line, tone);
      },
      close(willRetry) {
        log.append(willRetry ? '事件通道断开，重连中…' : '事件通道已关闭', willRetry ? 'warn' : 'dim');
      },
    });

    ctx.root.append(sheet.el);
    return ctx.own(handle);
  },
};

const bundle: ConsoleClientBundle = { panels: { roster: rosterPanel, events: eventsPanel } };
export default bundle;
