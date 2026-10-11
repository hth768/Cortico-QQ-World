/**
 * A figure pack's body for createPet (`opts.figure`, `ctl.setFigure`), drawn by the pack's own code
 * inside a sandboxed frame (`/figure-frame`, figure-frame.js) laid over the stage.
 *
 * The frame fills `layer`, which sits between the stage SVG (the shadow) and the one with the
 * particles, so the body is drawn in the same place and order as a figure inside the pet's group.
 * Each `draw` hands the frame the group's transform and pet-core's face and frame; what pet-core
 * reads back synchronously (the group rotation, the z colour) is the frame's answer to the frame
 * before. Anchors and the gestures the body draws itself come from the frame once it is ready.
 *
 * `onError(err)` is called when the pack's code fails after it was ready; before that the
 * returned promise rejects. Either way the frame is gone.
 */

/** A pack that has not drawn its first frame by then is taken as broken: its scripts or textures did not load. */
const READY_MS = 20_000;

export function loadPackFigure({ layer, pack, scheme, onError }) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.className = 'figure-frame';
    frame.src = '/figure-frame';
    let ready = false, gone = false, rot = 0, z = null, seq = 0;
    const waits = new Map();
    const post = (m) => frame.contentWindow?.postMessage(m, '*');
    const timer = setTimeout(() => fail(new Error(`形象 ${READY_MS / 1000} 秒内没有准备好`)), READY_MS);

    function close() {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      frame.remove();
      for (const done of waits.values()) done();
      waits.clear();
    }
    function fail(err) {
      if (gone) return;
      close();
      if (ready) onError?.(err); else reject(err);
    }

    const fig = {
      pack: pack.id,
      draw(petG, face, f) { if (!gone) post({ t: 'frame', transform: petG.getAttribute('transform') || '', face, frame: f }); },
      gestures: [],
      get colors() { return z ? { z } : undefined; },
      setScheme(id, o = {}) {
        if (gone) return Promise.resolve();
        const s = ++seq;
        post({ t: 'scheme', id, fade: o.fade ?? 0, at: o.at ?? 0, seq: s });
        return new Promise((done) => waits.set(s, done));
      },
      /** The light halo behind the body (pet-app's backdrop), as a CSS filter on the frame: 0 removes it. */
      setHalo(k) {
        const c = `rgba(184,184,184,${k.toFixed(2)})`;
        frame.style.filter = k ? `drop-shadow(0 0 3px ${c}) drop-shadow(0 0 7px ${c})` : '';
      },
      dispose: close,
    };

    async function onMessage(e) {
      if (e.source !== frame.contentWindow) return;
      const m = e.data || {};
      if (m.t === 'loaded' && !ready) {
        try {
          const model = pack.model ? await (await fetch(new URL(pack.base + pack.model, location.href))).json() : null;
          post({ t: 'init', entry: new URL(pack.base + pack.entry, location.href).href, export: pack.export, base: new URL(pack.base, location.href).href, model, scheme });
        } catch (err) { fail(err); }
      } else if (m.t === 'ready' && !ready) {
        ready = true;
        clearTimeout(timer);
        if (m.anchors) fig.anchors = m.anchors;
        fig.gestures = m.gestures ?? [];
        if (m.tilt) fig.groupTilt = () => rot;
        z = m.z;
        resolve(fig);
      } else if (m.t === 'drawn') {
        if (typeof m.rot === 'number') rot = m.rot;
        z = m.z;
      } else if (m.t === 'scheme') {
        z = m.z;
        waits.get(m.seq)?.();
        waits.delete(m.seq);
      } else if (m.t === 'error') {
        fail(new Error(m.message));
      }
    }
    addEventListener('message', onMessage);
    layer.appendChild(frame);
  });
}
