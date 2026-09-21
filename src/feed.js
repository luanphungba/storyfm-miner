// @ts-check
// The RSS feed is the only complete index of 故事FM. Each episode's audio URL is an opaque generated
// token — it cannot be derived from the episode number — so the feed is snapshotted to disk and
// treated as the source of truth. Every other module reads episodes from that snapshot, never from
// the network.
//
// Parsing uses targeted regexes instead of an XML library. The feed's shape is fixed and verified
// against all 992 items, and pulling in a parser would be this project's only dependency.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from './paths.js';

const FEED_URL = 'https://feeds.storyfm.cn/storyfm.xml';

const ITEM = /<item>([\s\S]*?)<\/item>/g;
const TITLE = /<title>([\s\S]*?)<\/title>/;
const GUID = /<wavpub:guid>([^<]+)<\/wavpub:guid>/;
const ENCLOSURE = /<enclosure\s[^>]*url="([^"]+)"[^>]*length="(\d+)"/;
const PUB_DATE = /<pubDate>([^<]+)<\/pubDate>/;
const DURATION = /<itunes:duration>(\d+)<\/itunes:duration>/;

/**
 * @typedef {object} Episode
 * @property {string} id        Stable key used for filenames and URLs, e.g. "E910".
 * @property {string} title
 * @property {string} guid
 * @property {string} mp3       Audio URL from the feed's <enclosure>.
 * @property {number} bytes
 * @property {string} pubDate   ISO date, "2026-09-17".
 * @property {number} duration  Seconds.
 */

const stripCdata = (/** @type {string} */ value) =>
  value.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();

/**
 * 897 of the 992 titles open with the episode number ("E910.我在菲律宾被关押的 41 天"). The other 95 are
 * specials and side series such as 「最酷的朋友」; those key off the publication date, which reads far
 * better in a filename or a URL than a guid does.
 * @returns {string}
 */
export function episodeId(/** @type {string} */ title, /** @type {string} */ pubDate) {
  const numbered = title.match(/^E(\d+)/);
  return numbered ? `E${numbered[1]}` : pubDate.replace(/-/g, '');
}

/**
 * Uniqueness belongs to the list, not to a single item, so ids are finalised here. Six dates carry
 * two episodes each; the second one seen takes a counter. Feed order is newest-first and past dates
 * never gain episodes, so the same episode keeps the same id across re-syncs.
 * @param {Episode[]} episodes
 */
function withUniqueIds(episodes) {
  const used = new Set();

  return episodes.map((episode) => {
    let id = episode.id;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${episode.id}-${suffix}`;
    used.add(id);
    return { ...episode, id };
  });
}

/**
 * @param {string} xml
 * @returns {Episode[]} Newest first, matching the feed's own order.
 */
export function parseFeed(xml) {
  const episodes = [];

  for (const [, item] of xml.matchAll(ITEM)) {
    const title = stripCdata(item.match(TITLE)?.[1] ?? '');
    const guid = item.match(GUID)?.[1] ?? '';
    const enclosure = item.match(ENCLOSURE);
    if (!title || !guid || !enclosure) continue;

    const parsedDate = new Date(item.match(PUB_DATE)?.[1] ?? '');
    if (Number.isNaN(parsedDate.valueOf())) continue;
    const pubDate = parsedDate.toISOString().slice(0, 10);

    episodes.push({
      id: episodeId(title, pubDate),
      title,
      guid,
      mp3: enclosure[1],
      bytes: Number(enclosure[2]),
      pubDate,
      duration: Number(item.match(DURATION)?.[1] ?? 0),
    });
  }

  return withUniqueIds(episodes);
}

/** Downloads the feed and replaces the snapshot. */
export async function syncFeed() {
  const response = await fetch(FEED_URL);
  if (!response.ok) {
    throw new Error(`Không tải được RSS (${response.status}) từ ${FEED_URL}`);
  }
  const xml = await response.text();
  await mkdir(dirname(paths.feed), { recursive: true });
  await writeFile(paths.feed, xml);
  return parseFeed(xml);
}

/** @returns {Promise<Episode[]>} */
export async function loadFeed() {
  try {
    return parseFeed(await readFile(paths.feed, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw new Error('Chưa có data/feed.xml. Chạy `storyfm sync` trước.');
    }
    throw error;
  }
}

/**
 * @param {Episode[]} episodes
 * @param {string} id
 * @returns {Episode}
 */
export function findEpisode(episodes, id) {
  const wanted = id.toUpperCase();
  const episode = episodes.find((candidate) => candidate.id.toUpperCase() === wanted);
  if (!episode) {
    throw new Error(`Không tìm thấy tập "${id}". Chạy \`storyfm list\` để xem danh sách.`);
  }
  return episode;
}
