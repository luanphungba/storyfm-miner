// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { sentencesOf, buildSidecar } from '../src/translations.js';

const line = (s, text, extra = {}) => ({ s, text, speaker: 'A', role: 'storyteller', ...extra });

test('regroups the short lines of a sentence into the sentence', () => {
  const lines = [line(0, '你好，'), line(0, '欢迎收听。'), line(1, '我是爱哲。')];
  assert.deepEqual(sentencesOf(lines).map((s) => [s.unit, s.text]), [[0, '你好，欢迎收听。'], [1, '我是爱哲。']]);
});

test('a sentence joined onto the one before is translated with it', () => {
  const lines = [line(4, '我们到了'), line(5, '平壤，', { u: 4 }), line(5, '天很冷。', { u: 4 })];
  assert.deepEqual(sentencesOf(lines).map((s) => [s.unit, s.text]), [[4, '我们到了平壤，天很冷。']]);
});

test('keeps a translation whose Chinese is unchanged, ignoring spaces', () => {
  const { sidecar, missing, stale } = buildSidecar([line(0, '我用 iPhone。')], {
    summary: ['Tóm tắt.'],
    sentences: { 0: { zh: '我用iPhone。', vi: 'Tôi dùng iPhone.' } },
  });
  assert.deepEqual(sidecar, { summary: ['Tóm tắt.'], vi: { 0: 'Tôi dùng iPhone.' } });
  assert.deepEqual([missing, stale], [[], []]);
});

test('drops a translation once a fix changes the Chinese under it', () => {
  const { sidecar, stale } = buildSidecar([line(0, '我去朝鲜。')], {
    sentences: { 0: { zh: '我去超市。', vi: 'Tôi đi siêu thị.' } },
  });
  assert.deepEqual(sidecar.vi, {});
  assert.deepEqual(stale, [0]);
});

test('names sentences with no translation, and translations of sentences that are gone', () => {
  const lines = [line(0, '一。'), line(1, '二。', { u: 0 }), line(2, '三。')];
  const { missing, orphaned } = buildSidecar(lines, { sentences: { 1: { zh: '二。', vi: 'Hai.' } } });
  assert.deepEqual([missing, orphaned], [[0, 2], [1]]);
});
