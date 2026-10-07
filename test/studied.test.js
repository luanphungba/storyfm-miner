// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterLink, dayLabel, findStudied, heardAgain, playlist, shuffled, shuffledByEpisode } from '../docs/studied.js';

const studied = (ep, start, dates) => ({ ep, episode: '', audio: 'https://a/x.m4a', n: 0, zh: '', vi: '', start, end: start + 90, dates });

test('a chapter on the page is the studied one starting within half a second of it', () => {
  const list = [studied('E517', 607.01, ['2026-10-01'])];
  assert.equal(findStudied(list, 'E517', 607.3), list[0]);
  assert.equal(findStudied(list, 'E517', 608), undefined);
  assert.equal(findStudied(list, 'E062', 607.01), undefined);
});

test('a chapter is heard again on any day after the first it was studied on', () => {
  const list = [studied('CC4', 69.3, ['2026-10-06'])];
  assert.equal(heardAgain(list, 'CC4', 69.3, '2026-10-07'), true);
  assert.equal(heardAgain(list, 'CC4', 69.3, '2026-10-06'), false, 'the day it was studied is still studying it');
  assert.equal(heardAgain(list, 'CC4', 0, '2026-10-07'), false, 'a chapter never studied');
  assert.equal(heardAgain([studied('CC4', 69.3, ['2026-10-06', '2026-10-07'])], 'CC4', 69.3, '2026-10-07'), true);
});

test('says how long ago a day was', () => {
  assert.deepEqual(
    ['2026-10-01', '2026-09-30', '2026-09-24'].map((day) => dayLabel(day, '2026-10-01')),
    ['hôm nay', 'hôm qua', '7 ngày trước'],
  );
});

test('the last seven days count today and go by the latest day a chapter was studied', () => {
  const list = [studied('E062', 0, ['2026-09-20']), studied('E077', 0, ['2026-09-20', '2026-09-25']), studied('E081', 0, ['2026-09-24'])];
  assert.deepEqual(playlist(list, { today: '2026-10-01', days: 7 }).map((s) => s.ep), ['E077']);
  assert.equal(playlist(list, { today: '2026-10-01', days: null }).length, 3);
});

test('plays an episode whole and in story order, though its chapters were studied days apart', () => {
  const list = [
    studied('CC1', 60, ['2026-10-02']),
    studied('CC2', 190, ['2026-10-02']),
    studied('CC1', 6, ['2026-10-01']),
    studied('E062', 0, ['2026-09-30']),
    studied('CC2', 9, ['2026-10-01']),
    studied('CC1', 121, ['2026-10-02']),
  ];
  assert.deepEqual(
    playlist(list, { today: '2026-10-02', days: null }).map((s) => `${s.ep}@${s.start}`),
    ['CC1@6', 'CC1@60', 'CC1@121', 'CC2@9', 'CC2@190', 'E062@0'],
  );
});

test('plays the episode studied latest first, and each episode in story order', () => {
  const list = [
    studied('E517', 300, ['2026-09-30']),
    studied('CC2', 90, ['2026-10-01']),
    studied('E517', 100, ['2026-09-30']),
    studied('CC2', 10, ['2026-10-01']),
  ];
  assert.deepEqual(
    playlist(list, { today: '2026-10-01', days: null }).map((s) => `${s.ep}@${s.start}`),
    ['CC2@10', 'CC2@90', 'E517@100', 'E517@300'],
  );
  assert.deepEqual(playlist(list, { today: '2026-10-01', days: null, ep: 'E517' }).map((s) => s.start), [100, 300]);
});

test('shuffles everything but the chapter tapped, which plays first', () => {
  const items = [1, 2, 3, 4, 5];
  const once = shuffled(items, 3, () => 0);
  assert.equal(once[0], 3);
  assert.deepEqual([...once].sort(), items);
  assert.deepEqual(items, [1, 2, 3, 4, 5]);
});

test('a shuffle moves whole episodes, each still in story order, the tapped one first', () => {
  const shown = playlist([
    studied('CC1', 6, ['2026-10-01']), studied('CC1', 60, ['2026-10-02']), studied('CC1', 121, ['2026-10-02']),
    studied('CC2', 9, ['2026-10-01']), studied('CC2', 93, ['2026-10-01']), studied('CC2', 190, ['2026-10-02']),
    studied('E001-2', 0, ['2026-10-02']),
  ], { today: '2026-10-02', days: null });
  const tapped = shown.find((s) => s.ep === 'CC2' && s.start === 93);
  assert.deepEqual(
    shuffledByEpisode(shown, tapped, () => 0).map((s) => `${s.ep}@${s.start}`),
    ['CC2@9', 'CC2@93', 'CC2@190', 'E001-2@0', 'CC1@6', 'CC1@60', 'CC1@121'],
  );
  for (let round = 0; round < 20; round += 1) {
    const queue = shuffledByEpisode(shown, undefined);
    const episodes = queue.map((s) => s.ep).filter((ep, i, all) => ep !== all[i - 1]);
    assert.deepEqual([...episodes].sort(), ['CC1', 'CC2', 'E001-2']);
    for (const ep of episodes) {
      assert.deepEqual(queue.filter((s) => s.ep === ep), shown.filter((s) => s.ep === ep));
    }
  }
});

test('links the chapter rounded the way the loop bar holds a chapter', () => {
  assert.equal(chapterLink(studied('E001-2', 607.01, [])), 'player.html?ep=E001-2&start=607&end=697.1');
});
