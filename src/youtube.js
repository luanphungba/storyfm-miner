// @ts-check
// YouTube videos as podcast episodes. The user listens to them rather than watches, so only the audio
// is kept, and on the page a video is one more podcast: its channel is the show, its YouTube page the
// show notes. Two things shape this module:
//
// - YouTube changes what a scripted client has to do every few weeks and turns away a yt-dlp a few
//   months old (2025.10.14 got "The page needs to be reloaded" in October 2026), so yt-dlp runs at its
//   latest release through uvx, never from a copy installed once.
// - Its audio links expire within hours, so neither AssemblyAI nor the player can stream them. The
//   audio is downloaded once, re-encoded like a podcast's (compressAudio) into data/audio/ (not in git)
//   and published on the storyfm-audio Worker; that copy is the episode's audio from then on.
//
// data/youtube.json holds each channel added and the videos added from it — only those: a channel is
// not a show to list, most of its videos are not wanted. Ids are the channel's prefix plus the upload
// date, as for an unnumbered podcast episode (Mandarin Corner's of 2020-09-14 is MC20200914).

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { paths } from './paths.js';
import { compressAudio, publishAudio } from './cdn.js';
import { loadShows, checkPrefix, defaultPrefix } from './podcasts.js';

/**
 * @typedef {object} Channel
 * @property {string} prefix     Starts every episode id from the channel, e.g. "MC".
 * @property {string} title
 * @property {string} channelId  YouTube's own, UC…
 * @property {YoutubeVideo[]} videos  Newest first.
 */

/**
 * @typedef {object} YoutubeVideo
 * @property {string} id
 * @property {string} title
 * @property {string} guid      YouTube's 11-character video id.
 * @property {string} link      The video's page, where its description is.
 * @property {string} pubDate   ISO date of the upload.
 * @property {number} duration  Seconds.
 * @property {string} m4a       Our copy on the storyfm-audio Worker: what the player plays.
 */

/** What yt-dlp reads off a video's page. */
const FIELDS = '%(.{id,title,channel,channel_id,upload_date,duration})j';

/**
 * The video id in a watch, youtu.be, shorts, embed or live link, or a bare id.
 * @param {string} input
 */
export function parseVideoId(input) {
  const match = input.match(/(?:[?&]v=|youtu\.be\/|\/(?:shorts|embed|live)\/)([\w-]{11})(?![\w-])/) ?? input.match(/^([\w-]{11})$/);
  if (!match) throw new Error(`Không thấy mã video YouTube trong "${input}".`);
  return match[1];
}

export const videoLink = (/** @type {string} */ guid) => `https://www.youtube.com/watch?v=${guid}`;

/**
 * The catalogue with the video under its channel, and the video with its id. A channel seen for the
 * first time takes `prefix`, or the initials of its name, checked against the podcasts' prefixes; a
 * second video the channel uploaded the same day is `-2`.
 * @param {Channel[]} channels
 * @param {{ channel: string, channelId: string, video: Omit<YoutubeVideo, 'id'> }} found
 * @param {{ prefix?: string, shows?: { prefix: string, title: string }[] }} [options]
 * @returns {{ channels: Channel[], video: YoutubeVideo }}
 */
export function placeVideo(channels, { channel, channelId, video }, { prefix, shows = [] } = {}) {
  const known = channels.find((other) => other.channelId === channelId);
  const others = [...shows, ...channels.filter((other) => other !== known)];
  const chosen = known?.prefix ?? checkPrefix(prefix ?? defaultPrefix(channel), others);
  const videos = (known?.videos ?? []).filter((other) => other.guid !== video.guid);

  const base = `${chosen}${video.pubDate.replace(/-/g, '')}`;
  let id = base;
  for (let suffix = 2; videos.some((other) => other.id === id); suffix += 1) id = `${base}-${suffix}`;

  const placed = { id, ...video };
  const updated = {
    prefix: chosen,
    title: known?.title ?? channel,
    channelId,
    videos: [...videos, placed].sort((a, b) => b.pubDate.localeCompare(a.pubDate)),
  };
  return {
    channels: known ? channels.map((other) => (other === known ? updated : other)) : [...channels, updated],
    video: placed,
  };
}

