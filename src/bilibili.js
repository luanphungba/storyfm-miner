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

const BVID = /BV[0-9A-Za-z]{10}/;

/**
 * @typedef {object} Video
 * @property {string} id        The BV id, which is also the episode id.
 * @property {string} title
 * @property {string} owner     The uploader's name.
 * @property {string} pubDate   ISO date.
 * @property {number} duration  Seconds.
 * @property {string} m4a       The published audio.
 */

/** Accepts a video link (with any tracking query) or a bare BV id. */
export function parseBvid(/** @type {string} */ input) {
  const bvid = input.match(BVID)?.[0];
  if (!bvid) throw new Error(`Không thấy mã BV trong "${input}".`);
  return bvid;
}

/** @returns {Promise<Video[]>} */
export async function loadVideos() {
  if (!existsSync(paths.bilibili)) return [];
  return JSON.parse(await readFile(paths.bilibili, 'utf8')).videos;
}

/** Videos in the shape the build takes an episode in; `guid` is the BV id, since it never changes. */
export async function loadBilibiliEpisodes() {
  return (await loadVideos()).map((video) => ({ ...video, guid: video.id, source: 'bilibili' }));
}

/**
 * Fetches the audio, publishes it and records the video, so `buildEpisode` can take it from there.
 * @param {string} input  A link or a BV id.
 * @returns {Promise<Video>}
 */
export async function importVideo(input) {
  const bvid = parseBvid(input);
  const known = (await loadVideos()).find((video) => video.id === bvid);
  if (known) return known;

  console.log(`${bvid} · mở trang bằng Chrome…`);
  const page = await readVideoPage(bvid);
  console.log(`  ${page.title} · ${page.owner} · ${page.duration}s`);

  const file = paths.audio(bvid);
  await downloadAudio(page.audioUrl, file);
  console.log(`  đã tải audio → data/audio/${bvid}.m4a`);

  const m4a = await publishAudio(bvid);

  const video = { id: bvid, title: page.title, owner: page.owner, pubDate: page.pubDate, duration: page.duration, m4a };
  await saveVideo(video);
  return video;
}

async function saveVideo(/** @type {Video} */ video) {
  const videos = [video, ...(await loadVideos()).filter((known) => known.id !== video.id)];
  await mkdir(dirname(paths.bilibili), { recursive: true });
  await writeFile(paths.bilibili, `${JSON.stringify({ videos }, null, 2)}\n`);
}

/**
 * @param {string} bvid
 * @returns {Promise<{ title: string, owner: string, pubDate: string, duration: number, audioUrl: string }>}
 */
async function readVideoPage(bvid) {
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
      const play = await (await fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=' + v.bvid + '&cid=' + v.cid + '&fnval=16', { credentials: 'include' })).json();
      const audio = (play.data?.dash?.audio ?? []).sort((a, b) => a.bandwidth - b.bandwidth)[0];
      return { title: v.title, owner: v.owner.name, pubdate: v.pubdate, duration: v.duration, pages: v.pages.length, audioUrl: audio?.baseUrl, playError: play.message };
    })()`;
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`Đọc trang Bilibili lỗi: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);

    const video = result.value;
    if ('error' in video) throw new Error(`Trang ${bvid} không có dữ liệu video (tiêu đề: "${video.error}") — có thể bị 风控 hoặc video đã xoá.`);
    if (!video.audioUrl) throw new Error(`Không lấy được link audio cho ${bvid}: ${video.playError}`);
    if (video.pages > 1) console.log(`  ⚠ Video có ${video.pages} phần — chỉ lấy phần đầu.`);

    return {
      title: video.title,
      owner: video.owner,
      pubDate: new Date(video.pubdate * 1000).toISOString().slice(0, 10),
      duration: video.duration,
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
  const response = await fetch(url, { headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`Tải audio lỗi ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());

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
