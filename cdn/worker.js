// Serves the audio in the storyfm-audio R2 bucket, which src/cdn.js uploads from data/audio/. R2
// holds files of any size and streams them, where the Worker's static assets refused one over 25 MiB.
// A Range request gets a 206 and only those bytes: Safari on iOS will not seek (nor, sometimes, play)
// a media file served whole with a 200.

/** What R2's get throws for a range that starts at or past the end of the file. */
const UNSATISFIABLE = /\(10039\)$/;

export default {
  async fetch(request, env) {
    const key = new URL(request.url).pathname.slice(1);
    if (!key) return notFound();
    // HTTP defines Range for GET only; a HEAD gets the whole file's headers.
    const head = request.method === 'HEAD';
    const range = head ? null : parseRange(request.headers.get('Range'));

    let object;
    try {
      object = head ? await env.AUDIO.head(key) : await env.AUDIO.get(key, range ? { range } : {});
    } catch (error) {
      if (!UNSATISFIABLE.test(error.message)) throw error;
      const { size } = await env.AUDIO.head(key);
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    if (!object) return notFound();

    const headers = new Headers({ 'Accept-Ranges': 'bytes', ETag: object.httpEtag });
    object.writeHttpMetadata(headers);
    if (!range) {
      headers.set('Content-Length', String(object.size));
      return new Response(head ? null : object.body, { headers });
    }
    // R2 clamps a range that runs past the end, and says which bytes it sent.
    const { offset, length } = object.range;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  },
};

/**
 * The one byte range a Range header asks for, as R2 takes it; null sends the whole file, for no
 * header, several ranges or a malformed one, which HTTP says to ignore.
 * @param {string | null} header
 */
function parseRange(header) {
  const [, first, last] = header?.match(/^bytes=(\d*)-(\d*)$/) ?? [];
  if (first === undefined || (first === '' && last === '')) return null;
  if (first === '') return { suffix: Number(last) };
  if (last === '') return { offset: Number(first) };
  if (Number(last) < Number(first)) return null;
  return { offset: Number(first), length: Number(last) - Number(first) + 1 };
}

function notFound() {
  return new Response('Not found', { status: 404 });
}
