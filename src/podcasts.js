// @ts-check
// Other podcasts as listening episodes, next to 故事FM. Any show with an RSS feed works the same way:
// the feed's <enclosure> is a plain mp3.
//
// That mp3 is not what the player plays, though: each episode is re-encoded and hosted on the
// storyfm-audio Worker like Bilibili's audio (hostAudio), and AssemblyAI transcribes the same copy.
// Firstory's mp3s carry a VBR "Xing" header, and Chrome seeks one through its coarse table of 100
// points: measured on CC2, a seek landed anywhere from 3.7s early to 1.4s late while currentTime
// reported the time asked for, so every tapped line, loop and Anki card played the wrong words.
// 故事FM's mp3s carry a CBR "Info" header and seek to within 15ms, as does an MP4 copy, whose sample
// table leaves nothing to estimate.
//
// The user pastes whatever link their podcast app shares — Spotify, Apple Podcasts, Firstory, or the
// RSS itself — and resolveFeed turns it into the feed. Spotify hides a show's feed, so its show name is
// looked up in Apple's podcast directory, which lists the feed URL.
//
// data/podcasts.json holds each show added and a parsed snapshot of its episodes — the counterpart of
// 故事FM's data/feed.xml, kept as JSON because the raw feeds carry the full show notes (2.5 MB for
// Convo Chinese) and none of that is used. Episode ids are the show's prefix plus the number in the
// title ("Episode 119 | …" → CC119); an unnumbered one falls back to the date, as in 故事FM.

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { paths } from './paths.js';
import { publishAudio, assertFits } from './cdn.js';

/** Spotify answers a full browser user agent with an empty web-player shell; this gets the real page. */
const UA = 'Mozilla/5.0';

const ITEM = /<item>([\s\S]*?)<\/item>/g;
const TITLE = /<title>([\s\S]*?)<\/title>/;
const LINK = /<link>([\s\S]*?)<\/link>/;
const GUID = /<guid[^>]*>([\s\S]*?)<\/guid>/;
const ENCLOSURE = /<enclosure\s[^>]*url="([^"]+)"/;
const PUB_DATE = /<pubDate>([^<]+)<\/pubDate>/;
const DURATION = /<itunes:duration>([\d:]+)<\/itunes:duration>/;

/**
 * @typedef {object} Show
 * @property {string} prefix    Starts every episode id of the show, e.g. "CC".
 * @property {string} title
 * @property {string} feed      RSS URL.
 * @property {PodcastEpisode[]} episodes  Newest first, as of the last sync.
 */

/**
 * @typedef {object} PodcastEpisode
 * @property {string} id
 * @property {string} title
 * @property {string} guid
 * @property {string} mp3      As the feed has it.
 * @property {string} [m4a]     Our copy on the storyfm-audio Worker, once hosted: what the player plays.
 * @property {string} [link]    The episode's own page, where its show notes are.
 * @property {string} pubDate   ISO date.
 * @property {number} duration  Seconds.
 */

const decode = (/** @type {string} */ value) =>
  value
    .replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();

/** itunes:duration is either seconds or [h:]mm:ss. */
const seconds = (/** @type {string} */ value) => value.split(':').reduce((total, part) => total * 60 + Number(part), 0);

/**
 * @param {string} xml
 * @param {string} prefix
 * @returns {{ title: string, episodes: PodcastEpisode[] }}
 */
