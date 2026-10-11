/** Messages between CuaWorld and the engine child process (fork IPC, advanced serialization). */
import type { KeyCode } from './engine/keys.ts';

export type Button = 'left' | 'right' | 'middle';

/** How long to stay out of the user's way before an input action. */
export interface Yield {
  /** The user must have been idle this long. */
  idleMs: number;
  /** Give up after waiting this long. */
  maxWaitMs: number;
}

export type EngineRequest =
  | { op: 'info' }
  | { op: 'screenshot'; maxWidth: number; maxHeight: number; quality: number }
  | { op: 'click'; x: number; y: number; button: Button; count: number; yield: Yield }
  | { op: 'move'; x: number; y: number; yield: Yield }
  | { op: 'drag'; x1: number; y1: number; x2: number; y2: number; yield: Yield }
  | { op: 'scroll'; x: number; y: number; down: number; right: number; yield: Yield }
  | { op: 'type'; text: string; chunkDelayMs: number; yield: Yield }
  | { op: 'key'; chords: KeyCode[][]; yield: Yield }
  | { op: 'windows' }
  | { op: 'focus'; handle: string; yield: Yield }
  | { op: 'confirm'; text: string; caption: string; timeoutMs: number };

/** How a yes/no question to the person ended. */
export type Answer = 'yes' | 'no' | 'timeout';

export interface ScreenInfo {
  screen: { width: number; height: number };
  /** Physical pixels. */
  cursor: { x: number; y: number };
  foreground: string | null;
}

export interface ScreenshotResult extends ScreenInfo {
  jpeg: Uint8Array;
  width: number;
  height: number;
  scale: number;
}

/** Every input op reports how long it waited for the user and where the pointer ended up. */
export interface InputResult extends ScreenInfo {
  /** The user was not idle within `maxWaitMs`; nothing was sent. */
  yielded: boolean;
  waitedMs: number;
}

export interface WindowEntry {
  handle: string;
  title: string;
  pid: number;
  rect: { x: number; y: number; width: number; height: number };
  minimized: boolean;
  foreground: boolean;
}

export type MainToChild = { id: number; req: EngineRequest };
export type ChildToMain = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };
