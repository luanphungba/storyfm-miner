// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRoles } from '../src/roles.js';

/** @returns {import('../src/segment.js').Cue} */
const cue = (i, start, end, speaker) => ({ i, start, end, speaker, text: '…' });

const roles = (/** @type {{role: string}[]} */ cues) => cues.map((c) => c.role);

test('calls the speaker who talks least the narrator', () => {
  const result = assignRoles([cue(0, 0, 60, 'A'), cue(1, 60, 80, 'B'), cue(2, 300, 900, 'B')]);
  assert.deepEqual(roles(result), ['narrator', 'storyteller', 'storyteller']);
});

test('E077: host opens with a 50s intro, then the guest holds the episode', () => {
  const result = assignRoles([cue(0, 0, 50, 'A'), cue(1, 53, 180, 'B'), cue(2, 180, 770, 'B')]);
  assert.deepEqual(roles(result), ['narrator', 'storyteller', 'storyteller']);
});

test('E062: the guest cold-opens before the host says anything', () => {
  const result = assignRoles([cue(0, 0, 8, 'A'), cue(1, 8, 23, 'B'), cue(2, 23, 641, 'A')]);
  assert.deepEqual(roles(result), ['storyteller', 'narrator', 'storyteller']);
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
