import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoId, placeVideo } from '../src/youtube.js';

const found = (guid, pubDate, channel = 'Mandarin Corner', channelId = 'UC2fAiRQHRQT9aj9P_ijYeow') => ({
  channel,
  channelId,
  video: { title: guid, guid, link: `https://www.youtube.com/watch?v=${guid}`, pubDate, duration: 1, m4a: `${guid}.m4a` },
});

test('a watch, short, embed or live link and a bare id all name the video', () => {
  for (const link of [
    'https://www.youtube.com/watch?v=G2oPClnoJpg',
    'https://www.youtube.com/watch?app=desktop&v=G2oPClnoJpg&t=217s&list=PL123',
    'https://youtu.be/G2oPClnoJpg?si=abc',
    'https://m.youtube.com/shorts/G2oPClnoJpg',
    'https://www.youtube.com/embed/G2oPClnoJpg',
    'https://www.youtube.com/live/G2oPClnoJpg?feature=share',
    'G2oPClnoJpg',
  ]) assert.equal(parseVideoId(link), 'G2oPClnoJpg', link);
  assert.throws(() => parseVideoId('https://www.youtube.com/@MandarinCorner'), /mã video/);
  assert.throws(() => parseVideoId('https://www.youtube.com/watch?v=G2oPClnoJpgX'), /mã video/);
});

test("a channel's first video names the channel; its id is the prefix and the upload date", () => {
  const { channels, video } = placeVideo([], found('G2oPClnoJpg', '2020-09-14'));
  assert.equal(video.id, 'MC20200914');
  assert.deepEqual(channels.map(({ prefix, title, videos }) => ({ prefix, title, ids: videos.map((v) => v.id) })),
    [{ prefix: 'MC', title: 'Mandarin Corner', ids: ['MC20200914'] }]);
});

test("a later video joins its channel newest first; one the same day is -2; re-adding replaces it", () => {
  let { channels } = placeVideo([], found('G2oPClnoJpg', '2020-09-14'));
  ({ channels } = placeVideo(channels, found('aaaaaaaaaaa', '2021-01-02')));
  const same = placeVideo(channels, found('bbbbbbbbbbb', '2020-09-14'));
  assert.equal(same.video.id, 'MC20200914-2');
  assert.deepEqual(same.channels[0].videos.map((v) => v.id), ['MC20210102', 'MC20200914', 'MC20200914-2']);

  const again = placeVideo(same.channels, found('G2oPClnoJpg', '2020-09-14'));
  assert.equal(again.video.id, 'MC20200914');
  assert.equal(again.channels[0].videos.length, 3);
});

test("the prefix is checked against the podcasts' and kept once the channel has one", () => {
  const shows = [{ prefix: 'MC', title: 'Some Show' }];
  assert.throws(() => placeVideo([], found('G2oPClnoJpg', '2020-09-14'), { shows }), /MC đã dùng cho "Some Show"/);
  assert.throws(() => placeVideo([], found('G2oPClnoJpg', '2020-09-14', '中文频道', 'UCzh')), /prefix 2–4 chữ cái/);

  const { channels, video } = placeVideo([], found('G2oPClnoJpg', '2020-09-14'), { prefix: 'mco', shows });
  assert.equal(video.id, 'MCO20200914');
  // A later video keeps the channel's prefix whatever is asked.
  assert.equal(placeVideo(channels, found('aaaaaaaaaaa', '2021-01-02'), { prefix: 'XY' }).video.id, 'MCO20210102');
  // Another channel cannot take it.
  assert.throws(() => placeVideo(channels, found('ccccccccccc', '2021-01-02', 'Other', 'UCother'), { prefix: 'MCO' }), /MCO đã dùng cho "Mandarin Corner"/);
});
