// src/console/client.ts
function fmtClock(ts) {
  const n = typeof ts === "number" ? ts : typeof ts === "string" ? Date.parse(ts) : NaN;
  if (!Number.isFinite(n)) return "";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtTime(ts) {
  const n = typeof ts === "number" ? ts : typeof ts === "string" ? Date.parse(ts) : NaN;
  if (!Number.isFinite(n)) return "\u2014";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(n)}`;
}
var rosterPanel = {
  async mount(ctx) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: "\u76D1\u542C\u540D\u5355", en: "roster", desc: "\u5F53\u524D\u76D1\u542C\u7684\u7FA4\u804A\u4E0E\u79C1\u804A\uFF0C\u53CA\u6700\u8FD1\u6D88\u606F\u65F6\u95F4\u3002" });
    let data;
    try {
      data = await ctx.invoke("getRoster");
    } catch (err) {
      sheet.body.appendChild(ui.msgline(`\u8BFB\u53D6\u76D1\u542C\u540D\u5355\u5931\u8D25: ${err.message}`, true));
      ctx.root.append(sheet.el);
      return;
    }
    data ?? (data = {});
    const groups = data.groups ?? [];
    const privates = data.privates ?? [];
    const convs = data.convs ?? [];
    const bar = ui.rowbar();
    bar.append(
      ui.pill(`\u672C\u53F7 ${data.selfId ?? "?"}`, "plain"),
      ui.pill(`\u6A21\u5F0F ${data.mode ?? "?"}`, "plain"),
      ui.pill(`\u7FA4 ${groups.length}`, "plain"),
      ui.pill(`\u79C1\u804A ${privates.length}`, "plain")
    );
    sheet.body.append(bar);
    if (convs.length === 0) {
      sheet.body.append(ui.placeholder("\u8FD8\u6CA1\u6709\u4EFB\u4F55\u4F1A\u8BDD\u3002\u8BA9 bot \u6536\u5230\u6D88\u606F\u6216\u628A\u5B83\u52A0\u5165\u76D1\u542C\u540D\u5355\u540E\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u8BB0\u5F55\u3002"));
    } else {
      const table = ui.table({
        head: ["\u7C7B\u578B", "\u540D\u79F0", "\u8D26\u53F7", "\u4EBA\u6570", "\u5DF2\u6FC0\u6D3B", "\u6700\u8FD1\u6D88\u606F"],
        maxHeight: "calc(100vh - 320px)"
      });
      for (const c of convs) {
        const kindLabel = c.kind === "group" ? "\u7FA4" : c.kind === "private" ? "\u79C1\u804A" : String(c.kind);
        table.addRow([
          kindLabel,
          c.label ?? "",
          String(c.address),
          String(c.members ?? 0),
          c.active ? "\u662F" : "\u5426",
          fmtTime(c.lastMessageAt)
        ]);
      }
      sheet.body.append(table.el);
    }
    ctx.root.append(sheet.el);
  }
};
var eventsPanel = {
  mount(ctx) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: "\u5B9E\u65F6\u4E8B\u4EF6", en: "events", desc: "QQ \u6D88\u606F\u4E0E\u901A\u77E5\u7684\u5B9E\u65F6\u6D41\uFF08\u542B\u6700\u8FD1 20 \u6761\u56DE\u653E\uFF09\u3002" });
    const log = ui.log({ variant: "conversation", empty: "\u7B49\u5F85\u4E8B\u4EF6\u2026" });
    sheet.body.append(log.el);
    const handle = ctx.stream({
      open() {
        log.append("\u5DF2\u8FDE\u63A5\u4E8B\u4EF6\u901A\u9053", "dim");
      },
      message(raw) {
        let f;
        try {
          f = JSON.parse(raw);
        } catch {
          log.append(raw, "dim");
          return;
        }
        const sign = f.type?.endsWith(".recall") ? "\u21A9" : f.type === "qq.message" ? "\u2190" : "\xB7";
        const tone = f.type?.endsWith(".recall") ? "warn" : "plain";
        const line = `${fmtClock(f.ts)} ${sign} ${f.senderKey ?? ""}: ${f.text ?? ""}`.trim();
        log.append(line, tone);
      },
      close(willRetry) {
        log.append(willRetry ? "\u4E8B\u4EF6\u901A\u9053\u65AD\u5F00\uFF0C\u91CD\u8FDE\u4E2D\u2026" : "\u4E8B\u4EF6\u901A\u9053\u5DF2\u5173\u95ED", willRetry ? "warn" : "dim");
      }
    });
    ctx.root.append(sheet.el);
    return ctx.own(handle);
  }
};
var bundle = { panels: { roster: rosterPanel, events: eventsPanel } };
var client_default = bundle;
export {
  client_default as default
};
