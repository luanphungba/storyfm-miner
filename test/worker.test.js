import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cdn/worker.js';

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const ANKI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/6.11.0 Chrome/140.0.0.0 Safari/537.36';

/** Stands in for the Worker's static assets: each path answers with its own name as the body. */
const env = {
  ASSETS: {
    fetch: async (/** @type {Request} */ request) => {
      const path = new URL(request.url).pathname;
      if (path === '/missing.m4a' || path === '/missing.mp3') return new Response('not found', { status: 404 });
      return new Response(`bytes of ${path}`, { headers: { 'Content-Type': path.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4' } });
    },
  },
};

const get = (/** @type {string} */ path, /** @type {Record<string, string>} */ headers = {}) =>
  worker.fetch(new Request(`https://storyfm-audio.example.workers.dev${path}`, { headers }), env);

test('Chrome, phones and AssemblyAI get the m4a they asked for', async () => {
  for (const ua of [CHROME, 'AssemblyAI/1.0', '']) {
    const response = await get('/CC1.m4a', ua ? { 'User-Agent': ua } : {});
    assert.equal(await response.text(), 'bytes of /CC1.m4a');
    assert.equal(response.headers.get('Content-Type'), 'audio/mp4');
  }
});

test("Anki's desktop webview gets the mp3 at the m4a's URL", async () => {
  const response = await get('/CC1.m4a', { 'User-Agent': ANKI });
  assert.equal(await response.text(), 'bytes of /CC1.mp3');
  assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(response.headers.get('Vary'), 'User-Agent');
});

test('ranges are cut from whichever file was chosen', async () => {
  const response = await get('/CC1.m4a', { 'User-Agent': ANKI, Range: 'bytes=9-' });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), '/CC1.mp3');
  assert.equal(response.headers.get('Content-Range'), 'bytes 9-16/17');
  const chrome = await get('/CC1.m4a', { 'User-Agent': CHROME, Range: 'bytes=9-' });
  assert.equal(await chrome.text(), '/CC1.m4a');
});

test('only m4a requests are redirected, and a missing file stays a 404', async () => {
  assert.equal(await (await get('/CC1.mp3', { 'User-Agent': CHROME })).text(), 'bytes of /CC1.mp3');
  assert.equal(await (await get('/notes.json', { 'User-Agent': ANKI })).text(), 'bytes of /notes.json');
  assert.equal((await get('/missing.m4a', { 'User-Agent': ANKI })).status, 404);
});
