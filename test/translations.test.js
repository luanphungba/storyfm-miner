// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { sentencesOf, buildSidecar } from '../src/translations.js';

const line = (s, text, extra = {}) => ({ s, text, speaker: 'A', role: 'storyteller', ...extra });

test('regroups the short lines of a sentence into the sentence', () => {
  const lines = [line(0, '你好，'), line(0, '欢迎收听。'), line(1, '我是爱哲。')];
  assert.deepEqual(sentencesOf(lines).map((s) => [s.unit, s.text, s.lines]), [[0, '你好，欢迎收听。', [0, 1]], [1, '我是爱哲。', [2]]]);
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
  assert.deepEqual(sidecar, { summary: ['Tóm tắt.'], lines: { 0: 'Tôi dùng iPhone.' } });
  assert.deepEqual([missing, stale], [[], []]);
});

test('drops a translation once a fix changes the Chinese under it', () => {
  const { sidecar, stale } = buildSidecar([line(0, '我去朝鲜。')], {
    sentences: { 0: { zh: '我去超市。', vi: 'Tôi đi siêu thị.' } },
  });
  assert.deepEqual(sidecar.lines, {});
  assert.deepEqual(stale, [0]);
});

test('names sentences with no translation, and translations of sentences that are gone', () => {
  const lines = [line(0, '一。'), line(1, '二。', { u: 0 }), line(2, '三。')];
  const { missing, orphaned } = buildSidecar(lines, { sentences: { 1: { zh: '二。', vi: 'Hai.' } } });
  assert.deepEqual([missing, orphaned], [[0, 2], [1]]);
});

test('each part of a sentence sits under the line it ends on', () => {
  const lines = [line(0, '因为我之前'), line(0, '看到一个数据，'), line(0, '成都的机场'), line(0, '叫天府机场。'), line(1, '对。')];
  const { sidecar, unsplit, misaligned } = buildSidecar(lines, {
    sentences: {
      0: {
        zh: '因为我之前看到一个数据，成都的机场叫天府机场。',
        parts: [
          { zh: '因为我之前', vi: 'Vì trước đây mình' },
          { zh: '看到一个数据，', vi: 'xem một số liệu,' },
          { zh: '成都的机场叫天府机场。', vi: 'sân bay Thành Đô tên là Thiên Phủ.' },
        ],
      },
      1: { zh: '对。', vi: 'Đúng.' },
    },
  });
  assert.deepEqual(sidecar.lines, { 0: 'Vì trước đây mình', 1: 'xem một số liệu,', 3: 'sân bay Thành Đô tên là Thiên Phủ.', 4: 'Đúng.' });
  assert.deepEqual([unsplit, misaligned], [[], []]);
});

test('a sentence of several lines translated as a whole still shows, under its last line, and is named', () => {
  const lines = [line(0, '你好，'), line(0, '欢迎收听。')];
  const { sidecar, unsplit } = buildSidecar(lines, { sentences: { 0: { zh: '你好，欢迎收听。', vi: 'Chào, chào mừng.' } } });
  assert.deepEqual(sidecar.lines, { 1: 'Chào, chào mừng.' });
  assert.deepEqual(unsplit, [0]);
});

test('a re-cut that moves a line end off a part is named, and the part goes under the line it now ends on', () => {
  const lines = [line(0, '你好，欢'), line(0, '迎收听。')];
  const { sidecar, misaligned } = buildSidecar(lines, {
    sentences: { 0: { zh: '你好，欢迎收听。', parts: [{ zh: '你好，', vi: 'Chào,' }, { zh: '欢迎收听。', vi: 'chào mừng.' }] } },
  });
  assert.deepEqual(sidecar.lines, { 0: 'Chào,', 1: 'chào mừng.' });
  assert.deepEqual(misaligned, [0]);
});

test('parts that no longer add up to the sentence are stale', () => {
  const { sidecar, stale } = buildSidecar([line(0, '你好，'), line(0, '欢迎。')], {
    sentences: { 0: { zh: '你好，欢迎。', parts: [{ zh: '你好，', vi: 'Chào,' }] } },
  });
  assert.deepEqual([sidecar.lines, stale], [{}, [0]]);
});
