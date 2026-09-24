import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.ts';
import { faceName, faceIdByName } from '../src/qface-map.ts';

// 这些函数不依赖 cortico 运行时，可在裸 node --test（非 node_modules 下）独立运行。

test('normalizeConfig 补全缺省值且保持对象引用身份（x-hot 生效前提）', () => {
  const raw = {} as Record<string, unknown>;
  const out = normalizeConfig(raw as never);
  // 同一引用：x-hot 改 loaded config 后能即时反映到 this.config
  assert.equal(out, raw);
  assert.deepEqual(out.groups, []);
  assert.deepEqual(out.privates, []);
  assert.equal(out.sentencesPerMessage, 1);
  assert.equal(out.splitReplyBySentence, true);
  // vision 子对象原地合并，仍为同一引用
  assert.ok(out.vision);
  assert.equal(out.vision.model, 'google/gemini-2.5-flash');
});

test('normalizeConfig 保留原始数组与 numbers', () => {
  const raw = { groups: [111, 222], privates: [333] } as Record<string, unknown>;
  const out = normalizeConfig(raw as never);
  assert.deepEqual(out.groups, [111, 222]);
  assert.deepEqual(out.privates, [333]);
});

test('qface-map 双向映射', () => {
  assert.equal(faceName(0), '微笑');
  assert.equal(faceIdByName('旺柴'), '210');
  assert.equal(faceIdByName('不存在的表情'), null);
});
