// @ts-check
// Transcription via AssemblyAI.
//
// The audio is never downloaded here. AssemblyAI takes an `audio_url` and fetches it from its own
// network, so a 39MB episode never crosses the local connection — which is the whole reason this
// runs against the feed's enclosure URL rather than a local file. That URL is public and carries no
// referer check, unlike static.storyfm.cn, which 403s anything but its own site.
//
// Chinese is requested explicitly instead of letting the service detect it: 故事FM opens with music
// and ambient sound often enough that detection is a coin flip on the first seconds.

const ENDPOINT = 'https://api.assemblyai.com/v2/transcript';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 40 * 60 * 1_000;

// Naming a model is not optional in practice. Left out, the request falls through to the legacy
// engine, which transcribes Chinese accurately but returns it with no punctuation at all — and
// with nothing to split on, every sentence degrades into a fixed-length slice of characters.
// Always the newest: it builds punctuation into its output and attributes speakers in one pass.
// Run `storyfm models` to see whether something newer has shipped.
const SPEECH_MODEL = 'universal-3-5-pro';

/**
 * @typedef {object} AsrWord
 * @property {string} text
 * @property {number} start  Milliseconds.
 * @property {number} end    Milliseconds.
 * @property {string} [speaker]
 */

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(/** @type {string} */ url, /** @type {string} */ apiKey, /** @type {RequestInit} */ init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: apiKey, 'content-type': 'application/json', ...init.headers },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`AssemblyAI trả về ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

/**
 * The API publishes no endpoint that lists models, but it does name every valid one when it
 * rejects a bad value — and rejection happens before any audio is touched, so asking is free.
 * @param {string} apiKey
 * @returns {Promise<{ models: string[], inUse: string }>}
 */
export async function listModels(apiKey) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: 'https://example.com/probe.mp3', speech_models: ['?'] }),
  });

  const { error = '' } = await response.json().catch(() => ({}));
  const models = [...error.matchAll(/"([a-z0-9-]+)"/g)].map(([, name]) => name);
  if (!models.length) throw new Error(`Không đọc được danh sách model. API trả về: ${error}`);
  return { models, inUse: SPEECH_MODEL };
}

/**
 * Submits the episode and waits for it to finish.
 * @param {string} audioUrl
 * @param {string} apiKey
 * @param {(status: string, elapsedSec: number) => void} [onProgress]
 * @returns {Promise<{ id: string, words: AsrWord[], text: string, audio_duration: number }>}
 */
export async function transcribe(audioUrl, apiKey, onProgress) {
  const submitted = await request(ENDPOINT, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      audio_url: audioUrl,
      language_code: 'zh',
      speech_models: [SPEECH_MODEL],
      speaker_labels: true,
      punctuate: true,
      format_text: true,
    }),
  });

  const startedAt = Date.now();

  for (;;) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > POLL_TIMEOUT_MS) {
      throw new Error(`Quá ${POLL_TIMEOUT_MS / 60_000} phút mà AssemblyAI chưa xong (id ${submitted.id}).`);
    }

    const result = await request(`${ENDPOINT}/${submitted.id}`, apiKey);
    onProgress?.(result.status, Math.round(elapsed / 1_000));

    if (result.status === 'completed') return result;
    if (result.status === 'error') throw new Error(`AssemblyAI lỗi: ${result.error}`);

    await sleep(POLL_INTERVAL_MS);
  }
}
