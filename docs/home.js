// @ts-check
// The episode list. "Tất cả" shows every episode, grouped by where it comes from, each tagged with
// its topics. A topic shows its episodes in the order to study them, how far the chapters studied go,
// and a link straight to the chapter to study next, so one subject can be gone through episode after
// episode. The topic chosen is remembered in this browser and kept in the address, so a reload or a
// way back from the player lands on it again.

import { report, showHours } from './meter.js';
import { call, savedConnection } from './server.js';
import { chapterLink } from './studied.js';
import { TOPIC_KEY, nextChapter, topicProgress, topicsOf } from './topics.js';

/** @typedef {{ id: string, title: string, pubDate: string, duration: number, source?: string, owner?: string }} Entry */
/** @typedef {import('./topics.js').Topic} Topic */
/** @typedef {import('./topics.js').Chapter} Chapter */
/** @typedef {import('./studied.js').Studied} Studied */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const formatDuration = (/** @type {number} */ seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** @type {Entry[]} */
let episodes = [];
/** @type {Topic[]} */
let topics = [];
/** The chapters marked studied, from the server; none until it answers, or without one. */
/** @type {Studied[] | null} */
let studied = null;
/** Each episode's chapters, fetched as a topic needs them. */
/** @type {Map<string, Chapter[]>} */
const chapters = new Map();
/** @type {Topic | undefined} */
let topic;

// ---------- the topic chosen ----------

function chosenTopic() {
  const id = new URLSearchParams(location.search).get('topic') ?? readStored();
  return topics.find((t) => t.id === id);
}

function readStored() {
  try {
    return localStorage.getItem(TOPIC_KEY);
  } catch {
    return null;
  }
}

function choose(/** @type {Topic | undefined} */ chosen) {
  topic = chosen;
  try {
    if (topic) localStorage.setItem(TOPIC_KEY, topic.id);
    else localStorage.removeItem(TOPIC_KEY);
  } catch {
    // Not remembered this time; the address still has it.
  }
  const url = new URL(location.href);
  if (topic) url.searchParams.set('topic', topic.id);
  else url.searchParams.delete('topic');
  history.replaceState(null, '', url);
  render();
}

// ---------- every episode ----------

function renderAll() {
  const videos = episodes.filter((episode) => episode.source === 'bilibili');
  const stories = episodes.filter((episode) => !episode.source);
  // Each other podcast gets its own heading, named after the show; its episodes need not repeat it.
  const shows = Map.groupBy(episodes.filter((episode) => episode.source === 'podcast'), (episode) => episode.owner);
  $('podcasts').replaceChildren(...[...shows].flatMap(([show, items]) => {
    const heading = document.createElement('h2');
    heading.className = 'section';
    heading.textContent = show ?? '';
    return [heading, ...items.map((episode) => listed({ ...episode, owner: undefined }))];
  }));
  // App interfaces read aloud: one heading for all of them, each naming its app.
  const apps = episodes.filter((episode) => episode.source === 'ui');
  $('ui-heading').hidden = !apps.length;
  $('ui-list').replaceChildren(...apps.map(listed));
  $('bili-heading').hidden = !videos.length;
  $('bili-list').replaceChildren(...videos.map(listed));
  $('list').replaceChildren(...stories.map(listed));
}

/** An episode as a link to the player, its details under its title. */
function toLink(/** @type {Entry} */ episode, /** @type {(string | Node)[]} */ details) {
  const link = document.createElement('a');
  link.className = 'episode';
  link.href = `player.html?ep=${encodeURIComponent(episode.id)}`;
  link.innerHTML = '<div class="title"></div><div class="sub"></div>';
  /** @type {HTMLElement} */ (link.querySelector('.title')).textContent = episode.title;
  /** @type {HTMLElement} */ (link.querySelector('.sub')).append(...details);
  return link;
}

/** In "Tất cả": the topics an episode is in, then where it comes from, its date and length, and how
 * many of its chapters were studied. */
function listed(/** @type {Entry} */ episode) {
  const count = studied?.filter((s) => s.ep === episode.id).length;
  const details = [episode.owner, episode.pubDate, formatDuration(episode.duration), count && `đã học ${count} chương`];
  return toLink(episode, [...topicsOf(topics, episode.id).map(tag), details.filter(Boolean).join(' · ')]);
}

function tag(/** @type {Topic} */ t) {
  const span = document.createElement('span');
  span.className = 'tag';
  span.textContent = t.vi;
  return span;
}

// ---------- one topic ----------

function renderChips() {
  const chip = (/** @type {Topic | undefined} */ t) => {
    const button = document.createElement('button');
    button.className = 'chip';
    button.type = 'button';
    button.setAttribute('aria-pressed', String(t === topic));
    button.textContent = t ? t.vi : 'Tất cả';
    if (t) {
      const count = document.createElement('span');
      count.className = 'chip-count';
      count.textContent = String(t.episodes.length);
      button.append(count);
      button.title = `${t.zh} · ${t.about}`;
    }
    button.addEventListener('click', () => choose(t));
    return button;
  };
  $('topics').replaceChildren(chip(undefined), ...topics.map(chip));
  $('topics').hidden = !topics.length;
  // On a phone the row scrolls sideways; the topic chosen is kept in sight.
  $('topics').querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Fetches the chapters of the topic's episodes not fetched yet; an episode not cut into chapters has none. */
async function loadChapters(/** @type {Topic} */ t) {
  await Promise.all(t.episodes.filter((ep) => !chapters.has(ep)).map(async (ep) => {
    const data = await fetch(`data/${encodeURIComponent(ep)}.chapters.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    chapters.set(ep, data?.chapters ?? []);
  }));
}

async function renderTopic(/** @type {Topic} */ t) {
  $('topic-name').textContent = t.vi;
  $('topic-zh').textContent = t.zh;
  $('topic-about').textContent = t.about;
  /** @type {HTMLAnchorElement} */ ($('topic-listen')).href = `listen.html?topic=${encodeURIComponent(t.id)}`;
  showPlanned(t);
  await loadChapters(t);
  if (t !== topic) return;

  const progress = topicProgress(t, chapters, studied ?? []);
  const place = nextChapter(t, chapters, studied ?? []);
  const byId = new Map(episodes.map((episode) => [episode.id, episode]));
  $('topic-list').replaceChildren(...progress.map(({ ep, total, studied: done }, k) => {
    // The index only lists a topic's episodes that have a transcript.
    const episode = /** @type {Entry} */ (byId.get(ep));
    const item = document.createElement('li');
    item.className = 'topic-item';
    item.classList.toggle('is-done', total > 0 && done === total);
    item.classList.toggle('is-next', ep === place?.ep);
    const number = document.createElement('span');
    number.className = 'topic-n';
    number.textContent = String(k + 1);
    // How much is left counts out of the whole here, where "Tất cả" only counts what was studied.
    const count = total ? `${studied ? `${done}/` : ''}${total} chương` : '';
    const link = toLink(episode, [[episode.owner ?? showOf(episode), formatDuration(episode.duration), count].filter(Boolean).join(' · ')]);
    if (studied && total) link.append(bar(done / total));
    item.append(number, link);
    return item;
  }));

  const chaptersAll = progress.reduce((sum, p) => sum + p.total, 0);
  const chaptersDone = progress.reduce((sum, p) => sum + p.studied, 0);
  const episodesDone = progress.filter((p) => p.total && p.studied === p.total).length;
  $('topic-progress').textContent = !studied ? `${t.episodes.length} tập · ${chaptersAll} chương`
    : place ? `Đã học ${chaptersDone}/${chaptersAll} chương · xong ${episodesDone}/${t.episodes.length} tập`
      : `Đã học hết ${chaptersAll} chương của chủ đề này`;
  $('topic-bar').replaceChildren(...(studied ? [bar(chaptersAll ? chaptersDone / chaptersAll : 0)] : []));
  showNext(t, place);
}

/** Where an episode with no owner comes from: 故事FM's own feed. */
const showOf = (/** @type {Entry} */ episode) => (episode.source ? '' : '故事FM');

function bar(/** @type {number} */ share) {
  const track = document.createElement('div');
  track.className = 'bar';
  const fill = document.createElement('span');
  fill.style.width = `${Math.round(share * 100)}%`;
  track.append(fill);
  return track;
}

/** The way into the topic: the chapter to study next, opened in the player and looped. */
function showNext(/** @type {Topic} */ t, /** @type {import('./topics.js').Place | null} */ place) {
  const link = /** @type {HTMLAnchorElement} */ ($('topic-next'));
  link.hidden = !place;
  if (!place) return;
  const started = Boolean(studied?.some((s) => t.episodes.includes(s.ep)));
  link.href = chapterLink({ ep: place.ep, ...place.chapter });
  $('topic-next-label').textContent = started ? '▶ Học tiếp' : '▶ Bắt đầu';
  $('topic-next-where').textContent = `${place.ep} · chương ${place.n + 1} · ${place.chapter.zh}`;
}

/** The topic's episodes not transcribed yet: what to add next to keep going in it. */
function showPlanned(/** @type {Topic} */ t) {
  $('topic-planned').hidden = !t.planned.length;
  $('planned-heading').textContent = `Chưa thêm · ${t.planned.length} tập nữa`;
  $('planned-list').replaceChildren(...t.planned.map(({ id, title }) => {
    const item = document.createElement('li');
    item.textContent = `${id} · ${title}`;
    return item;
  }));
}

// ---------- the page ----------

function render() {
  renderChips();
  $('all').hidden = Boolean(topic);
  $('topic').hidden = !topic;
  if (topic) renderTopic(topic);
  else renderAll();
}

/** The chapters studied, from the server; the list redraws with them. */
async function loadStudied() {
  const connection = savedConnection();
  if (!connection) return;
  ({ chapters: studied } = await call(connection, '/studied').catch(() => ({ chapters: null })));
  if (studied) render();
}

/** Today's listening and the way to a thousand hours, sending first what a page left unsent. */
async function showListening() {
  const connection = savedConnection();
  if (!connection) return;
  const days = await report(connection).catch(() => null);
  if (days) showHours($('hours'), days);
}

try {
  const response = await fetch('data/index.json');
  if (!response.ok) throw new Error(String(response.status));
  ({ episodes, topics = [] } = await response.json());
  $('meta').textContent = `${episodes.filter((episode) => !episode.source).length} tập đã có transcript`;
  choose(chosenTopic());
} catch {
  $('meta').textContent = 'Chưa có tập nào. Chạy `storyfm add <mã tập>` rồi tải lại trang.';
}
loadStudied();
showListening();
