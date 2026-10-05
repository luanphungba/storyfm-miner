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

const strip = (/** @type {string} */ t) => t.replace(/[\s\p{P}]/gu, '');

/** The model returns the line cleaned up, but sometimes answers with a different line from the
 * context that merely shares the word. The marked line is ground truth, so the model's version is
 * kept only when it demonstrably is that line. */
export function pickSentence(/** @type {string} */ fromModel, /** @type {string} */ marked, /** @type {string} */ word) {
  const plain = marked.replace(/[【】]/g, '');
  if (!fromModel) return plain;
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

/** How many characters a and b share in the same order, gaps allowed. */
function commonLength(/** @type {string} */ a, /** @type {string} */ b) {
  const right = [...b];
  let row = new Array(right.length + 1).fill(0);
  for (const char of a) {
    const next = [0];
    for (let j = 0; j < right.length; j++) next.push(char === right[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]));
    row = next;
  }
  return row[right.length];
}

/**
 * Where a card's sentence is said: the tapped line and the lines either side it runs over. The model
 * answers with the whole sentence, which often spans several lines, and a link to the tapped line
 * alone showed all of it but replayed part (CC3's 而且要理解它背后，可能有特殊的做事逻辑。 stopped after
 * 而且要理解它背后). The model tidies the sentence too (drops 呃, writes 地 for 的), so a neighbour joins
 * when at least half its characters line up with the sentence, and only next to one that did: a 的
 * or a 我 shared with a line further off never stretches the card.
 * @param {string} sentence
 * @param {{ start: number, end: number, text: string }[]} lines  The tapped line and those around it, in order.
 * @param {number} at  Where the tapped line is in lines.
 * @returns {{ start: number, end: number }}
 */
export function sentenceSpan(sentence, lines, at) {
  const want = strip(sentence);
  const said = (/** @type {number} */ from, /** @type {number} */ to) =>
    commonLength(want, lines.slice(from, to + 1).map((line) => strip(line.text)).join(''));
  const joins = (/** @type {number} */ gained, /** @type {number} */ line) =>
    strip(lines[line].text).length > 0 && 2 * gained >= strip(lines[line].text).length;

  let from = at;
  let to = at;
  while (to + 1 < lines.length && joins(said(from, to + 1) - said(from, to), to + 1)) to++;
  while (from > 0 && joins(said(from - 1, to) - said(from, to), from - 1)) from--;
  return { start: lines[from].start, end: lines[to].end };
}

/** @typedef {{ added: number, limit: number, waiting: number }} Today */

/**
 * What to say before a new word is looked up once today's new cards already fill a day of Anki, or
 * null to go ahead: under the limit, no limit set (0 new cards a day is a pause, not a budget), or a
 * server too old to send the counts.
 * @param {Today | null | undefined} today
 * @returns {{ title: string, detail: string } | null}
 */
export function dailyLimit(today) {
  if (!today || !(today.limit > 0) || today.added < today.limit) return null;
  const { added, limit, waiting } = today;
  return {
    title: `Hôm nay đã thêm ${added}/${limit} thẻ mới`,
    detail: waiting > limit
      ? `${waiting} thẻ đang chờ học, đủ cho khoảng ${Math.ceil(waiting / limit)} ngày.`
      : `Anki cho học ${limit} thẻ mới mỗi ngày, thẻ thêm nữa sẽ chờ sang hôm sau.`,
  };
}

export const formatTime = (/** @type {number} */ total) =>
  `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`;

/** A tenth of a second either side, outwards: rounding 159.56 to 159.6 clipped the start of 丹. */
const floorTenth = (/** @type {number} */ s) => (Math.floor(s * 10 + 1e-6) / 10).toFixed(1);
const ceilTenth = (/** @type {number} */ s) => (Math.ceil(s * 10 - 1e-6) / 10).toFixed(1);

/** @param {{ id: string, title: string }} episode @param {{ start: number, end: number }} cue */
export function lineLink(episode, cue, /** @type {string} */ audioSrc) {
  const query = new URLSearchParams({
    ep: episode.id,
    start: floorTenth(cue.start),
    end: ceilTenth(cue.end),
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