export function parsePodcastFeed(xml, prefix) {
  const title = decode(xml.split('<item>')[0].match(TITLE)?.[1] ?? '');
  const used = new Set();
  const episodes = [];

  for (const [, item] of xml.matchAll(ITEM)) {
    const itemTitle = decode(item.match(TITLE)?.[1] ?? '');
    const mp3 = item.match(ENCLOSURE)?.[1];
    const date = new Date(item.match(PUB_DATE)?.[1] ?? '');
    if (!itemTitle || !mp3 || Number.isNaN(date.valueOf())) continue;
    const pubDate = date.toISOString().slice(0, 10);

    const number = itemTitle.match(/^episode\s*(\d+)/i)?.[1];
    const base = `${prefix}${number ?? pubDate.replace(/-/g, '')}`;
    let id = base;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
    used.add(id);

    const link = item.match(LINK)?.[1];
    episodes.push({
      id,
      title: itemTitle,
      guid: decode(item.match(GUID)?.[1] ?? '') || mp3,
      mp3: decode(mp3),
      ...(link && { link: decode(link) }),
      pubDate,
      duration: seconds(item.match(DURATION)?.[1] ?? '0'),
    });
  }
  return { title, episodes };
}

/**
 * The show's feed, and for a link to one episode, that episode's title.
 * @param {string} link
 * @returns {Promise<{ feed: string, episodeTitle?: string }>}
 */
export async function resolveFeed(link) {
  const url = new URL(link);

  if (url.hostname.endsWith('spotify.com')) {
    const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
    const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '').replace(/\s*\|\s*Podcast on Spotify$/, '');
    if (!title) throw new Error(`Spotify không trả về tên show cho ${link}.`);
    if (url.pathname.startsWith('/show/')) return { feed: await feedFromApple(title) };
    // An episode page is titled "<episode> - <show>"; the show is what follows the last " - ".
    const cut = title.lastIndexOf(' - ');
    return { feed: await feedFromApple(title.slice(cut + 3)), episodeTitle: title.slice(0, cut) };
  }

  if (url.hostname.endsWith('podcasts.apple.com')) {
    const id = url.pathname.match(/id(\d+)/)?.[1];
    if (!id) throw new Error(`Không thấy mã show trong ${link}.`);
    const found = (await itunes(`lookup?id=${id}`))[0];
    if (!found?.feedUrl) throw new Error(`Apple không có RSS cho show ${id}.`);
    const episode = url.searchParams.get('i');
    const episodeTitle = episode ? (await itunes(`lookup?id=${episode}&entity=podcastEpisode`)).find((r) => r.trackId === Number(episode))?.trackName : undefined;
    return { feed: found.feedUrl, ...(episodeTitle && { episodeTitle }) };
  }

  const firstory = url.pathname.match(/\/user\/([a-z0-9]+)/);
  if (url.hostname.endsWith('firstory.fm') && firstory) return { feed: `https://feed.firstory.me/rss/user/${firstory[1]}` };

  return { feed: link };
}

/** @returns {Promise<any[]>} */
async function itunes(/** @type {string} */ query) {
  const response = await fetch(`https://itunes.apple.com/${query}`);
  if (!response.ok) throw new Error(`Apple Podcasts lỗi ${response.status}.`);
  return (await response.json()).results ?? [];
}

async function feedFromApple(/** @type {string} */ show) {
  const results = await itunes(`search?media=podcast&term=${encodeURIComponent(show)}`);
  const found = results.find((result) => result.collectionName === show && result.feedUrl);
  if (!found) {
    const near = results.slice(0, 3).map((result) => `"${result.collectionName}"`).join(', ');
    throw new Error(`Apple Podcasts không có show tên đúng "${show}"${near ? ` (gần nhất: ${near})` : ''}. Dán link RSS trực tiếp.`);
  }
  return found.feedUrl;
}

/** "瞎扯学中文 Convo Chinese" → "CC": the initials of the Latin words. */
export function defaultPrefix(/** @type {string} */ title) {
  return (title.match(/\b[A-Za-z]/g) ?? []).join('').toUpperCase().slice(0, 4);
}

/** @returns {Promise<Show[]>} */
export async function loadShows() {
  if (!existsSync(paths.podcasts)) return [];
  return JSON.parse(await readFile(paths.podcasts, 'utf8')).shows;
}

async function saveShows(/** @type {Show[]} */ shows) {
  await mkdir(dirname(paths.podcasts), { recursive: true });
  await writeFile(paths.podcasts, `${JSON.stringify({ shows }, null, 2)}\n`);
}

