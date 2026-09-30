// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { toNumbered, checkReading, applyReadings, readingsWithin } from '../src/readings.js';

/** The CC-CEDICT readings these tests need, as the dictionary numbers them. */
const CEDICT = {
  行: ['hang2', 'heng2', 'xing2'], 里: ['li3'], 长: ['chang2', 'zhang3'], 了: ['le5', 'liao3'],
  种: ['zhong3', 'zhong4'], 花: ['hua1'], 不: ['bu4'], 是: ['shi4'], 绿: ['lu:4'],
};
const listed = (/** @type {string} */ c) => CEDICT[/** @type {keyof CEDICT} */ (c)] ?? [];

test('reads tone marks as CC-CEDICT numbers them', () => {
  assert.equal(toNumbered('zhǎng'), 'zhang3');
  assert.equal(toNumbered('háng'), 'hang2');
  assert.equal(toNumbered('le'), 'le5');
  assert.equal(toNumbered('lǜ'), 'lv4');
});

test('passes a reading the dictionary lists for every character', () => {
  assert.deepEqual(checkReading('行里', 'háng lǐ', listed), []);
  assert.deepEqual(checkReading('种种花', 'zhòng zhòng huā', listed), []);
  assert.deepEqual(checkReading('绿', 'lǜ', listed), []);
});

test('fails a mistyped tone rather than shipping it', () => {
  const problems = checkReading('长长了', 'zhàng cháng le', listed);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /长 đọc "zhàng"/);
});

test('fails a syllable count that does not match the phrase', () => {
  assert.equal(checkReading('行里', 'háng', listed).length, 1);
});

test('allows the neutral tone and the tone change of 不, which no character entry shows', () => {
  assert.deepEqual(checkReading('长长了', 'zhǎng cháng le', listed), []);
  assert.deepEqual(checkReading('不是', 'bú shì', listed), []);
  assert.equal(checkReading('长', 'zhang', listed).length, 0);
  assert.equal(checkReading('行', 'xang', listed).length, 1);
});

test('writes the phrase reading over every occurrence and marks those characters fixed', () => {
  const text = '我们行里，行里人多';
  const readings = [...text].map(() => '?');
  const { fixed, used } = applyReadings(text, readings, { 行里: ['háng lǐ', 'the bank'] });
  assert.deepEqual(readings, ['?', '?', 'háng', 'lǐ', '?', 'háng', 'lǐ', '?', '?']);
  assert.deepEqual(fixed, [false, false, true, true, false, true, true, false, false]);
  assert.deepEqual([...used], ['行里']);
});

test('reports a phrase that is not in the text as unused', () => {
  const { used } = applyReadings('没有', ['méi', 'yǒu'], { 行里: ['háng lǐ', 'the bank'] });
  assert.equal(used.size, 0);
});

test('gives every word inside a phrase the reading the phrase gives it', () => {
  const within = readingsWithin({ 种种花: ['zhòng zhòng huā', 'planting'] });
  assert.equal(within.get('种种'), 'zhòng zhòng');
  assert.equal(within.get('花'), 'huā');
  assert.equal(within.get('种种花'), 'zhòng zhòng huā');
});
