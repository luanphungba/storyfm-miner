// @ts-check
// Bilibili videos as listening episodes. Two things differ from 故事FM and shape this module:
//
// - Bilibili turns away scripted requests with 412 "风控" — curl and yt-dlp alike, cookies or not —
//   but serves a real Chrome. So the video's metadata and audio link are read from inside a page
//   that the installed Chrome loads, driven over the DevTools protocol with Node's own WebSocket,
//   which keeps this project free of dependencies.
// - Its audio links expire within hours and demand a bilibili.com Referer, so neither AssemblyAI
//   nor the player can stream them. The audio is downloaded once into data/audio/ (not in git) and
//   published as the static assets of a Cloudflare Worker (what Pages became: free, 25 MiB a file,
//   asset requests not billed); that stable URL is the episode's audio from then on.
//
// data/bilibili.json is the catalogue of videos added, the counterpart of 故事FM's feed snapshot.

import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { paths } from './paths.js';
import { publishAudio, assertFits } from './cdn.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** A BV id, and the part of a multi-part video when the input names one (`?p=2` or `-p2`). */
const VIDEO = /(BV[0-9A-Za-z]{10})(?:-p(\d+))?/;

/**
 * @typedef {object} Video
 * @property {string} id        The episode id: the BV id, with `-p<n>` for a multi-part video's later parts.
 * @property {string} title
 * @property {string} owner     The uploader's name.
 * @property {string} pubDate   ISO date.
 * @property {number} duration  Seconds.
 * @property {string} m4a       The published audio.
 */

/**
 * Accepts a video link (with any tracking query), a bare BV id or an episode id. Each part of a
 * multi-part video (分P) has audio of its own, so it is an episode of its own: part 1 keeps the bare
 * BV id, as a link without `?p=` opens it; part n is `<bvid>-p<n>`.
 * @param {string} input
 * @returns {{ bvid: string, page: number, id: string }}
 */
export function parseVideo(input) {
  const match = input.match(VIDEO);
  if (!match) throw new Error(`Không thấy mã BV trong "${input}".`);
  const page = Number(input.match(/[?&]p=(\d+)/)?.[1] ?? match[2] ?? 1);
  if (page < 1) throw new Error(`Phần ${page} không có trong "${input}".`);
  return { bvid: match[1], page, id: page > 1 ? `${match[1]}-p${page}` : match[1] };
}

/** The video's page on Bilibili, opened at the part this episode is. */
export function videoLink(/** @type {string} */ id) {
  const { bvid, page } = parseVideo(id);
  return `https://www.bilibili.com/video/${bvid}/${page > 1 ? `?p=${page}` : ''}`;
}

/**
 * The catalogue with `video` in it: a new video first, and a part of a video already there beside
 * its other parts, in part order, so the list reads P1, P2, … one under the other.
 * @param {Video[]} videos
 * @param {Video} video
 */
export function placeVideo(videos, video) {
  const rest = videos.filter((known) => known.id !== video.id);
  const { bvid, page } = parseVideo(video.id);
  const parts = rest.map((known, at) => ({ at, ...parseVideo(known.id) })).filter((known) => known.bvid === bvid);
  const before = parts.filter((known) => known.page < page).at(-1);
  const at = before ? before.at + 1 : (parts.find((known) => known.page > page)?.at ?? 0);
  return rest.toSpliced(at, 0, video);
}

/** @returns {Promise<Video[]>} */
export async function loadVideos() {
  if (!existsSync(paths.bilibili)) return [];
  return JSON.parse(await readFile(paths.bilibili, 'utf8')).videos;
}

/**
 * Videos in the shape the build takes an episode in; `guid` is the episode id, since it never
 * changes. A later part links to its own part, which the player then opens on Bilibili.
 */
export async function loadBilibiliEpisodes() {
  return (await loadVideos()).map((video) => ({
    ...video,
    guid: video.id,
    source: 'bilibili',
    ...(parseVideo(video.id).page > 1 && { link: videoLink(video.id) }),
  }));
}

/**
 * Fetches the audio, publishes it and records the video, so `buildEpisode` can take it from there.
 * @param {string} input  A link, a BV id or an episode id.
 * @returns {Promise<Video>}
 */
export async function importVideo(input) {
  const { bvid, page, id } = parseVideo(input);
  const known = (await loadVideos()).find((video) => video.id === id);
  if (known) return known;

  console.log(`${id} · mở trang bằng Chrome…`);
  const found = await readVideoPage(bvid, page);
  console.log(`  ${found.title} · ${found.owner} · ${found.duration}s`);

  const file = paths.audio(id);
  await downloadAudio(found.audioUrl, file);
  console.log(`  đã tải audio → data/audio/${id}.m4a`);

  const m4a = await publishAudio(id);

  const video = { id, title: found.title, owner: found.owner, pubDate: found.pubDate, duration: found.duration, m4a };
  await saveVideo(video);
  return video;
}

async function saveVideo(/** @type {Video} */ video) {
  const videos = placeVideo(await loadVideos(), video);
  await mkdir(dirname(paths.bilibili), { recursive: true });
  await writeFile(paths.bilibili, `${JSON.stringify({ videos }, null, 2)}\n`);
}

