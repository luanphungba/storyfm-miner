#!/usr/bin/env node
// @ts-check
// CLI front end. Commands stay thin — parse arguments, call into src/, print. Anything worth testing
// lives in src/ as a pure function instead, so the CLI itself never needs a test harness.

import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadFeed, syncFeed, findEpisode } from '../src/feed.js';
import { paths } from '../src/paths.js';

const DEFAULT_LIST_LIMIT = 20;

// Node reads .env natively; a missing file is normal for `sync` and `list`, which need no keys.
try {
  process.loadEnvFile(join(paths.root, '.env'));
} catch {
  // Commands that need a key say so themselves, with a more useful message than this would be.
}

const formatDuration = (/** @type {number} */ seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

async function sync() {
  const episodes = await syncFeed();
  console.log(`Đã lưu data/feed.xml — ${episodes.length} tập.`);
  const { loadShows, syncShow } = await import('../src/podcasts.js');
  for (const { feed } of await loadShows()) {
    const show = await syncShow(feed);
    console.log(`Đã cập nhật ${show.title} — ${show.episodes.length} tập.`);
  }
  const { rebuildIndex } = await import('../src/build.js');
  const indexed = await rebuildIndex();
  console.log(`${indexed.length} tập đã có transcript.`);
}

async function list(/** @type {string[]} */ argv) {
  const { values } = parseArgs({
    args: argv,
    options: { limit: { type: 'string' } },
  });
  const limit = Number(values.limit ?? DEFAULT_LIST_LIMIT);
  const episodes = await loadFeed();

  for (const episode of episodes.slice(0, limit)) {
    const mark = existsSync(paths.episode(episode.id)) ? '✓' : ' ';
    const meta = `${episode.pubDate}  ${formatDuration(episode.duration).padStart(6)}`;
    console.log(`${mark} ${episode.id.padEnd(10)} ${meta}  ${episode.title}`);
  }
  console.log(`\n${episodes.length} tập trong feed. ✓ = đã có transcript.`);
}

async function add(/** @type {string[]} */ argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      force: { type: 'boolean', default: false },
      resegment: { type: 'boolean', default: false },
      narrator: { type: 'string' },
    },
  });
  const [id] = positionals;
  if (!id) throw new Error('Thiếu mã tập. Ví dụ: storyfm add E910');

  const { buildEpisode, loadEpisodes } = await import('../src/build.js');
  const episode = await hosted(findEpisode(await loadEpisodes(), id));
  await buildEpisode(episode, {
    force: values.force,
    resegment: values.resegment,
    narrator: values.narrator,
  });
}

async function bili(/** @type {string[]} */ argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { force: { type: 'boolean', default: false }, narrator: { type: 'string' } },
  });
  const [link] = positionals;
  if (!link) throw new Error('Thiếu link. Ví dụ: storyfm bili https://www.bilibili.com/video/BV1f9t86REx8/');

  const { importVideo, loadBilibiliEpisodes } = await import('../src/bilibili.js');
  const { buildEpisode } = await import('../src/build.js');
  const video = await importVideo(link);
  const episode = findEpisode(await loadBilibiliEpisodes(), video.id);
  await buildEpisode(episode, { force: values.force, narrator: values.narrator });
}

async function podcast(/** @type {string[]} */ argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      prefix: { type: 'string' },
      limit: { type: 'string' },
      narrator: { type: 'string' },
    },
  });
  const [link] = positionals;
  if (!link) throw new Error('Thiếu link. Ví dụ: storyfm podcast https://open.spotify.com/show/42STZ89SIiroukDHp20GBp');

  const { resolveFeed, syncShow } = await import('../src/podcasts.js');
  const { feed, episodeTitle } = await resolveFeed(link);
  const show = await syncShow(feed, values.prefix);
  console.log(`${show.title} · ${show.episodes.length} tập · mã ${show.prefix}… · ${feed}`);

  if (!episodeTitle) {
    for (const episode of show.episodes.slice(0, Number(values.limit ?? DEFAULT_LIST_LIMIT))) {
      const mark = existsSync(paths.episode(episode.id)) ? '✓' : ' ';
      console.log(`${mark} ${episode.id.padEnd(12)} ${episode.pubDate}  ${formatDuration(episode.duration).padStart(6)}  ${episode.title}`);
    }
    console.log(`
Thêm một tập: storyfm add ${show.episodes[0]?.id ?? `${show.prefix}1`}`);
    return;
  }

  const found = show.episodes.find((episode) => episode.title.trim() === episodeTitle.trim());
  if (!found) throw new Error(`Không thấy tập "${episodeTitle}" trong RSS của ${show.title}. Xem danh sách: storyfm podcast ${show.feed}`);
  const { buildEpisode, loadEpisodes } = await import('../src/build.js');
  await buildEpisode(await hosted(findEpisode(await loadEpisodes(), found.id)), { narrator: values.narrator });
}

