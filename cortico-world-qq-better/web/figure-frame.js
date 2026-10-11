/**
 * Inside the sandboxed figure frame: loads a figure pack's module and draws its body.
 *
 * The frame is an opaque origin with no network access (the server's CSP for `/figure-frame`);
 * it gets scripts and images from the pet server and everything else from the page that holds
 * it (`figure-sandbox.js`), by postMessage:
 *
 * - `init { entry, export, base, model, scheme }`: imports `entry` and calls its `export` as
 *   `factory(base, { model, scheme, createRig, loadImage, asset })`, the contract a pack implements
 *   (api 1): it resolves to `{ draw(petG, face, frame), anchors?, gestures?, colors?, groupTilt?,
 *   setScheme?(id, { fade, at }) }`, as pet-core's `opts.figure`. `createRig` is web/rig/rig.js;
 *   `loadImage` loads a pack image so WebGL may read it.
 * - `frame { transform, face, frame }`: one frame, the stage transform for the group and the
 *   arguments of `draw`.
 * - `scheme { id, fade, at, seq }`: switches the dress-up pick.
 *
 * It answers `loaded`, `ready { anchors, gestures, z, tilt }`, `drawn { rot, z }` after each frame
 * (the group rotation the figure asks for, used by the next frame), `scheme { seq, z }`, and
 * `error { message }` once, after which it stops.
 */
import { createRig } from './rig/rig.js';

const petG = document.getElementById('pet');
let fig = null, dead = false;
const post = (m) => parent.postMessage(m, '*');
function fail(err) {
  if (dead) return;
  dead = true;
  post({ t: 'error', message: String(err?.message ?? err).slice(0, 300) });
}
addEventListener('error', (e) => fail(e.error ?? e.message));
addEventListener('unhandledrejection', (e) => fail(e.reason));

function loadImage(url) {
  return new Promise((ok, bad) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => bad(new Error(`图片没加载出来:${url}`));
    im.src = String(url);
  });
}

addEventListener('message', async (e) => {
  if (e.source !== parent || dead) return;
  const m = e.data || {};
  try {
    if (m.t === 'init') {
      const mod = await import(m.entry);
      const make = mod[m.export];
      if (typeof make !== 'function') throw new Error(`${m.export} 不是函数`);
      const base = new URL(m.base);
      fig = await make(base, { model: m.model ?? undefined, scheme: m.scheme, createRig, loadImage, asset: (p) => new URL(p, base) });
      if (typeof fig?.draw !== 'function') throw new Error('形象没有 draw');
      post({ t: 'ready', anchors: fig.anchors ?? null, gestures: Array.isArray(fig.gestures) ? fig.gestures : [], z: fig.colors?.z ?? null, tilt: typeof fig.groupTilt === 'function' });
    } else if (m.t === 'frame' && fig) {
      petG.setAttribute('transform', m.transform);
      fig.draw(petG, m.face, m.frame);
      const f = m.frame;
      post({ t: 'drawn', rot: fig.groupTilt ? fig.groupTilt(f.mode, f.tilt, f.lean) : null, z: fig.colors?.z ?? null });
    } else if (m.t === 'scheme' && fig) {
      await fig.setScheme?.(m.id, { fade: m.fade, at: m.at });
      post({ t: 'scheme', seq: m.seq, z: fig.colors?.z ?? null });
    }
  } catch (err) {
    fail(err);
  }
});
post({ t: 'loaded' });
