// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRoles } from '../src/roles.js';

/** @returns {import('../src/segment.js').Cue} */
const cue = (i, start, end, speaker) => ({ i, start, end, speaker, text: '…' });

const roles = (/** @type {{role: string}[]} */ cues) => cues.map((c) => c.role);

test('calls whoever opens the episode the narrator', () => {
  const result = assignRoles([cue(0, 0, 60, 'A'), cue(1, 60, 80, 'B'), cue(2, 300, 900, 'B')]);
  assert.deepEqual(roles(result), ['narrator', 'storyteller', 'storyteller']);
});

test('does not hand the role to whoever talks the most', () => {
  // E077's shape: a 50s intro from the host, then the guest holds the rest of the episode.
  const result = assignRoles([cue(0, 0, 50, 'A'), cue(1, 53, 180, 'B'), cue(2, 180, 770, 'B')]);
  assert.deepEqual(roles(result), ['narrator', 'storyteller', 'storyteller']);
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
