import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cdn/worker.js';

/**
 * Stands in for the R2 bucket as the local runtime was seen to answer: each key holds its own name
 * as the body, a range running past the end is clamped and one starting there throws.
 */
const env = {
  AUDIO: {
    async head(/** @type {string} */ key) {
      if (key.startsWith('missing.')) return null;
      const body = `bytes of ${key}`;
      return {
        size: body.length,
        httpEtag: `"${key}"`,
        writeHttpMetadata: (/** @type {Headers} */ headers) => headers.set('Content-Type', 'audio/mp4'),
      };
    },
    async get(/** @type {string} */ key, /** @type {{ range?: any }} */ { range } = {}) {
      const object = await this.head(key);
      if (!object) return null;
      const body = `bytes of ${key}`;
      if (!range) return { ...object, body: new Response(body).body };
      const offset = range.suffix === undefined ? range.offset : Math.max(0, body.length - range.suffix);
      if (offset >= body.length || range.suffix === 0) throw new Error('get: The requested range is not satisfiable (10039)');
      const length = Math.min(range.length ?? body.length, body.length - offset);
      return { ...object, range: { offset, length }, body: new Response(body.slice(offset, offset + length)).body };
    },
  },
};

const get = (/** @type {string} */ path, /** @type {Record<string, string>} */ headers = {}, method = 'GET') =>
  worker.fetch(new Request(`https://storyfm-audio.example.workers.dev${path}`, { headers, method }), env);

test('the file asked for is served whole, with its type', async () => {
  const response = await get('/CC1.m4a');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'bytes of CC1.m4a');
  assert.equal(response.headers.get('Content-Type'), 'audio/mp4');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
});

test('an open range is cut from the file', async () => {
  const response = await get('/CC1.m4a', { Range: 'bytes=9-' });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'CC1.m4a');
  assert.equal(response.headers.get('Content-Range'), 'bytes 9-15/16');
  assert.equal(response.headers.get('Content-Length'), '7');
});

test('a closed range, a suffix and one past the end say which bytes were sent', async () => {
  const closed = await get('/CC1.m4a', { Range: 'bytes=0-1' });
  assert.equal(await closed.text(), 'by');
  assert.equal(closed.headers.get('Content-Range'), 'bytes 0-1/16');
  const suffix = await get('/CC1.m4a', { Range: 'bytes=-3' });
  assert.equal(await suffix.text(), 'm4a');
  assert.equal(suffix.headers.get('Content-Range'), 'bytes 13-15/16');
  const clamped = await get('/CC1.m4a', { Range: 'bytes=12-99' });
  assert.equal(await clamped.text(), '.m4a');
  assert.equal(clamped.headers.get('Content-Range'), 'bytes 12-15/16');
});

test('a range starting past the end is refused, and one this does not serve gets the whole file', async () => {
  const past = await get('/CC1.m4a', { Range: 'bytes=16-' });
  assert.equal(past.status, 416);
  assert.equal(past.headers.get('Content-Range'), 'bytes */16');
  for (const range of ['bytes=0-1,4-5', 'bytes=5-2', 'bytes=-', 'items=0-1']) {
    const whole = await get('/CC1.m4a', { Range: range });
    assert.equal(whole.status, 200, range);
    assert.equal(await whole.text(), 'bytes of CC1.m4a');
  }
});

test("a HEAD gets the whole file's headers and no body", async () => {
  const response = await get('/CC1.m4a', { Range: 'bytes=9-' }, 'HEAD');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), '16');
  assert.equal(response.headers.get('ETag'), '"CC1.m4a"');
  assert.equal(await response.text(), '');
});

test('a missing file is a 404', async () => {
  assert.equal((await get('/missing.m4a')).status, 404);
  assert.equal((await get('/')).status, 404);
});