/**
 * Reads one part of a video: a multi-part video's title names the part, and its duration and audio
 * are that part's alone — the video's own duration sums every part.
 * @param {string} bvid
 * @param {number} page  1-based, as Bilibili's `?p=` counts.
 * @returns {Promise<{ title: string, owner: string, pubDate: string, duration: number, audioUrl: string }>}
 */
async function readVideoPage(bvid, page) {
  return withChrome(async (send) => {
    const { userAgent } = await send('Browser.getVersion');
    // Headless Chrome names itself in its user agent, which is exactly what 风控 looks for.
    await send('Network.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome') });
    await send('Page.navigate', { url: `https://www.bilibili.com/video/${bvid}/` });

    // The first response is a small script-only page that sets a fingerprint cookie and reloads;
    // the video's data only exists on the page after that, so wait for the data, not a load event.
    for (let waited = 0; waited < 30_000; waited += 500) {
      const { result } = await send('Runtime.evaluate', { expression: '!!window.__INITIAL_STATE__?.videoData', returnByValue: true });
      if (result.value) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Runs inside the page, so the request carries the cookies Bilibili just set for it.
    const expression = `(async () => {
      const v = window.__INITIAL_STATE__?.videoData;
      if (!v) return { error: document.title || location.href };
      const pages = v.pages.map((p) => ({ part: p.part, duration: p.duration }));
      const part = v.pages[${page - 1}];
      if (!part) return { title: v.title, pages };
      const play = await (await fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=' + v.bvid + '&cid=' + part.cid + '&fnval=16', { credentials: 'include' })).json();
      const audio = (play.data?.dash?.audio ?? []).sort((a, b) => a.bandwidth - b.bandwidth)[0];
      return { title: v.title, owner: v.owner.name, pubdate: v.pubdate, pages, audioUrl: audio?.baseUrl, playError: play.message };
    })()`;
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`Đọc trang Bilibili lỗi: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);

    const video = result.value;
    if ('error' in video) throw new Error(`Trang ${bvid} không có dữ liệu video (tiêu đề: "${video.error}") — có thể bị 风控 hoặc video đã xoá.`);
    /** @type {{ part: string, duration: number }[]} */
    const pages = video.pages;
    if (pages.length > 1) {
      console.log(`  Video có ${pages.length} phần — mỗi phần một tập: storyfm bili ${bvid}-p<số phần>`);
      pages.forEach((part, at) => console.log(`  ${at + 1 === page ? '→' : ' '} P${at + 1} ${part.duration}s ${part.part}`));
    }
    if (page > pages.length) throw new Error(`${bvid} chỉ có ${pages.length} phần, không có P${page}.`);
    if (!video.audioUrl) throw new Error(`Không lấy được link audio cho ${bvid} P${page}: ${video.playError}`);

    const part = pages[page - 1];
    return {
      title: pages.length > 1 ? `${video.title} P${page} ${part.part}` : video.title,
      owner: video.owner,
      pubDate: new Date(video.pubdate * 1000).toISOString().slice(0, 10),
      duration: part.duration,
      audioUrl: video.audioUrl,
    };
  });
}

/**
 * Starts the installed Chrome headless with a throwaway profile, hands `task` a DevTools session on
 * its first tab, and always shuts Chrome down after.
 * @template T
 * @param {(send: (method: string, params?: object) => Promise<any>) => Promise<T>} task
 * @returns {Promise<T>}
 */
async function withChrome(task) {
  if (!existsSync(CHROME)) throw new Error(`Không thấy Chrome ở ${CHROME}.`);
  const profile = await mkdtemp(join(tmpdir(), 'storyfm-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    const port = await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error('Chrome không mở cổng DevTools sau 20 giây.')), 20_000);
      chrome.stderr.on('data', (chunk) => {
        log += chunk;
        const match = log.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome thoát (${code}).`)); });
    });

    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const tab = targets.find((/** @type {any} */ target) => target.type === 'page');
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

    let nextId = 0;
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    const pending = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id !== undefined) {
        const call = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) call?.reject(new Error(`${message.error.message}`));
        else call?.resolve(message.result);
      }
    };

    const send = (/** @type {string} */ method, /** @type {object} */ params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });

    try {
      return await task(send);
    } finally {
      socket.close();
    }
  } finally {
    chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Bilibili serves DASH audio (.m4s). A remux with no re-encode turns it into a plain .m4a, with the
 * index up front so the player can seek before the whole file has arrived.
 */
async function downloadAudio(/** @type {string} */ url, /** @type {string} */ file) {
  const bytes = await fetchAudio(url);

  await mkdir(dirname(file), { recursive: true });
  const dash = `${file}.m4s`;
  await writeFile(dash, bytes);
  try {
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', '-i', dash, '-c', 'copy', '-movflags', '+faststart', `${file}.tmp.m4a`]);
    await rename(`${file}.tmp.m4a`, file);
  } finally {
    await rm(dash, { force: true });
  }

  await assertFits(file);
}

/**
 * Bilibili's CDN now and then drops a download part-way — fetch reports "terminated", two parts in
 * seven of BV1HQTs6FEos. The link stays good for hours, so the same request is simply made again.
 */
async function fetchAudio(/** @type {string} */ url, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`Tải audio lỗi ${response.status}.`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === attempts) throw error;
      console.log(`  tải audio bị ngắt (${/** @type {Error} */ (error).message}), thử lại…`);
    }
  }
}
