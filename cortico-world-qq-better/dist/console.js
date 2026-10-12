// src/desktop-pet/console/client.ts
var MODES = { hold: "\u6309\u4F4F\u8BF4\u8BDD\u952E\u65F6\u6536\u97F3", toggle: "\u7528\u8BF4\u8BDD\u952E\u5F00\u5173\u6536\u97F3", always: "\u4E00\u76F4\u6536\u97F3" };
var CODE_KEYS = {
  ControlLeft: "LeftCtrl",
  ControlRight: "RightCtrl",
  AltLeft: "LeftAlt",
  AltRight: "RightAlt",
  ShiftLeft: "LeftShift",
  ShiftRight: "RightShift",
  MetaLeft: "Win",
  MetaRight: "RightWin",
  Space: "Space",
  Tab: "Tab",
  CapsLock: "CapsLock",
  Backquote: "Backquote",
  Enter: "Enter",
  Insert: "Insert",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Pause: "Pause",
  ScrollLock: "ScrollLock"
};
var keyOfCode = (code) => CODE_KEYS[code] ?? (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code : null);
var PRESSES = {
  2: { hold: "\u53CC\u51FB\u518D\u6309\u4F4F", toggle: "\u53CC\u51FB\u5F00\u59CB,\u518D\u53CC\u51FB\u505C" },
  1: { hold: "\u76F4\u63A5\u6309\u4F4F", toggle: "\u6309\u4E00\u4E0B\u5F00\u59CB,\u518D\u6309\u4E00\u4E0B\u505C" },
  3: { hold: "\u4E09\u51FB\u518D\u6309\u4F4F", toggle: "\u4E09\u51FB\u5F00\u59CB,\u518D\u4E09\u51FB\u505C" }
};
var splitTaps = (hotkey) => {
  const m = /^(.*?)\s*\*\s*([1-3])$/.exec(hotkey.trim());
  return m ? { combo: m[1], taps: Number(m[2]) } : { combo: hotkey.trim(), taps: 1 };
};
var withTaps = (combo, taps) => taps > 1 ? `${combo}*${taps}` : combo;
var MB = (n) => `${Math.round(n / 1048576)} MB`;
var progress = (a) => a.total ? `${Math.round(a.done / a.total * 100)}%` : MB(a.done);
var errText = (err) => err instanceof Error ? err.message : String(err);
function statusRow(ctx, name) {
  const { ui } = ctx;
  const row = ui.h("div", "mountrow");
  const dot = ui.h("span", "navdot");
  const state = ui.h("span", "mstate", "\u2014");
  const detail = ui.h("span", "mdetail");
  const acts = ui.h("span", "macts");
  row.append(dot, ui.h("span", "mname", name), state, detail, acts);
  return {
    row,
    acts,
    set(text, tone, more = "") {
      state.textContent = text;
      detail.textContent = more;
      dot.className = `navdot ${tone === "on" ? "ok" : tone === "bad" ? "bad" : tone === "busy" ? "warn" : ""}`;
    }
  };
}
var petPanel = {
  mount(ctx) {
    const { ui, root } = ctx;
    const card = ui.sheet({ title: "\u684C\u5BA0", en: "pet" });
    root.appendChild(card.el);
    const s = card.body;
    const msg = ui.msgline("");
    const win = statusRow(ctx, "\u684C\u5BA0\u7A97\u53E3");
    const btnOpen = ui.button("\u6253\u5F00\u7A97\u53E3", { size: "sm", variant: "primary" });
    const btnClose = ui.button("\u5173\u95ED\u7A97\u53E3", { size: "sm" });
    win.acts.append(btnClose, btnOpen);
    const rt = statusRow(ctx, "\u7A97\u53E3\u8FD0\u884C\u65F6");
    const btnIdentify = ui.button("\u8BC6\u522B\u8FD0\u884C\u65F6", { size: "sm" });
    const btnInstall = ui.button("\u5B89\u88C5", { size: "sm", variant: "primary" });
    rt.acts.append(btnIdentify, btnInstall);
    const pathRow = statusRow(ctx, "\u8FD0\u884C\u65F6\u8DEF\u5F84");
    const pathInput = ui.h("input", "pet-path-input");
    pathInput.type = "text";
    pathInput.placeholder = "\u7A97\u53E3\u8FD0\u884C\u65F6\u8DEF\u5F84\uFF08Electron \u7A0B\u5E8F\uFF0C\u7559\u7A7A\u7528\u9ED8\u8BA4\uFF09";
    pathInput.style.width = "240px";
    const btnSavePath = ui.button("\u4FDD\u5B58\u8DEF\u5F84", { size: "sm", variant: "primary" });
    pathRow.acts.append(pathInput, btnSavePath);
    const candList = ui.h("div", "pet-cands");
    const links = ui.rowbar();
    const open = ui.h("a", "btn sm", "\u5728\u6D4F\u89C8\u5668\u91CC\u770B");
    open.target = "_blank";
    open.rel = "noopener";
    links.append(open, msg);
    const frameWrap = ui.h("div", "pet-dressframe");
    const frame = ui.h("iframe");
    frame.title = "\u88C5\u626E";
    frameWrap.append(frame);
    s.append(win.row, rt.row, pathRow.row, candList, links, ui.section("\u88C5\u626E", "\u6539\u52A8\u4F1A\u7ACB\u523B\u4FDD\u5B58,\u5E76\u540C\u6B65\u5230\u684C\u5BA0\u7A97\u53E3"), frameWrap);
    let st = null;
    const render = (next) => {
      st = next;
      const disabledMsg = next.message;
      if (!next.electron || disabledMsg) {
        if (disabledMsg) msg.textContent = disabledMsg;
        return;
      }
      const w = next.window;
      if (document.activeElement !== pathInput) pathInput.value = next.electronFile ?? "";
      if (next.connected) win.set("\u5DF2\u8FDE\u63A5", "on");
      else if (w?.phase === "running") win.set("\u542F\u52A8\u4E2D", "busy");
      else win.set(w?.phase === "missing" || w?.phase === "error" ? "\u6253\u4E0D\u5F00" : "\u672A\u6253\u5F00", w?.phase === "missing" || w?.phase === "error" ? "bad" : "off", w?.detail ?? "");
      btnOpen.disabled = w?.phase === "running";
      btnClose.disabled = w?.phase !== "running";
      const e = next.electron;
      if (w?.source && w.source !== e.path && e.phase !== "ready") rt.set("\u7528\u5916\u90E8\u7A0B\u5E8F", "on", w.source);
      else if (e.phase === "ready") rt.set("\u5DF2\u5B89\u88C5", "on", e.path);
      else if (e.phase === "working") rt.set(`\u4E0B\u8F7D\u4E2D ${progress(e)}`, "busy", e.detail ?? "");
      else if (e.phase === "error") rt.set("\u5B89\u88C5\u5931\u8D25", "bad", e.detail ?? "");
      else rt.set(e.supported ? "\u672A\u5B89\u88C5" : "\u672C\u5E73\u53F0\u6CA1\u6709\u9884\u7F16\u8BD1\u5305", "off", e.supported ? "Electron 44.4.4,\u7EA6 150 MB" : "");
      btnInstall.hidden = e.phase === "ready" || !e.supported;
      btnInstall.disabled = e.phase === "working";
      if (next.url) open.href = next.url;
      if (next.dressUrl && frame.dataset.src !== next.dressUrl) {
        frame.dataset.src = next.dressUrl;
        frame.src = next.dressUrl;
      }
    };
    const refresh = async () => {
      try {
        render(await ctx.invoke("state"));
      } catch (err) {
        msg.textContent = errText(err);
      }
    };
    const call = (method) => async () => {
      try {
        render(await ctx.invoke(method));
      } catch (err) {
        msg.textContent = errText(err);
      }
    };
    btnOpen.addEventListener("click", call("openWindow"));
    btnClose.addEventListener("click", call("closeWindow"));
    btnInstall.addEventListener("click", call("installElectron"));
    btnIdentify.addEventListener("click", async () => {
      try {
        const r = await ctx.invoke("identifyRuntime");
        const found = r.candidates ?? [];
        candList.replaceChildren();
        if (found.length === 0) {
          msg.textContent = r.ok ? `\u8BC6\u522B\u7ED3\u679C\uFF1A\u5C06\u4F7F\u7528 ${r.source}` : `\u6CA1\u627E\u5230\u53EF\u7528\u8FD0\u884C\u65F6\uFF0C\u4E5F\u6CA1\u5728\u7535\u8111\u91CC\u626B\u5230\u73B0\u6210\u7684 Electron\uFF1A${r.detail ?? ""}`;
          return;
        }
        msg.textContent = `\u5728\u7535\u8111\u91CC\u627E\u5230 ${found.length} \u4E2A\u73B0\u6210\u8FD0\u884C\u65F6` + (r.ok ? `\uFF0C\u5F53\u524D\u5C06\u4F7F\u7528 ${r.source}` : "\uFF0C\u70B9\u300C\u7528\u8FD9\u4E2A\u300D\u9009\u7528\u5176\u4E2D\u4E00\u4E2A");
        for (const c of found) {
          const item = ui.h("div", "pet-cand");
          const label = ui.h("span", "pet-cand-path", c);
          const use = ui.button("\u7528\u8FD9\u4E2A", { size: "xs", variant: "primary" });
          use.addEventListener("click", async () => {
            try {
              render(await ctx.invoke("setElectronFile", [c]));
              msg.textContent = `\u5DF2\u8BBE\u4E3A\u7528 ${c}`;
            } catch (err) {
              msg.textContent = errText(err);
            }
          });
          item.append(label, use);
          candList.append(item);
        }
      } catch (err) {
        msg.textContent = errText(err);
      }
    });
    btnSavePath.addEventListener("click", async () => {
      try {
        render(await ctx.invoke("setElectronFile", [pathInput.value.trim()]));
        msg.textContent = "\u5DF2\u4FDD\u5B58\u7A97\u53E3\u8FD0\u884C\u65F6\u8DEF\u5F84";
      } catch (err) {
        msg.textContent = errText(err);
      }
    });
    void refresh();
    ctx.interval(() => void refresh(), 1500);
  }
};
var FLOOR_DB = -60;
var meterPct = (db) => Math.max(0, Math.min(100, (db - FLOOR_DB) / -FLOOR_DB * 100));
var voicePanel = {
  mount(ctx) {
    const { ui, root } = ctx;
    const card = ui.sheet({ title: "\u8BED\u97F3\u8F93\u5165", en: "voice" });
    root.appendChild(card.el);
    const s = card.body;
    const msg = ui.msgline("");
    const master = ui.h("label", "pet-master");
    const masterText = ui.h("span", "pet-mastertext");
    const masterTitle = ui.h("span", "pet-mastertitle", "\u5F00\u542F\u8BED\u97F3\u8F93\u5165");
    const masterHint = ui.h("span", "pet-masterhint");
    masterText.append(masterTitle, masterHint);
    const enabled = ui.h("input", "pet-switch");
    enabled.type = "checkbox";
    enabled.setAttribute("role", "switch");
    enabled.addEventListener("change", () => void call("setEnabled", [enabled.checked])());
    master.append(masterText, enabled);
    const settings = ui.h("div", "pet-voicebody");
    const eng = statusRow(ctx, "\u8BC6\u522B\u5F15\u64CE");
    const engineSel = ui.select();
    eng.acts.append(engineSel);
    const srv = statusRow(ctx, "\u8BC6\u522B\u670D\u52A1");
    const btnStart = ui.button("\u542F\u52A8", { size: "sm", variant: "primary" });
    const btnStop = ui.button("\u505C\u6B62", { size: "sm" });
    srv.acts.append(btnStop, btnStart);
    const rt = statusRow(ctx, "\u8BC6\u522B\u6A21\u578B");
    const btnInstall = ui.button("\u4E0B\u8F7D", { size: "sm", variant: "primary" });
    rt.acts.append(btnInstall);
    const micRow = statusRow(ctx, "\u9EA6\u514B\u98CE");
    const deviceSel = ui.select();
    micRow.acts.append(deviceSel);
    const modeRow = statusRow(ctx, "\u6536\u97F3\u65B9\u5F0F");
    const modeSel = ui.select();
    modeSel.replaceChildren(...Object.keys(MODES).map((m) => {
      const o = ui.h("option", null, MODES[m]);
      o.value = m;
      return o;
    }));
    const pressSel = ui.select();
    const keyBtn = ui.button("", { size: "sm" });
    modeRow.acts.append(modeSel, pressSel, keyBtn);
    const meter = ui.h("div", "pet-meter");
    const fill = ui.h("div", "pet-meterfill");
    const mark = ui.h("div", "pet-metermark");
    meter.append(fill, mark);
    const log = ui.log({ max: 100 });
    settings.append(eng.row, srv.row, rt.row, micRow.row, modeRow.row, meter, ui.section("\u8BC6\u522B\u7ED3\u679C", "\u5212\u6389\u7684\u662F\u592A\u77ED\u6216\u7591\u4F3C\u5E7B\u89C9\u3001\u6CA1\u6709\u53D1\u51FA\u53BB\u7684"), log.el);
    s.append(master, msg, settings);
    let st = null;
    let seen = 0;
    const render = (next) => {
      st = next;
      const disabledMsg = next.message;
      if (!next.model || disabledMsg) {
        if (disabledMsg) msg.textContent = disabledMsg;
        return;
      }
      enabled.checked = next.enabled;
      master.classList.toggle("on", next.enabled);
      masterHint.textContent = next.enabled ? "\u5DF2\u5F00\u542F:\u9EA6\u514B\u98CE\u4E00\u76F4\u6253\u5F00,\u6309\u4E0B\u9762\u7684\u6536\u97F3\u65B9\u5F0F\u628A\u8BF4\u7684\u8BDD\u53D1\u7ED9\u684C\u5BA0" : "\u5DF2\u5173\u95ED:\u4E0D\u6253\u5F00\u9EA6\u514B\u98CE,\u4E0B\u9762\u7684\u8BBE\u7F6E\u6682\u4E0D\u751F\u6548";
      settings.classList.toggle("off", !next.enabled);
      const engines = { funasr: "FunASR(\u672C\u673A\u8BC6\u522B)" };
      if (next.systemSupported) engines.system = "Windows \u81EA\u5E26";
      if (engineSel.dataset.list !== JSON.stringify(engines)) {
        engineSel.dataset.list = JSON.stringify(engines);
        engineSel.replaceChildren(...Object.keys(engines).map((k) => {
          const o = ui.h("option", null, engines[k] ?? k);
          o.value = k;
          return o;
        }));
      }
      if (document.activeElement !== engineSel) engineSel.value = next.engine;
      eng.set(
        next.engine === "system" ? "Windows \u81EA\u5E26" : "FunASR",
        "on",
        next.engine === "system" ? "\u4E0D\u7528\u4E0B\u8F7D,\u51C6\u786E\u5EA6\u4E00\u822C;\u60F3\u8981\u66F4\u51C6\u6362\u6210 FunASR" : "SenseVoiceSmall,\u5728\u672C\u673A\u8BC6\u522B,\u4E2D\u6587\u51C6;\u6A21\u578B\u4E0B\u8F7D\u4E00\u6B21\u5C31\u80FD\u4E00\u76F4\u7528"
      );
      const sv = next.server;
      if (!sv) srv.set("\u2014", "off");
      else if (sv.phase === "running") srv.set("\u5C31\u7EEA", "on", sv.url);
      else if (sv.phase === "starting") srv.set("\u542F\u52A8\u4E2D", "busy", sv.url);
      else if (sv.phase === "error") srv.set("\u51FA\u9519", "bad", sv.detail ?? "");
      else srv.set("\u5DF2\u505C\u6B62", "off", sv.url);
      btnStart.disabled = sv?.phase === "running" || sv?.phase === "starting";
      btnStop.disabled = sv?.phase !== "running";
      const m = next.model;
      if (m.phase === "working") rt.set(`\u4E0B\u8F7D\u4E2D ${progress(m)}`, "busy", m.detail ?? "");
      else if (m.phase === "error") rt.set("\u4E0B\u8F7D\u5931\u8D25", "bad", m.detail ?? "");
      else if (m.phase === "ready") rt.set("\u5DF2\u4E0B\u8F7D", "on", m.path);
      else rt.set("\u8FD8\u6CA1\u4E0B\u8F7D", "off", `\u7EA6 ${MB(m.bytes)},\u4ECE ModelScope \u4E0B\u8F7D,\u56FD\u5185\u53EF\u7528`);
      btnInstall.disabled = m.phase === "working";
      btnInstall.hidden = m.phase === "ready";
      btnInstall.textContent = m.phase === "error" ? "\u91CD\u8BD5" : "\u4E0B\u8F7D";
      rt.row.style.display = next.engine === "funasr" ? "" : "none";
      const mic = next.mic;
      micRow.set({ on: "\u6536\u97F3\u4E2D", off: "\u6CA1\u5728\u6536", denied: "\u88AB\u62D2\u7EDD", error: "\u51FA\u9519" }[mic.state] ?? mic.state, mic.state === "on" ? "on" : mic.state === "off" ? "off" : "bad", mic.detail ?? "");
      const input = next.input;
      const choices = [{ id: "", label: "\u7CFB\u7EDF\u9ED8\u8BA4" }, ...input.devices];
      if (input.deviceId && !choices.some((d) => d.id === input.deviceId)) choices.push({ id: input.deviceId, label: "\u4E4B\u524D\u9009\u7684\u8BBE\u5907(\u73B0\u5728\u627E\u4E0D\u5230)" });
      if (deviceSel.dataset.list !== JSON.stringify(choices)) {
        deviceSel.dataset.list = JSON.stringify(choices);
        deviceSel.replaceChildren(...choices.map((d, i) => {
          const o = ui.h("option", null, d.label || `\u9EA6\u514B\u98CE ${i}`);
          o.value = d.id;
          return o;
        }));
      }
      if (document.activeElement !== deviceSel) deviceSel.value = input.deviceId;
      if (document.activeElement !== modeSel) modeSel.value = input.mode;
      const { taps } = splitTaps(input.hotkey);
      const press = input.mode === "toggle" ? "toggle" : "hold";
      const presses = Object.keys(PRESSES).map(Number).filter((n) => n < 3 || n === taps).map((n) => [n, PRESSES[n][press]]);
      if (pressSel.dataset.list !== JSON.stringify(presses)) {
        pressSel.dataset.list = JSON.stringify(presses);
        pressSel.replaceChildren(...presses.map(([n, label]) => {
          const o = ui.h("option", null, label);
          o.value = String(n);
          return o;
        }));
      }
      if (document.activeElement !== pressSel) pressSel.value = String(taps);
      if (!capturing) keyBtn.textContent = `\u8BF4\u8BDD\u952E:${input.keyLabel}`;
      keyBtn.hidden = pressSel.hidden = input.mode === "always";
      modeRow.set(input.open ? "\u6B63\u5728\u6536\u97F3" : "\u7B49\u8BF4\u8BDD\u952E", input.open ? "on" : "off", input.hotkeyProblem ? `${input.hotkeyProblem},\u6539\u4E3A\u4E00\u76F4\u6536\u97F3` : input.hint);
      mark.hidden = input.effectiveMode === "hold";
      mark.style.left = `${meterPct(next.thresholdDb)}%`;
      for (const line of next.recent) {
        if (line.at <= seen) continue;
        seen = line.at;
        const el = log.append(line.text, line.dropped ? "dim" : "plain");
        if (line.dropped) el.style.textDecoration = "line-through";
      }
    };
    const refresh = async () => {
      try {
        render(await ctx.invoke("state"));
      } catch (err) {
        msg.textContent = errText(err);
      }
    };
    const call = (method, args = []) => async () => {
      try {
        render(await ctx.invoke(method, args));
        msg.textContent = "";
      } catch (err) {
        msg.textContent = errText(err);
      }
    };
    btnStart.addEventListener("click", call("start"));
    engineSel.addEventListener("change", () => void call("setEngine", [engineSel.value])());
    btnStop.addEventListener("click", call("stop"));
    btnInstall.addEventListener("click", call("install"));
    modeSel.addEventListener("change", () => void call("setMic", [{ mode: modeSel.value }])());
    deviceSel.addEventListener("change", () => void call("setMic", [{ deviceId: deviceSel.value }])());
    pressSel.addEventListener("change", () => {
      if (st) void call("setMic", [{ hotkey: withTaps(splitTaps(st.input.hotkey).combo, Number(pressSel.value)) }])();
    });
    let capturing = false;
    const held = [];
    const finishCapture = (combo) => {
      capturing = false;
      held.length = 0;
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointer, true);
      if (combo && st) void call("setMic", [{ hotkey: withTaps(combo, splitTaps(st.input.hotkey).taps) }])();
      else void refresh();
    };
    const onKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        finishCapture(null);
        return;
      }
      const k = keyOfCode(e.code);
      if (k && !held.includes(k)) held.push(k);
    };
    const onKeyUp = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (held.length) finishCapture(held.join("+"));
    };
    const onPointer = (e) => {
      const k = { 1: "Mouse3", 3: "Mouse4", 4: "Mouse5" }[e.button];
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      finishCapture([...held, k].join("+"));
    };
    keyBtn.addEventListener("click", () => {
      if (capturing) {
        finishCapture(null);
        return;
      }
      capturing = true;
      keyBtn.textContent = "\u6309\u4E0B\u65B0\u7684\u8BF4\u8BDD\u952E,\u53EF\u4EE5\u662F\u7EC4\u5408\u952E\u6216\u9F20\u6807\u4FA7\u952E\u2026(Esc \u53D6\u6D88)";
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("keyup", onKeyUp, true);
      window.addEventListener("pointerdown", onPointer, true);
    });
    ctx.own({ dispose: () => {
      if (capturing) finishCapture(null);
    } });
    ctx.stream({
      message: (text) => {
        const f = JSON.parse(text);
        if (f.type === "level" && typeof f.level === "number") {
          fill.style.width = `${meterPct(f.level)}%`;
          fill.classList.toggle("on", !!f.speaking);
          meter.classList.toggle("open", !!f.open);
        } else void refresh();
      }
    });
    void refresh();
    ctx.interval(() => void refresh(), 1500);
  }
};
var bundle = { panels: { pet: petPanel, voice: voicePanel } };
var client_default = bundle;

