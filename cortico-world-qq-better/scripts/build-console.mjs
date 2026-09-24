// 打包 QQ 扩展的控制台面板 bundle（ESM），供 v5 框架按 /assets/extensions/<pkg>/<version>/console.js 加载。
// 复用 Cortico 仓库里的 esbuild，避免在本扩展里另装依赖。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Cortico 仓库的 esbuild（绝对路径，跨平台可用）。
const esbuild = require(resolve(__dirname, '../../Cortico/node_modules/esbuild'));

const entry = resolve(__dirname, '../src/console/client.ts');
const outfile = resolve(__dirname, '../dist/console.js');

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: false,
  logLevel: 'info',
});

console.log(`built ${outfile}`);