/**
 * A podcast episode is played from our own copy (see src/podcasts.js), hosted before anything is
 * built — also on --resegment, which is how an episode added before that switches over.
 * @template T
 * @param {T & { source?: string, m4a?: string }} episode
 * @returns {Promise<T>}
 */
async function hosted(episode) {
  if (episode.source !== 'podcast' || episode.m4a) return episode;
  const { hostAudio } = await import('../src/podcasts.js');
  return { ...episode, m4a: await hostAudio(/** @type {any} */ (episode)) };
}

/** Rebuilds the index's topics from data/topics.json, and names the episodes in none. */
async function topics() {
  const { rebuildIndex } = await import('../src/build.js');
  const entries = await rebuildIndex();
  /** @type {import('../src/topics.js').IndexedTopic[]} */
  const indexed = JSON.parse(await readFile(paths.index, 'utf8')).topics;
  for (const topic of indexed) {
    const planned = topic.planned.length ? ` · chưa thêm ${topic.planned.map((episode) => episode.id).join(' ')}` : '';
    console.log(`${topic.vi} (${topic.id}) · ${topic.episodes.join(' ')}${planned}`);
  }
  const tagged = new Set(indexed.flatMap((topic) => topic.episodes));
  const untagged = entries.filter((entry) => !tagged.has(entry.id));
  if (untagged.length) console.log(`\nChưa có chủ đề: ${untagged.map((entry) => entry.id).join(' ')}`);
}

async function models() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('Thiếu ASSEMBLYAI_API_KEY trong .env.');

  const { models: available, inUse } = await (await import('../src/asr.js')).listModels(apiKey);
  for (const name of available) {
    console.log(`${name === inUse ? '→' : ' '} ${name}`);
  }
  if (!available.includes(inUse)) {
    console.log(`\n⚠ Đang dùng "${inUse}" nhưng API không còn nhận. Sửa SPEECH_MODEL trong src/asr.js.`);
  }
}

const COMMANDS = { sync, list, add, bili, podcast, topics, models };

const USAGE = `storyfm — transcript cho 故事FM

  storyfm sync                  tải lại RSS của 故事FM và các podcast đã thêm
  storyfm list [--limit 20]     liệt kê tập (✓ = đã có transcript)
  storyfm add E910              transcribe một tập
    --force                     transcribe lại dù đã có (tốn tiền)
    --resegment                 dựng lại từ data/raw/ + corrections + cuts, không gọi API
    --narrator B                chỉ định speaker nào là người dẫn

  storyfm bili <link|BV…>       tải audio Bilibili, đẩy lên Pages, transcribe
                                video nhiều phần: mỗi phần một tập, BV…-p2 (hoặc link có ?p=2)
                                (sau đó dùng add BV… --resegment như tập thường)

  storyfm podcast <link>        thêm một podcast khác (link Spotify / Apple / Firstory / RSS);
                                audio được nén lại và đẩy lên Cloudflare trước khi transcribe
    --prefix CC                 mã đầu cho tập của show mới (mặc định: chữ đầu tên Latin)
                                link show → liệt kê tập; link một tập → transcribe tập đó
                                (sau đó dùng add CC119 như tập thường)

  storyfm topics                dựng lại chủ đề trong index từ data/topics.json, kể tập chưa có chủ đề

  storyfm models                liệt kê model ASR, → là cái đang dùng
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const handler = command && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;

  if (!handler) {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }
  await handler(rest);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exit(1);
});
