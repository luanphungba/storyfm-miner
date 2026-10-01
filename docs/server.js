// @ts-check
// The server in server/miner.py: its address and token, typed in once through the Anki dialog and
// kept in this browser only, and the one way every page calls it.

export const STORAGE_KEY = 'ci-anki-server';
const REQUEST_TIMEOUT_MS = 60_000;

/** @typedef {{ url: string, token: string }} Connection */

/** @returns {Connection | null} */
export function savedConnection() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return saved?.url && saved?.token ? saved : null;
  } catch {
    return null;
  }
}

/** POSTs to the server and returns its JSON, or throws with a message worth showing. */
export async function call(/** @type {Connection} */ connection, /** @type {string} */ path, body = {}) {
  let response;
  try {
    response = await fetch(connection.url.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('Không kết nối được server Anki.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Server trả lỗi ${response.status}.`);
  return payload;
}
