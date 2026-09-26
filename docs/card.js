// @ts-check
// What goes on an Anki card mined from a tapped word. Ported from the CI Miner extension
// (youtube-chinese-miner/src/content.js) so a card added from this page is the same note, field for
// field, as one the extension adds on the desktop. Pure: the page supplies the pinyin function.

/** Where a card's link sends the listener back to: this player, looping that one line. */
const PLAYER_URL = 'https://luanphungba.github.io/storyfm-miner/player.html';

/** Lines either side sent as context. Lines are ~13 characters, so two either side is less than a
 * sentence — not enough for the model to tell which sense is meant. Same as the extension. */
export const CONTEXT_LINES = 4;

export const esc = (/** @type {unknown} */ s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** A field as saved on a card — HTML — back to the text it shows. */
export function plainText(/** @type {string} */ html = '') {
  const entities = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' });
  return html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => entities[e]).trim();
}

/** The line with the tapped word wrapped in 【】, the way the model is told to expect it. */
export function markLine(/** @type {string} */ text, /** @type {number} */ start, /** @type {number} */ length) {
  return `${text.slice(0, start)}【${text.slice(start, start + length)}】${text.slice(start + length)}`;
}

/** Escaped text with every occurrence of word in bold. */
export function highlight(/** @type {string} */ text, /** @type {string} */ word) {
  const safeWord = esc(word);
  return safeWord ? esc(text).split(safeWord).join(`<b>${safeWord}</b>`) : esc(text);
}

/** The model returns the line cleaned up, but sometimes answers with a different line from the
 * context that merely shares the word. The marked line is ground truth, so the model's version is
 * kept only when it demonstrably is that line. */
export function pickSentence(/** @type {string} */ fromModel, /** @type {string} */ marked, /** @type {string} */ word) {
  const plain = marked.replace(/[【】]/g, '');
  if (!fromModel) return plain;
  const strip = (/** @type {string} */ t) => t.replace(/[\s\p{P}]/gu, '');
  const model = strip(fromModel);
  const seen = strip(plain);
  if (!model.includes(strip(word))) return plain;
  if (!seen || model.includes(seen) || seen.includes(model)) return fromModel;
  const run = Math.min(5, seen.length);
  for (let i = 0; i + run <= seen.length; i++) {
    if (model.includes(seen.slice(i, i + run))) return fromModel;
  }
  return plain;
}

export const formatTime = (/** @type {number} */ total) =>
  `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`;

/** @param {{ id: string, title: string }} episode @param {{ start: number, end: number }} cue */
export function lineLink(episode, cue, /** @type {string} */ audioSrc) {
  const query = new URLSearchParams({
    ep: episode.id,
    start: cue.start.toFixed(1),
    end: cue.end.toFixed(1),
    loop: '10',
  });
  // Carried so replaying the line from Anki costs one request, the audio, not a transcript fetch too.
  if (audioSrc) query.set('src', audioSrc);
  return `${PLAYER_URL}?${query}`;
}

/**
 * @typedef {{ word?: string, traditional?: string, pinyin?: string, hanViet?: string, pos?: string,
 *   meaning?: string, otherMeanings?: string[], notes?: string, sentence?: string,
 *   sentenceTranslation?: string, example?: { zh?: string, translation?: string },
 *   level?: string, levelTag?: string }} Lookup
 */

/**
 * Fields and tags of a CI-Chinese-YouTube note. Audio fields stay empty: the card's link replays the
 * real line from the podcast.
 * @param {{ lookup: Lookup, word: string, meaning: string, sentence: string,
 *   episode: { id: string, title: string }, cue: { start: number, end: number }, audioSrc: string,
 *   py: (text: string) => string }} input
 */
export function noteData({ lookup: d, word, meaning, sentence, episode, cue, audioSrc, py }) {
  const example = d.example ?? {};
  const link = lineLink(episode, cue, audioSrc);
  const fields = {
    Word: esc(word),
    Traditional: d.traditional && d.traditional !== word ? esc(d.traditional) : '',
    Pinyin: esc(d.pinyin || py(word)),
    HanViet: esc(d.hanViet),
    PartOfSpeech: esc(d.pos),
    Meaning: esc(meaning),
    OtherMeanings: esc((d.otherMeanings ?? []).join('; ')),
    Notes: esc(d.notes),
    Example: example.zh ? highlight(example.zh, word) : '',
    ExamplePinyin: example.zh ? esc(py(example.zh)) : '',
    ExampleMeaning: esc(example.translation),
    Sentence: highlight(sentence, word),
    SentencePinyin: esc(py(sentence)),
    SentenceMeaning: esc(d.sentenceTranslation),
    VideoTitle: esc(episode.title),
    VideoLink: `<a href="${esc(link)}">▶ ${esc(episode.title)} · ${formatTime(cue.start)}</a>`,
    Level: esc(d.level),
  };
  const tags = ['storyfm', `sfm_${episode.id}`, ...(d.levelTag ? [d.levelTag] : [])];
  return { fields, tags };
}
