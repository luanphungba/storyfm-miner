// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRoles } from '../src/roles.js';

/** @returns {import('../src/segment.js').Cue} */
const cue = (i, start, end, speaker) => ({ i, start, end, speaker, text: '…' });

const roles = (/** @type {{role: string}[]} */ cues) => cues.map((c) => c.role);

test('calls the speaker who dominates the opening the narrator', () => {
  const result = assignRoles([
    cue(0, 0, 60, 'A'),
    cue(1, 60, 80, 'B'),
    cue(2, 300, 900, 'B'),
  ]);
  assert.deepEqual(roles(result), ['narrator', 'storyteller', 'storyteller']);
});

test('ignores speaking time after the opening window', () => {
  // B talks for ten minutes, but only after the window — A still opened the episode.
  const result = assignRoles([cue(0, 0, 100, 'A'), cue(1, 200, 800, 'B')]);
  assert.deepEqual(roles(result), ['narrator', 'storyteller']);
});

test('counts only the part of a cue inside the window', () => {
  // B's cue starts inside the window but runs long; only its first 20s count, so A still wins.
  const result = assignRoles([cue(0, 0, 100, 'A'), cue(1, 160, 600, 'B')]);
  assert.deepEqual(roles(result), ['narrator', 'storyteller']);
});

test('labels everything storyteller when diarization found one voice', () => {
  const result = assignRoles([cue(0, 0, 100, 'A'), cue(1, 100, 200, 'A')]);
  assert.deepEqual(roles(result), ['storyteller', 'storyteller']);
});

test('honours an explicit narrator override', () => {
  const result = assignRoles([cue(0, 0, 100, 'A'), cue(1, 100, 200, 'B')], 'B');
  assert.deepEqual(roles(result), ['storyteller', 'narrator']);
});

test('override still applies when only one voice was found', () => {
  const result = assignRoles([cue(0, 0, 100, 'A')], 'A');
  assert.deepEqual(roles(result), ['narrator']);
});