// src/console/client.ts
var MODULES = [
  { id: "general", title: "\u8FDE\u63A5\u4E0E\u76D1\u542C", desc: "OneBot \u8FDE\u63A5\u53C2\u6570\u4E0E\u76D1\u542C\u540D\u5355\uFF1B\u8FDE\u63A5\u7C7B\u6539\u52A8\u9700\u91CD\u542F\u751F\u6548\u3002", group: "world:qqbot", prefix: "", topOnly: true },
  { id: "vision", title: "\u89C6\u89C9", desc: "\u8F85\u52A9\u89C6\u89C9\uFF08VLM\uFF09\uFF1A\u63A5\u6536\u56FE\u7247\u65F6\u7528\u89C6\u89C9\u6A21\u578B\u7406\u89E3\u3002", group: "world:qqbot", prefix: "worlds.qqbot.vision.", topOnly: false },
  { id: "sticker", title: "\u8868\u60C5\u5305", desc: "\u81EA\u52A8\u6536\u85CF\u8868\u60C5\u5305\uFF1A\u4E0B\u8F7D\u6D88\u606F\u91CC\u7684\u56FE\u7247\u5E76\u6807\u6CE8\u60C5\u611F/\u7528\u5904\u3002", group: "world:qqbot", prefix: "worlds.qqbot.sticker.", topOnly: false },
  { id: "proactive", title: "\u4E3B\u52A8\u8BF4\u8BDD", desc: "\u540E\u53F0\u6309\u72B6\u6001\u673A\u5411\u76D1\u542C\u4F1A\u8BDD\u4E3B\u52A8\u5192\u6CE1\u95F2\u804A\u3002", group: "world:qqbot", prefix: "worlds.qqbot.proactive.", topOnly: false },
  { id: "qzone", title: "QQ\u7A7A\u95F4", desc: "QQ \u7A7A\u95F4\u52A8\u6001\u53D1\u5E03\u3001\u81EA\u52A8\u5192\u6CE1\u4E0E\u8BC4\u8BBA\u56DE\u590D\u3002", group: "world:qqbot", prefix: "worlds.qqbot.qzone.", topOnly: false },
  { id: "group-speak", title: "\u7FA4\u804A\u9650\u901F", desc: "\u9650\u5236\u6BCF\u4E2A\u7FA4\u5355\u4F4D\u7A97\u53E3\u5185 bot \u53D1\u51FA\u7684\u6D88\u606F\u603B\u91CF\u3002", group: "world:qqbot", prefix: "worlds.qqbot.groupSpeak.", topOnly: false },
  { id: "anti-loop", title: "\u9632\u5237/\u8BDD\u9898\u7ED3\u675F", desc: "\u7EDF\u8BA1\u8FDE\u7EED\u53D1\u8A00\u4E0E\u9759\u9ED8\u65F6\u957F\uFF0C\u8D85\u9650\u81EA\u52A8\u6536\u5C3E\u3002", group: "world:qqbot", prefix: "worlds.qqbot.antiLoop.", topOnly: false },
  { id: "emotion", title: "\u60C5\u7EEA\u7CFB\u7EDF", desc: "\u6BCF\u8F6E\u5BF9\u8BDD\u611F\u77E5\u60C5\u7EEA\u3001\u6CE8\u5165\u5168\u5C40\u4E0A\u4E0B\u6587\u3002", group: "world:qqbot", prefix: "worlds.qqbot.emotion.", topOnly: false },
  { id: "routine", title: "\u4F5C\u606F\u529F\u80FD", desc: "\u7761\u7720/\u5348\u4F11/\u6D3B\u8DC3\u4F5C\u606F\uFF0C\u5230\u70B9\u64AD\u62A5\u3002", group: "world:qqbot", prefix: "worlds.qqbot.routine.", topOnly: false },
  { id: "reminder", title: "\u5230\u70B9\u63D0\u9192", desc: "\u5B9A\u65F6\u63D0\u9192\u5230\u70B9\u81EA\u52A8\u53D1\u5230\u5BF9\u5E94\u4F1A\u8BDD\u3002", group: "world:qqbot", prefix: "worlds.qqbot.reminder.", topOnly: false },
  { id: "affinity", title: "\u597D\u611F\u5EA6", desc: "\u597D\u611F\u5EA6\u7CFB\u7EDF\uFF1A\u968F\u4E92\u52A8\u589E\u51CF\u5E76\u6CE8\u5165\u5BF9\u8BDD\u4E0A\u4E0B\u6587\u3002", group: "world:qqbot", prefix: "worlds.qqbot.affinity.", topOnly: false },
  { id: "admin", title: "\u7FA4\u7BA1\u7406\u5458", desc: "\u64A4\u56DE/@\u5168\u4F53/\u901A\u77E5/\u5BA1\u6838\u8FDB\u7FA4/\u5934\u8854/\u7981\u8A00/\u8E22\u4EBA\u3002", group: "world:qqbot", prefix: "worlds.qqbot.admin.", topOnly: false },
  { id: "voice", title: "\u8BED\u97F3\u6536\u53D1", desc: "\u5BF9\u65B9\u8BF4\u8BDD\u8F6C\u6587\u5B57\u3001AI \u56DE\u590D\u8F6C\u8BED\u97F3\u3002\u53EF\u6574\u4F53\u5F00\u5173\u3002", group: "world:qqbot-voice", prefix: "", topOnly: false, status: "getVoiceState" },
  { id: "asr", title: "\u8BED\u97F3\u6A21\u578B", desc: "ASR \u5F15\u64CE\u4E0E\u6A21\u578B\u4E0B\u8F7D\uFF1Asherpa-onnx int8 \u91CF\u5316\u7248\u7EA6 228MB\u3002", group: "world:qqbot-asr", prefix: "", topOnly: false, status: "getAsrModelState", extra: "asr" },
  { id: "call", title: "\u8BED\u97F3\u901A\u8BDD", desc: "\u89E6\u53D1\u8BCD\u8FDB\u5165\u8BED\u97F3\u901A\u8BDD\u4F1A\u8BDD\uFF08\u6A21\u62DF\u63A5\u542C\uFF09\u3002\u53EF\u6574\u4F53\u5F00\u5173\u3002", group: "world:qqbot-call", prefix: "", topOnly: false, status: "getCallState" }
];
function isLongText(key, def) {
  if (def.type !== "string") return false;
  const k = key.toLowerCase();
  if (/prompt|greeting|farewell|notice|描述|systemprompt|voicedesc|voicedesign|extra|system/.test(k)) return true;
  if (def.description && def.description.length > 90) return true;
  return false;
}
function fmtVal(v) {
  if (v == null) return "\u2014";
  if (typeof v === "boolean") return v ? "\u5F00" : "\u5173";
  if (Array.isArray(v)) return v.length ? v.join(" / ") : "\uFF08\u7A7A\uFF09";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function statusText(st) {
  return Object.entries(st).map(([k, v]) => `${k}: ${fmtVal(v)}`).join("\n");
}
function loadSchema(ctx, m) {
  return ctx.invoke("config", [m.group, m.prefix, m.topOnly]).catch(() => null);
}
function renderField(ctx, def, value, commit) {
  const ui = ctx.ui;
  const wrap = document.createElement("div");
  wrap.style.margin = "10px 0";
  const lab = document.createElement("div");
  lab.style.fontWeight = "600";
  lab.style.marginBottom = "3px";
  lab.textContent = def.title + (def.xHot ? "" : "\uFF08\u6539\u5B8C\u9700\u91CD\u542F\u751F\u6548\uFF09");
  wrap.appendChild(lab);
  let control;
  if (def.type === "boolean") {
    control = ui.checkbox("", { checked: !!value, onChange: (v) => commit(v) }).el;
  } else if (def.enum && def.enum.length) {
    const v = def.enum.includes(String(value)) ? String(value) : def.enum[0];
    control = ui.select({
      value: v,
      options: def.enum.map((e) => ({ value: e, label: e })),
      onChange: (v2) => commit(v2)
    });
  } else if (def.type === "integer" || def.type === "number") {
    control = ui.input({
      value: value == null ? "" : String(value),
      type: "number",
      onChange: (v) => commit(def.type === "integer" ? parseInt(v || "0", 10) : parseFloat(v || "0"))
    });
  } else if (isLongText(def.key, def)) {
    control = ui.textarea({ value: value == null ? "" : String(value), rows: 4, onChange: (v) => commit(v) });
  } else if (/secret|key/i.test(def.key) || /key|密钥|token/i.test(def.title)) {
    control = ui.input({ value: value == null ? "" : String(value), type: "password", onChange: (v) => commit(v) });
  } else {
    control = ui.input({ value: value == null ? "" : String(value), onChange: (v) => commit(v) });
  }
  wrap.appendChild(control);
  if (def.description) {
    const h = document.createElement("div");
    h.style.fontSize = "11px";
    h.style.opacity = "0.6";
    h.style.marginTop = "3px";
    h.style.lineHeight = "1.4";
    h.textContent = def.description;
    wrap.appendChild(h);
  }
  return wrap;
}
function makePanel(m) {
  return {
    mount(ctx) {
      const ui = ctx.ui;
      const toast = (msg) => {
        try {
          ui.toast(msg);
        } catch {
        }
      };
      let debounceTimer = null;
      const debounceCommit = (fn) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fn, 350);
      };
      const commit = (fn) => debounceCommit(fn);
      const sheet = ui.sheet({ title: m.title, desc: m.desc });
      const formWrap = document.createElement("div");
      const renderForm = (s) => {
        formWrap.replaceChildren();
        if (!s.properties.length) {
          const empty = document.createElement("div");
          empty.style.opacity = "0.6";
          empty.textContent = "\u8BE5\u6A21\u5757\u6682\u65E0\u53EF\u914D\u7F6E\u9879\u3002";
          formWrap.appendChild(empty);
          return;
        }
        const head = document.createElement("div");
        head.style.fontWeight = "700";
        head.style.margin = "4px 0 8px";
        head.textContent = "\u914D\u7F6E\u9879";
        formWrap.appendChild(head);
        const reload = () => {
          void loadSchema(ctx, m).then((s2) => {
            if (s2) renderForm(s2);
          });
        };
        for (const def of s.properties) {
          formWrap.appendChild(renderField(ctx, def, s.values[def.key], (v) => {
            void ctx.setConfig(m.group, { [def.key]: v }).then(() => toast("\u5DF2\u4FDD\u5B58\uFF1A" + def.key.split(".").pop())).catch((e) => toast("\u4FDD\u5B58\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e)))).finally(reload);
          }));
        }
      };
      if (m.status) {
        const statusBox = document.createElement("div");
        statusBox.style.whiteSpace = "pre-wrap";
        statusBox.style.fontFamily = "ui-monospace, monospace";
        statusBox.style.fontSize = "12px";
        statusBox.style.background = "rgba(127,127,127,0.12)";
        statusBox.style.borderRadius = "6px";
        statusBox.style.padding = "8px 10px";
        statusBox.style.marginBottom = "10px";
        const refresh = ui.button("\u5237\u65B0\u72B6\u6001", {
          onClick: () => {
            void ctx.invoke(m.status, []).then(
              (st) => {
                statusBox.textContent = statusText(st);
              },
              (e) => {
                statusBox.textContent = "\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e));
              }
            );
          }
        });
        sheet.body.appendChild(refresh);
        sheet.body.appendChild(statusBox);
        void ctx.invoke(m.status, []).then(
          (st) => {
            statusBox.textContent = statusText(st);
          },
          () => {
            statusBox.textContent = "\u72B6\u6001\u8BFB\u53D6\u5931\u8D25";
          }
        );
      }
      if (m.extra === "asr") {
        const dl = ui.button("\u4E0B\u8F7D/\u6821\u9A8C ASR \u6A21\u578B", {
          onClick: () => {
            dl.textContent = "\u4E0B\u8F7D\u4E2D\u2026";
            void ctx.invoke("downloadAsrModel", []).then(
              (r) => {
                toast(JSON.stringify(r));
              },
              (e) => {
                toast("\u4E0B\u8F7D\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e)));
              }
            ).finally(() => {
              dl.textContent = "\u4E0B\u8F7D/\u6821\u9A8C ASR \u6A21\u578B";
            });
          }
        });
        sheet.body.appendChild(dl);
      }
      sheet.body.appendChild(formWrap);
      ctx.root.appendChild(sheet.el);
      void loadSchema(ctx, m).then((schema) => {
        if (!schema) {
          formWrap.replaceChildren();
          formWrap.textContent = "\u914D\u7F6E\u8BFB\u53D6\u5931\u8D25\uFF08\u8BF7\u786E\u8BA4 Cortico \u5DF2\u6574\u8FDB\u7A0B\u91CD\u542F\u5E76\u5237\u65B0\u9875\u9762\uFF09\u3002";
        } else {
          renderForm(schema);
        }
      });
    }
  };
}
function sectionEl(title, items) {
  const wrap = document.createElement("div");
  const h = document.createElement("div");
  h.style.fontWeight = "600";
  h.style.margin = "8px 0 4px";
  h.textContent = title + (items.length ? ` (${items.length})` : "");
  wrap.appendChild(h);
  if (!items.length) {
    const p = document.createElement("div");
    p.style.opacity = "0.5";
    p.textContent = "\uFF08\u7A7A\uFF09";
    wrap.appendChild(p);
  }
  for (const it of items) {
    const d = document.createElement("div");
    d.style.padding = "2px 0";
    d.style.fontSize = "13px";
    d.textContent = it;
    wrap.appendChild(d);
  }
  return wrap;
}
var rosterPanel = {
  mount(ctx) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: "\u76D1\u542C\u540D\u5355", desc: "\u5F53\u524D\u76D1\u542C\u7684\u7FA4\u4E0E\u79C1\u804A\u53CA\u672A\u8BFB\u60C5\u51B5\u3002" });
    sheet.body.textContent = "\u52A0\u8F7D\u76D1\u542C\u540D\u5355\u2026";
    ctx.root.appendChild(sheet.el);
    void ctx.invoke("getRoster").then(
      (r) => {
        const data = r;
        sheet.body.replaceChildren();
        const info = document.createElement("div");
        info.style.fontSize = "12px";
        info.style.opacity = "0.7";
        info.style.marginBottom = "8px";
        info.textContent = `selfId: ${data.selfId ?? "\u2014"}  mode: ${data.mode ?? "\u2014"}  \u7FA4\u6570: ${(data.groups || []).length}  \u79C1\u804A\u6570: ${(data.privates || []).length}`;
        sheet.body.appendChild(info);
        sheet.body.appendChild(sectionEl("\u76D1\u542C\u7FA4", (data.groups || []).map((g) => String(g))));
        sheet.body.appendChild(sectionEl("\u76D1\u542C\u79C1\u804A", (data.privates || []).map((p) => String(p))));
        sheet.body.appendChild(sectionEl("\u6D3B\u8DC3\u4F1A\u8BDD", (data.convs || []).map((c) => `${c.label || c.address} [${c.kind || "?"}]${c.active ? " \u2022\u5728\u7EBF" : ""} \u6210\u5458:${c.members ?? 0}`)));
      },
      (e) => {
        sheet.body.textContent = "\u76D1\u542C\u540D\u5355\u8BFB\u53D6\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e));
      }
    );
  }
};
var eventsPanel = {
  mount(ctx) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: "\u5B9E\u65F6\u4E8B\u4EF6", desc: "QQ \u6D88\u606F\u4E0E\u901A\u77E5\u7684\u5B9E\u65F6\u6D41\uFF08\u79BB\u7EBF\u4E5F\u80FD\u770B\u5DF2\u5B58\u50A8\u7684\uFF09\u3002" });
    const status = document.createElement("div");
    status.style.fontSize = "11px";
    status.style.opacity = "0.6";
    status.style.marginBottom = "6px";
    status.textContent = "\u8FDE\u63A5\u4E2D\u2026";
    const list = document.createElement("div");
    list.style.maxHeight = "calc(100vh - 320px)";
    list.style.overflowY = "auto";
    sheet.body.append(status, list);
    ctx.root.appendChild(sheet.el);
    const handle = ctx.stream({
      open: () => {
        status.textContent = "\u25CF \u5DF2\u8FDE\u63A5";
      },
      close: (willRetry) => {
        status.textContent = willRetry ? "\u25CB \u5DF2\u65AD\u5F00\uFF0C\u91CD\u8FDE\u4E2D\u2026" : "\u25CB \u5DF2\u65AD\u5F00";
      },
      message: (text) => {
        let e = {};
        try {
          e = JSON.parse(text);
        } catch {
          e = { text };
        }
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "6px";
        row.style.padding = "3px 0";
        row.style.borderBottom = "1px solid rgba(127,127,127,0.12)";
        row.style.fontSize = "12px";
        const t = document.createElement("span");
        t.style.opacity = "0.5";
        t.style.flex = "0 0 auto";
        t.textContent = (e.ts || "").slice(11, 19);
        const ty = document.createElement("span");
        ty.style.flex = "0 0 auto";
        ty.style.opacity = "0.7";
        ty.textContent = e.type || "";
        const tx = document.createElement("span");
        tx.style.flex = "1";
        tx.textContent = e.text || "";
        row.append(t, ty, tx);
        list.appendChild(row);
        while (list.childElementCount > 300) list.removeChild(list.firstChild);
        list.scrollTop = list.scrollHeight;
      }
    });
    return handle;
  }
};
var panels = {};
for (const m of MODULES) panels[m.id] = makePanel(m);
panels["roster"] = rosterPanel;
panels["events"] = eventsPanel;
panels["pet"] = client_default.panels["pet"];
panels["pet-voice"] = client_default.panels["voice"];
var bundle2 = { panels };
var client_default2 = bundle2;
export {
  client_default2 as default
};
