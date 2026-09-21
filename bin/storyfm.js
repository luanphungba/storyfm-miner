#!/usr/bin/env node
// @ts-check
// CLI front end. Commands stay thin — parse arguments, call into src/, print. Anything worth testing
// lives in src/ as a pure function instead, so the CLI itself never needs a test harness.

import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
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
  const { rebuildIndex } = await import('../src/build.js');
  const indexed = await rebuildIndex();
  console.log(`Đã lưu data/feed.xml — ${episodes.length} tập, ${indexed.length} tập đã có transcript.`);
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

  const episode = findEpisode(await loadFeed(), id);
  const { buildEpisode } = await import('../src/build.js');
  await buildEpisode(episode, {
    force: values.force,
    resegment: values.resegment,
    narrator: values.narrator,
  });
}

const COMMANDS = { sync, list, add };

const USAGE = `storyfm — transcript cho 故事FM

  storyfm sync                  tải lại RSS về data/feed.xml
  storyfm list [--limit 20]     liệt kê tập (✓ = đã có transcript)
  storyfm add E910              transcribe một tập
    --force                     transcribe lại dù đã có (tốn tiền)
    --resegment                 cắt lại câu từ data/raw/, không gọi API (miễn phí)
    --narrator B                chỉ định speaker nào là người dẫn
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
