import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePodcastFeed, defaultPrefix, keepHosted } from '../src/podcasts.js';

const item = (title, date, duration = '120') => `<item><title><![CDATA[${title}]]></title>
<link>https://open.firstory.fm/story/x</link><guid isPermaLink="false">g-${title}</guid>
<pubDate>${date}</pubDate><enclosure url="https://cdn.example/a.mp3?v=1&amp;x=2" length="0" type="audio/mpeg"/>
<itunes:duration>${duration}</itunes:duration></item>`;

test('ids come from the number in the title, else the date', () => {
  const xml = `<rss><channel><title><![CDATA[瞎扯学中文 Convo Chinese]]></title>
${item('Episode 119 | 香港 香港！', 'Fri, 18 Sep 2026 05:02:06 GMT', '36:22')}
${item('Learner Talks E7 | 喝茶', 'Tue, 01 Jun 2021 10:00:00 GMT')}
${item('Learner Talks E6 | 上海', 'Tue, 01 Jun 2021 09:00:00 GMT')}
${item('EPISODE 1 | Trailer', 'Tue, 27 Apr 2021 20:51:29 GMT', '1:00:05')}
</channel></rss>`;
  const { title, episodes } = parsePodcastFeed(xml, 'CC');
  assert.equal(title, '瞎扯学中文 Convo Chinese');
  assert.deepEqual(episodes.map((e) => e.id), ['CC119', 'CC20210601', 'CC20210601-2', 'CC1']);
  assert.equal(episodes[0].duration, 36 * 60 + 22);
  assert.equal(episodes[3].duration, 3605);
  assert.equal(episodes[0].mp3, 'https://cdn.example/a.mp3?v=1&x=2');
});

test('the default prefix is the initials of the Latin words', () => {
  assert.equal(defaultPrefix('瞎扯学中文 Convo Chinese'), 'CC');
  assert.equal(defaultPrefix('故事FM'), 'F'); // too short: syncShow then asks for --prefix
});

test('a re-synced feed keeps the copies already hosted', () => {
  const ep = (guid, extra = {}) => ({ id: guid, title: guid, guid, mp3: `https://feed/${guid}.mp3`, pubDate: '2021-05-04', duration: 60, ...extra });
  const known = [ep('a', { m4a: 'https://cdn/a.m4a' }), ep('b')];
  const fresh = [ep('c'), ep('a', { title: 'renamed' }), ep('b')];
  assert.deepEqual(keepHosted(known, fresh), [
    ep('c'),
    ep('a', { title: 'renamed', m4a: 'https://cdn/a.m4a' }),
    ep('b'),
  ]);
});
