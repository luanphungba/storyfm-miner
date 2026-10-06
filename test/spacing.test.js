// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { dueLabel, heardThrough, schedule, spacedPlaylist, tappedOf } from '../docs/spacing.js';

const studied = (ep, start, dates, end = start + 100) => ({ ep, episode: '', audio: 'https://a/x.m4a', n: 0, zh: '', vi: '', start, end, dates });
const heard = (ep, start, byDay) => ({ ep, start, seconds: 0, audio: 0, days: 0, last: '', byDay });

test('a chapter just studied is due the next day', () => {
  assert.deepEqual(schedule({ studied: ['2026-10-06'], heard: ['2026-10-06'], tapped: ['2026-10-06'] }), { due: '2026-10-07', interval: 1 });
});

test('taps bring it back daily, then each day heard through without one doubles the wait', () => {
  // The worked example the user was shown: 尴尬 tapped three days running, then understood.
  const days = { studied: ['2026-10-06'], heard: [], tapped: ['2026-10-06', '2026-10-07', '2026-10-08'] };
  assert.equal(schedule(days).due, '2026-10-09');
  const heardOn = ['2026-10-09', '2026-10-11', '2026-10-15'];
  assert.deepEqual(heardOn.map((_, k) => schedule({ ...days, heard: heardOn.slice(0, k + 1) }).due), ['2026-10-11', '2026-10-15', '2026-10-23']);
});

test('a tap, or studying it again, sets a long wait back to a day', () => {
  const base = { studied: ['2026-10-01'], heard: ['2026-10-02', '2026-10-04', '2026-10-08'] };
  assert.deepEqual(schedule({ ...base, tapped: [] }), { due: '2026-10-16', interval: 8 });
  assert.deepEqual(schedule({ ...base, tapped: ['2026-10-08'] }), { due: '2026-10-09', interval: 1 });
  assert.deepEqual(schedule({ ...base, studied: ['2026-10-01', '2026-10-08'], tapped: [] }), { due: '2026-10-09', interval: 1 });
});

test('heard every day it holds at two days, and heard early it keeps its wait, counted from then', () => {
  const daily = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  assert.deepEqual(schedule({ studied: ['2026-10-01'], heard: daily, tapped: [] }), { due: '2026-10-07', interval: 2 });
  // Waiting 8 days from 10-08, heard on 10-10 instead: still 8, from 10-10.
  const early = ['2026-10-02', '2026-10-04', '2026-10-08', '2026-10-10'];
  assert.deepEqual(schedule({ studied: ['2026-10-01'], heard: early, tapped: [] }), { due: '2026-10-18', interval: 8 });
});

test('heard late and still without a tap, it doubles the wait it really survived', () => {
  assert.deepEqual(schedule({ studied: ['2026-10-01'], heard: ['2026-10-02', '2026-10-12'], tapped: [] }), { due: '2026-11-01', interval: 20 });
});

test('what happened before it was first studied does not count', () => {
  assert.deepEqual(schedule({ studied: ['2026-10-05'], heard: ['2026-10-01'], tapped: ['2026-09-20'] }), { due: '2026-10-06', interval: 1 });
});

test('a day counts as heard through from nine tenths of the chapter, its rows and pages added up', () => {
  const s = studied('E517', 70.62, ['2026-10-01'], 170.62);
  const rows = [
    heard('E517', 70.62, { '2026-10-02': 60, '2026-10-03': 89, '2026-10-04': 250 }),
    heard('E517', 70.9, { '2026-10-02': 30 }), // the same chapter before a re-cut nudged its start
    heard('E517', 180, { '2026-10-03': 500 }),
    heard('E062', 70.62, { '2026-10-03': 500 }),
    { ...heard('E517', 70.62, {}), byDay: undefined }, // from a server older than byDay
  ];
  assert.deepEqual(heardThrough(rows, s).sort(), ['2026-10-02', '2026-10-04']);
});

test('finds the taps of a chapter, as the server listed it before a re-cut nudged its start', () => {
  const tapped = [{ ep: 'E517', start: 70.62, days: ['2026-10-06'], words: [] }];
  assert.equal(tappedOf(tapped, studied('E517', 70.9, [])), tapped[0]);
  assert.equal(tappedOf(tapped, studied('E517', 160, [])), undefined);
});

test('says how a due day stands from today', () => {
  assert.deepEqual(
    ['2026-10-03', '2026-10-06', '2026-10-07', '2026-10-10'].map((due) => dueLabel(due, '2026-10-06')),
    ['quá hạn 3 ngày', 'đến hạn hôm nay', 'đến hạn mai', 'còn 4 ngày'],
  );
});

test('plays the due chapters first, each episode together in story order, the one due longest ago first', () => {
  const due = {
    'CC1@60': '2026-10-06', 'CC1@6': '2026-10-04', 'CC2@9': '2026-10-05', 'CC2@190': '2026-10-09',
    'E062@0': '2026-10-07', 'E062@90': '2026-10-08', 'CC1@121': '2026-10-08',
  };
  const list = Object.keys(due).map((key) => {
    const [ep, start] = key.split('@');
    return studied(ep, Number(start), ['2026-10-01']);
  });
  const { due: now, upcoming } = spacedPlaylist(list, { today: '2026-10-06', dueOf: (s) => due[`${s.ep}@${s.start}`] });
  const keys = (/** @type {any[]} */ chapters) => chapters.map((s) => `${s.ep}@${s.start}`);
  assert.deepEqual(keys(now), ['CC1@6', 'CC1@60', 'CC2@9']);
  assert.deepEqual(keys(upcoming), ['E062@0', 'CC1@121', 'E062@90', 'CC2@190']);
});

test('among episodes due the same day, the one studied latest goes first; one episode can be picked', () => {
  const list = [studied('E062', 0, ['2026-10-01']), studied('CC3', 0, ['2026-10-03']), studied('CC3', 50, ['2026-10-02'])];
  const dueOf = () => '2026-10-06';
  assert.deepEqual(spacedPlaylist(list, { today: '2026-10-06', dueOf }).due.map((s) => `${s.ep}@${s.start}`), ['CC3@0', 'CC3@50', 'E062@0']);
  assert.deepEqual(spacedPlaylist(list, { today: '2026-10-06', ep: 'E062', dueOf }).due.map((s) => s.ep), ['E062']);
});
