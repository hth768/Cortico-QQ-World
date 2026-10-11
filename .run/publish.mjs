/**
 * 双通道发布脚本。
 *
 * 用法：
 *   node .run/publish.mjs stable 0.1.62      → 发 cortico-world-qq-final
 *   node .run/publish.mjs beta   0.1.63-beta.1 → 发 cortico-world-qq-final-beta（带 --tag=beta）
 *
 * stable = 稳定版通道；beta = 不稳定测试通道。两个包名相互独立、版本线相互独立。
 * 发布时会临时改写 package.json 的 name/version 并在 README 顶部加对应横幅，
 * 结束后无论成功失败都还原，源码仓始终保持在 stable 身份。
 *
 * 注意：Windows 下必须经 `cmd /c` 调 npm，直接 execFileSync('npm publish ...') 会 ENOENT。
 * 注意：新包名首次发布 npm 有延迟（先出 0.0.0-stage 占位版、tarball 404），
 *       publish 返回成功后要隔几分钟复验 tarball 是否 200。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = path.resolve(import.meta.dirname, '..', 'cortico-world-qq-better');
const channel = process.argv[2];
const version = process.argv[3];

const CHANNELS = {
  stable: { name: 'cortico-world-qq-final', tag: null },
  beta: { name: 'cortico-world-qq-final-beta', tag: 'beta' },
};

if (!CHANNELS[channel] || !version) {
  console.log('用法: node .run/publish.mjs <stable|beta> <version>');
  console.log('  stable → cortico-world-qq-final');
  console.log('  beta   → cortico-world-qq-final-beta');
  process.exit(1);
}

const { name: pkgName, tag } = CHANNELS[channel];
const pkgPath = path.join(dir, 'package.json');
const readmePath = path.join(dir, 'README.md');
const backup = {
  pkg: fs.readFileSync(pkgPath, 'utf8'),
  readme: fs.readFileSync(readmePath, 'utf8'),
};

const BANNERS = {
  stable:
    '> 📦 **更名提示**：本包原名为 `cortico-world-qq-better`，自 `0.1.61` 起更名为 `cortico-world-qq-final`（代码完全一致，仅包名变化）。旧名已标记为废弃（deprecated），请改为安装本包。\n\n',
  beta:
    '> 🧪 **测试版（beta）**：这是 `cortico-world-qq-final` 的独立测试通道，发布的是**不稳定、未验证**的版本。\n' +
    '> 稳定版请安装 `cortico-world-qq-final`。\n' +
    '> **不要与 stable 版同时安装** —— 两者 world id 同为 `qqbot`，同时挂载会报「World 已挂载」冲突。\n\n',
};

try {
  const pkg = JSON.parse(backup.pkg);
  pkg.name = pkgName;
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  const readme = backup.readme;
  fs.writeFileSync(readmePath, BANNERS[channel] + readme.slice(readme.indexOf('# ')), 'utf8');

  const cmd = 'npm publish --no-git-checks --registry=https://registry.npmjs.org/'
    + (tag ? ` --tag=${tag}` : '');
  console.log(`发布 ${pkgName}@${version} ${tag ? `(tag=${tag})` : ''} ...`);
  try {
    console.log(execFileSync('cmd', ['/c', cmd], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim());

    // beta 通道用 --tag=beta 发布，npm 不会移动 latest（首发的 latest 是 npm 顺带设的）。
    // 控制台点安装走的是裸包名 `pnpm add <name>`，解析的是 latest —— 不补这步的话
    // 后续 beta 会永远装到第一个版本。显式把 latest 也指到刚发布的版本。
    if (tag) {
      const dt = `npm dist-tag add ${pkgName}@${version} latest --registry=https://registry.npmjs.org/`;
      console.log(execFileSync('cmd', ['/c', dt], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim());
    }
  } catch (e) {
    console.log('发布失败 rc=', e.status);
    console.log((e.stdout || '') + (e.stderr || ''));
    process.exitCode = 1;
  }
} finally {
  fs.writeFileSync(pkgPath, backup.pkg, 'utf8');
  fs.writeFileSync(readmePath, backup.readme, 'utf8');
}

const restored = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
console.log(`\n已还原源码: name=${restored.name} version=${restored.version}`);
if (!process.exitCode) {
  console.log('提示：新包名/新版本在 npm 上有元数据延迟，请稍后复验 tarball 是否可下载。');
}
