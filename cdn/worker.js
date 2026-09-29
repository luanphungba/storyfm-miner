// Serves data/audio/ with byte ranges. Cloudflare's static assets always answer a Range request
// with the whole file and a 200, and Safari on iOS will not seek (nor, sometimes, play) a media
// file served that way — so this answers ranges itself. Files are at most 25 MiB, so slicing the
// whole file in memory is fine.

export default {
  async fetch(request, env) {
    const asset = await env.ASSETS.fetch(new Request(request.url, { method: 'GET' }));
    const range = request.headers.get('Range')?.match(/^bytes=(\d*)-(\d*)$/);
    if (!asset.ok || !range) return withRanges(asset);

    const body = await asset.arrayBuffer();
    const size = body.byteLength;
    let start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
    let end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    start = Math.max(0, start);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }

    const headers = new Headers(asset.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(request.method === 'HEAD' ? null : body.slice(start, end + 1), { status: 206, headers });
  },
};

function withRanges(response) {
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  return new Response(response.body, { status: response.status, headers });
}
