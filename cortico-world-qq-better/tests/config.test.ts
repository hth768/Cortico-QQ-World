import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, QQ_DEFAULTS } from '../src/config.ts';

test('normalizeConfig 字符串 groups/privates 按空格/逗号解析为数字数组', () => {
  const out = normalizeConfig({ groups: '111,222 333', privates: '9' } as never);
  assert.deepEqual(out.groups, [111, 222, 333], '字符串应解析为数字数组');
  assert.deepEqual(out.privates, [9]);
});

test('normalizeConfig 无法解析的字符串 groups/privates → 空数组', () => {
  const out = normalizeConfig({ groups: 'abc,xyz' } as never);
  assert.deepEqual(out.groups, [], '无法解析应回退为空数组');
});

test('normalizeConfig 缺省值来自 QQ_DEFAULTS', () => {
  const out = normalizeConfig({} as never);
  assert.equal(out.mode, QQ_DEFAULTS.mode);
  assert.equal(out.wsPort, QQ_DEFAULTS.wsPort);
  assert.equal(out.forwardExpandLimit, QQ_DEFAULTS.forwardExpandLimit);
  assert.equal(out.sendIntervalMs, QQ_DEFAULTS.sendIntervalMs);
});

test('normalizeConfig vision 缺省 model 存在', () => {
  const out = normalizeConfig({} as never);
  assert.equal(typeof out.vision.model, 'string');
  assert.ok(out.vision.maxConcurrent >= 1);
});