/**
 * Downloads a show's feed and replaces its snapshot, adding the show if it is new.
 * @param {string} feed
 * @param {string} [prefix]  Required only for a new show whose title has no Latin initials.
 * @returns {Promise<Show>}
 */
export async function syncShow(feed, prefix) {
  const shows = await loadShows();
  const known = shows.find((show) => show.feed === feed);
  const response = await fetch(feed, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`Không tải được RSS (${response.status}) từ ${feed}`);
  const xml = await response.text();
  if (!/<rss[\s>]/.test(xml)) throw new Error(`${feed} không phải RSS.`);

  const chosen = (known?.prefix ?? prefix ?? defaultPrefix(parsePodcastFeed(xml, '').title)).toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(chosen) || chosen === 'BV' || chosen === 'E') {
    throw new Error(`Cần một prefix 2–4 chữ cái cho show này (khác E, BV): --prefix XX`);
  }
  const clash = shows.find((show) => show.prefix === chosen && show.feed !== feed);
  if (clash) throw new Error(`Prefix ${chosen} đã dùng cho "${clash.title}". Chọn prefix khác: --prefix XX`);

  const { title, episodes } = parsePodcastFeed(xml, chosen);
  const show = { prefix: chosen, title, feed, episodes: keepHosted(known?.episodes ?? [], episodes) };
  await saveShows([...shows.filter((other) => other.feed !== feed), show]);
  return show;
}

/** Every show's episodes in the shape the build takes; `owner` names the show on the page. */
export async function loadPodcastEpisodes() {
  return (await loadShows()).flatMap((show) =>
    show.episodes.map((episode) => ({ ...episode, source: 'podcast', owner: show.title })),
  );
}

/**
 * A fresh snapshot of the feed, with the copies already hosted carried over: the feed knows nothing
 * of them, and losing one would put the episode back on the mp3 that seeks wrong.
 * @param {PodcastEpisode[]} known
 * @param {PodcastEpisode[]} fresh
 */
export function keepHosted(known, fresh) {
  const hosted = new Map(known.filter((episode) => episode.m4a).map((episode) => [episode.guid, episode.m4a]));
  return fresh.map((episode) => (hosted.has(episode.guid) ? { ...episode, m4a: hosted.get(episode.guid) } : episode));
}

/**
 * Downloads the episode's mp3, re-encodes it into data/audio/<id>.m4a, publishes it and records the
 * URL in data/podcasts.json. Returns that URL.
 *
 * A remux that only dropped the Xing header would seek exactly too (the stream itself is CBR), but at
 * 128k stereo most episodes are over Cloudflare's 25 MiB. 64k mono AAC is plenty for two people
 * talking, and 15 MB for 30 minutes. The re-encode keeps the mp3's timeline — the transcript's timestamps —
 * to within 15ms, measured by seeking the copy in Chrome and matching what it played to the mp3.
 * @param {PodcastEpisode} episode
 */
export async function hostAudio(episode) {
  const file = paths.audio(episode.id);
  console.log(`${episode.id} · tải mp3 và nén thành data/audio/${episode.id}.m4a…`);
  const response = await fetch(episode.mp3, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`Tải audio lỗi ${response.status}.`);
  await mkdir(dirname(file), { recursive: true });
  const mp3 = `${file}.mp3`;
  await writeFile(mp3, Buffer.from(await response.arrayBuffer()));
  try {
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', '-i', mp3, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', `${file}.tmp.m4a`]);
    await rename(`${file}.tmp.m4a`, file);
  } finally {
    await rm(mp3, { force: true });
  }
  await assertFits(file);

  const m4a = await publishAudio(episode.id);
  const shows = await loadShows();
  for (const show of shows) {
    show.episodes = show.episodes.map((known) => (known.guid === episode.guid ? { ...known, m4a } : known));
  }
  await saveShows(shows);
  return m4a;
}
