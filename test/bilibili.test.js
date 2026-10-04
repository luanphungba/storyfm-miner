import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideo, videoLink, placeVideo } from '../src/bilibili.js';

const video = (id) => ({ id, title: id, owner: 'o', pubDate: '2026-07-03', duration: 1, m4a: `${id}.m4a` });

test('a link, a bare BV id and an episode id all name the video and its part', () => {
  assert.deepEqual(parseVideo('https://www.bilibili.com/video/BV1HQTs6FEos/?vd_source=47884b251c892e79757ce49664a4f031'),
    { bvid: 'BV1HQTs6FEos', page: 1, id: 'BV1HQTs6FEos' });
  assert.deepEqual(parseVideo('https://www.bilibili.com/video/BV1HQTs6FEos/?spm_id_from=333&p=3&vd_source=4788'),
    { bvid: 'BV1HQTs6FEos', page: 3, id: 'BV1HQTs6FEos-p3' });
  assert.deepEqual(parseVideo('BV1HQTs6FEos-p2'), { bvid: 'BV1HQTs6FEos', page: 2, id: 'BV1HQTs6FEos-p2' });
  assert.equal(parseVideo('BV1HQTs6FEos?p=1').id, 'BV1HQTs6FEos'); // part 1 keeps the bare id
  assert.throws(() => parseVideo('https://www.bilibili.com/'), /mã BV/);
  assert.throws(() => parseVideo('BV1HQTs6FEos?p=0'), /Phần 0/);
});

test('a later part links to its own part on Bilibili', () => {
  assert.equal(videoLink('BV1HQTs6FEos'), 'https://www.bilibili.com/video/BV1HQTs6FEos/');
  assert.equal(videoLink('BV1HQTs6FEos-p7'), 'https://www.bilibili.com/video/BV1HQTs6FEos/?p=7');
});

test('a new video goes first, a part beside its other parts in part order', () => {
  const ids = (videos) => videos.map((v) => v.id);
  const catalogue = [video('BV1HQTs6FEos'), video('BV1yZ421M7NR')];

  assert.deepEqual(ids(placeVideo(catalogue, video('BV1GMtJ62Eo5'))), ['BV1GMtJ62Eo5', 'BV1HQTs6FEos', 'BV1yZ421M7NR']);

  let added = catalogue;
  for (const id of ['BV1HQTs6FEos-p2', 'BV1HQTs6FEos-p3']) added = placeVideo(added, video(id));
  assert.deepEqual(ids(added), ['BV1HQTs6FEos', 'BV1HQTs6FEos-p2', 'BV1HQTs6FEos-p3', 'BV1yZ421M7NR']);

  // Added out of order, a part still lands between its neighbours, and before the first when it is lower.
  const gap = placeVideo([video('BV1HQTs6FEos-p4'), video('BV1HQTs6FEos-p6'), video('BV1yZ421M7NR')], video('BV1HQTs6FEos-p5'));
  assert.deepEqual(ids(gap), ['BV1HQTs6FEos-p4', 'BV1HQTs6FEos-p5', 'BV1HQTs6FEos-p6', 'BV1yZ421M7NR']);
  const lower = placeVideo([video('BV1yZ421M7NR'), video('BV1HQTs6FEos-p3')], video('BV1HQTs6FEos-p2'));
  assert.deepEqual(ids(lower), ['BV1yZ421M7NR', 'BV1HQTs6FEos-p2', 'BV1HQTs6FEos-p3']);

  // Re-adding a part replaces it in place rather than duplicating it.
  assert.deepEqual(ids(placeVideo(added, video('BV1HQTs6FEos-p2'))), ids(added));
});
