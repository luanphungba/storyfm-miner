// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { played, playedBeforeSeek, studyDay } from '../docs/listening.js';

const at = (/** @type {number} */ position, /** @type {number} */ time) => ({ position, time });

test('counts how far the playhead moved, at any speed', () => {
  assert.equal(played(at(10, 0), at(10.25, 250), 1), 0.25);
  assert.equal(played(at(10, 0), at(10.5, 250), 2), 0.5);
});

test('a stalled download moves nothing, and a loop starting over goes back', () => {
  assert.equal(played(at(10, 0), at(10, 3000), 1), 0);
  assert.equal(played(at(95, 0), at(5, 250), 1), 0);
});

test('a jump counts no more than the time that passed', () => {
  assert.equal(played(at(10, 0), at(400, 250), 1), 0.75);
});

test('a page frozen with the screen off is paid back on its next reading', () => {
  assert.equal(played(at(10, 0), at(610, 600_000), 1), 600);
});

test('up to a seek the clock says what played, as a loop starts over before its end is seen', () => {
  assert.equal(playedBeforeSeek(at(109.8, 0), 250, 1), 0.25);
  assert.equal(playedBeforeSeek(at(109.8, 0), 250, 2), 0.5);
  assert.equal(playedBeforeSeek(at(109.8, 0), 30_000, 1), 1); // a stall before the seek played nothing
});

test('the day turns at 4:00, so past midnight is still the evening before', () => {
  assert.equal(studyDay(new Date(2026, 9, 3, 3, 59)), '2026-10-02');
  assert.equal(studyDay(new Date(2026, 9, 3, 4, 0)), '2026-10-03');
});
