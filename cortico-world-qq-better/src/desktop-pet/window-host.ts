/**
 * Starts and stops the process that shows the pet window: an Electron main process running
 * `host/electron-main.cjs`, which opens a transparent, frameless, always-on-top window over
 * the work area of one display (the primary one at start) and loads the pet page.
 *
 * Which Electron, in order:
 * 1. `CORTICO_DESKTOP_PET_HOST`: a JSON array command set by an embedding app; it gets
 *    `--pet-url=<url>` appended and must open the window itself.
 * 2. `worlds.desktop-pet.window.electronFile`.
 * 3. The managed runtime installed from the panel.
 * 4. An `electron` package resolvable from this package.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { delimiter, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'cortico/core/types.ts';

export const HOST_ENV = 'CORTICO_DESKTOP_PET_HOST';
export const HOST_MAIN = fileURLToPath(new URL('../../host/electron-main.cjs', import.meta.url));

export type HostPhase = 'stopped' | 'running' | 'missing' | 'error';

export interface HostState {
  phase: HostPhase;
  pid: number | null;
  /** Which command runs the window. */
  source: string | null;
  detail: string | null;
}

export type HostCommand = { command: string; args: string[]; source: string } | { missing: string };

export function resolveHostCommand(url: string, electronFile: string, managed: string | null): HostCommand {
  const env = process.env[HOST_ENV];
  if (env) {
    try {
      const argv = JSON.parse(env) as unknown;
      if (Array.isArray(argv) && argv.length > 0 && argv.every((a) => typeof a === 'string')) {
        return { command: argv[0], args: [...argv.slice(1), `--pet-url=${url}`], source: HOST_ENV };
      }
    } catch { /* fall through to the reason below */ }
    return { missing: `${HOST_ENV} 不是 JSON 字符串数组` };
  }
  if (electronFile) {
    if (!existsSync(electronFile)) return { missing: `Electron 程序不存在:${electronFile}` };
    return { command: electronFile, args: [HOST_MAIN, `--pet-url=${url}`], source: electronFile };
  }
  if (managed) return { command: managed, args: [HOST_MAIN, `--pet-url=${url}`], source: managed };
  try {
    const bin = createRequire(import.meta.url)('electron') as unknown;
    if (typeof bin === 'string' && existsSync(bin)) return { command: bin, args: [HOST_MAIN, `--pet-url=${url}`], source: bin };
  } catch { /* not installed */ }
  return { missing: '没有可用的 Electron:在桌宠面板安装窗口运行时,或在配置里指定 Electron 程序' };
}

/** The Electron runtime binary name on this platform. */
const ELECTRON_BIN =
  process.platform === 'win32' ? 'electron.exe'
  : process.platform === 'darwin' ? 'Electron'
  : 'electron';

/** Directories that are huge and never hold a useful Electron binary; skip them while scanning. */
const SCAN_SKIP = new Set([
  'node_modules', '.git', '.pnpm', 'node_modules.asar',
  '$RECYCLE.BIN', 'System32', 'SysWOW64', 'WinSxS', 'Windows',
]);
/** Hard ceiling so a walk can never hang the process. */
const SCAN_MAX_DIRS = 20000;
const SCAN_DEPTH = 4;

/** Roots on this machine that might already contain an Electron runtime. */
function candidateRoots(): string[] {
  const roots = new Set<string>();
  const push = (...ps: Array<string | undefined>) => {
    for (const p of ps) if (p && existsSync(p)) roots.add(p);
  };
  push(
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    process.env.USERPROFILE,
    process.env.HOME,
  );
  // Cortico's managed runtimes live under <CORTICO_HOME>/runtimes.
  if (process.env.CORTICO_HOME) push(join(process.env.CORTICO_HOME, 'runtimes'));
  for (const lib of steamLibraries()) push(lib);
  return [...roots];
}

/** Steam library folders, where a lot of Electron apps end up installed. */
function steamLibraries(): string[] {
  const libs: string[] = [];
  const steam = process.env['ProgramFiles(x86)']
    ? join(process.env['ProgramFiles(x86)'], 'Steam')
    : null;
  const vdf = steam ? join(steam, 'steamapps', 'libraryfolders.vdf') : null;
  if (vdf && existsSync(vdf)) {
    try {
      const text = readFileSync(vdf, 'utf8');
      const re = /"path"\s+"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) libs.push(m[1]);
    } catch { /* ignore unreadable vdf */ }
  }
  return libs;
}

/** Depth-first search for Electron binaries under `dir`, bounded by depth, total dir visits and result cap. */
function collectElectron(dir: string, depth: number, max: number, out: Set<string>, visits: { n: number }): void {
  if (depth < 0 || out.size >= max || visits.n >= SCAN_MAX_DIRS) return;
  let entries: Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  visits.n++;
  for (const e of entries) {
    if (out.size >= max || visits.n >= SCAN_MAX_DIRS) return;
    const full = join(dir, e.name);
    if (e.isFile()) {
      if (e.name === ELECTRON_BIN) out.add(full);
    } else if (e.isDirectory() && !SCAN_SKIP.has(e.name)) {
      collectElectron(full, depth - 1, max, out, visits);
    }
  }
}

/** Scans the machine for Electron runtimes that already exist (does not download anything). */
export function scanForElectron(max = 12): string[] {
  const out = new Set<string>();
  // 1. Anything on PATH first: fast and authoritative.
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const exe = join(dir, ELECTRON_BIN);
    if (existsSync(exe)) out.add(exe);
  }
  // 2. Bounded filesystem walk over the likely roots.
  const visits = { n: 0 };
  for (const root of candidateRoots()) {
    if (out.size >= max || visits.n >= SCAN_MAX_DIRS) break;
    collectElectron(root, SCAN_DEPTH, max, out, visits);
  }
  return [...out];
}

export class WindowHost {
  private child: ChildProcess | null = null;
  private st: HostState = { phase: 'stopped', pid: null, source: null, detail: null };

  constructor(private readonly log: Logger) {}

  state(): HostState {
    return { ...this.st, pid: this.child?.pid ?? null };
  }

  get running(): boolean {
    return this.child !== null;
  }

  start(cmd: HostCommand): void {
    if (this.child) return;
    if ('missing' in cmd) {
      this.st = { phase: 'missing', pid: null, source: null, detail: cmd.missing };
      return;
    }
    const env = { ...process.env };
    // an embedding Electron app may run this process as Node; the window process must not
    delete env.ELECTRON_RUN_AS_NODE;
    let child: ChildProcess;
    try {
      // the window closes by itself if this process dies without stopping it
      child = spawn(cmd.command, [...cmd.args, `--parent-pid=${process.pid}`], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    } catch (err) {
      this.st = { phase: 'error', pid: null, source: cmd.source, detail: `启动失败:${(err as Error).message}` };
      return;
    }
    this.child = child;
    this.st = { phase: 'running', pid: child.pid ?? null, source: cmd.source, detail: null };
    const log = this.log.child('window');
    const forward = (d: Buffer) => { for (const line of d.toString().split(/\r?\n/)) if (line.trim()) log.debug(line); };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.on('error', (err) => { this.st = { ...this.st, phase: 'error', detail: err.message }; });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.st = { phase: 'stopped', pid: null, source: cmd.source, detail: code === 0 ? '窗口已关闭' : `窗口进程退出(退出码 ${code})` };
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.st = { ...this.st, phase: 'stopped', pid: null, detail: null };
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    }
  }
}
