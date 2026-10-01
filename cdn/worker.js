// Serves data/audio/ with byte ranges. Cloudflare's static assets always answer a Range request
// with the whole file and a 200, and Safari on iOS will not seek (nor, sometimes, play) a media
// file served that way — so this answers ranges itself. Files are at most 25 MiB, so slicing the
// whole file in memory is fine.
//
// Anki's desktop app renders cards in Qt WebEngine, which is built without AAC: an m4a fails there
// with error 4 on every file, whatever the Anki version. It is handed the CBR mp3 made next to each
// m4a (src/cdn.js) at the m4a's own URL instead, so cards already in a collection play as they are,
// with no template or link to change. Chrome, phones and AssemblyAI still get the m4a, which seeks
// more exactly (0–6ms against the mp3's 0–31ms early).

const QT_WEBENGINE = /QtWebEngine\//;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('.m4a') && QT_WEBENGINE.test(request.headers.get('User-Agent') ?? '')) {
      url.pathname = url.pathname.replace(/\.m4a$/, '.mp3');
    }
    const asset = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
    const range = request.headers.get('Range')?.match(/^bytes=(\d*)-(\d*)$/);
    if (!asset.ok || !range) return withRanges(asset);

    const body = await asset.arrayBuffer();
    const size = body.byteLength;
    let start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
    let end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    start = Math.max(0, start);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, Vary: 'User-Agent' } });
    }

    const headers = new Headers(asset.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Vary', 'User-Agent');
    return new Response(request.method === 'HEAD' ? null : body.slice(start, end + 1), { status: 206, headers });
  },
};

function withRanges(response) {
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Vary', 'User-Agent');
  return new Response(response.body, { status: response.status, headers });
}