/** @returns {Promise<Channel[]>} */
export async function loadChannels() {
  if (!existsSync(paths.youtube)) return [];
  return JSON.parse(await readFile(paths.youtube, 'utf8')).channels;
}

async function saveChannels(/** @type {Channel[]} */ channels) {
  await mkdir(dirname(paths.youtube), { recursive: true });
  await writeFile(paths.youtube, `${JSON.stringify({ channels }, null, 2)}\n`);
}

/** Every video added, in the shape the build takes a podcast episode in: the channel names the show. */
export async function loadYoutubeEpisodes() {
  return (await loadChannels()).flatMap((channel) =>
    channel.videos.map((video) => ({ ...video, source: /** @type {const} */ ('podcast'), owner: channel.title })),
  );
}

/**
 * Fetches the audio, publishes it and records the video, so `buildEpisode` can take it from there.
 * A video already added is returned as it is.
 * @param {string} input   A link or a video id.
 * @param {string} [prefix]  For a channel's first video only.
 * @returns {Promise<YoutubeVideo>}
 */
export async function importVideo(input, prefix) {
  const guid = parseVideoId(input);
  const channels = await loadChannels();
  const known = channels.flatMap((channel) => channel.videos).find((video) => video.guid === guid);
  if (known) return known;

  console.log(`${guid} · đọc trang YouTube…`);
  const { stdout } = await ytDlp(['--skip-download', '--print', FIELDS, videoLink(guid)]);
  const info = JSON.parse(stdout);
  const pubDate = `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6)}`;
  const found = {
    channel: info.channel,
    channelId: info.channel_id,
    video: { title: info.title, guid, link: videoLink(guid), pubDate, duration: Math.round(info.duration), m4a: '' },
  };
  // Placed once to name the audio file — checking the prefix before anything is downloaded — and
  // again with the URL the audio is published at.
  const options = { prefix, shows: await loadShows() };
  const { id } = placeVideo(channels, found, options).video;
  console.log(`  ${id} · ${info.title} · ${info.channel} · ${found.video.duration}s`);

  const file = paths.audio(id);
  await mkdir(dirname(file), { recursive: true });
  const download = await downloadAudio(guid, file.replace(/\.m4a$/, '.youtube.%(ext)s'));
  try {
    console.log(`  tải xong, nén thành data/audio/${id}.m4a…`);
    await compressAudio(download, file);
  } finally {
    await rm(download, { force: true });
  }

  const m4a = await publishAudio(id);
  const placed = placeVideo(channels, { ...found, video: { ...found.video, m4a } }, options);
  await saveChannels(placed.channels);
  return placed.video;
}

/**
 * YouTube's own AAC (itag 140) where there is one, saved as `template` says; returns the file. Its CDN
 * now and then answers 403 to a link it just handed out — once on MC20200914, then three downloads in
 * a row went through — so the download is simply asked for again.
 * @param {string} guid
 * @param {string} template
 */
async function downloadAudio(guid, template, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const { stdout } = await ytDlp(['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-progress', '-o', template, '--print', 'after_move:filepath', videoLink(guid)]);
      return stdout.trim();
    } catch (error) {
      if (attempt === attempts) throw error;
      const { message } = /** @type {Error} */ (error);
      console.log(`  tải audio lỗi (${message.match(/ERROR: (.*)/)?.[1] ?? message}), thử lại…`);
    }
  }
}

/** yt-dlp at its latest release; see the top of this file. */
function ytDlp(/** @type {string[]} */ args) {
  return promisify(execFile)('uvx', ['yt-dlp@latest', '--no-warnings', '--no-playlist', ...args], { maxBuffer: 16 * 1024 * 1024 });
}
