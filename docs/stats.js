// @ts-check
// "Thống kê": today's listening, the way to a thousand hours, each day's hours, chapters and words
// tapped, the words tapped and not known yet, and every chapter heard or studied with how many
// times. The numbers come from the server (server/miner.py) and the episodes' own chapter files;
// progress.js does the sums.

import { formatTime } from './card.js';
import { studyDay } from './listening.js';
import { report } from './meter.js';
import {
  GOAL_HOURS, chapterRows, dayRows, episodeRows, formatDuration, formatHours, formatPasses, formatTick,
  hourTicks, listenedDays, progress, reachLabel, shortDay, sortChapters, streak, weekday,
} from './progress.js';
import { call, savedConnection } from './server.js';
import { chapterLink, dayLabel } from './studied.js';
import { tappedByDay, unknownWords } from './taps.js';
import { GOAL_WORDS, formatChange, vocabularyByDay, vocabularyDays, wordTicks } from './vocab.js';

/** @typedef {import('./progress.js').Days} Days */
/** @typedef {import('./progress.js').Heard} Heard */
/** @typedef {import('./progress.js').Chapter} Chapter */
/** @typedef {import('./progress.js').ChapterOrder} ChapterOrder */
/** @typedef {import('./progress.js').DayRow} DayRow */
/** @typedef {import('./studied.js').Studied} Studied */
/** @typedef {import('./vocab.js').VocabDay} VocabDay */
/** @typedef {import('./vocab.js').TapHistory} TapHistory */
/**
 * @typedef {{ days: Days, heard: Heard[], studied: Studied[], chaptersOf: Record<string, Chapter[]>,
 *   titles: Record<string, string>, tapped: Record<string, number>, unknown: number,
 *   vocabulary: VocabDay[] | null }} Stats
 *   `tapped` is the words tapped each day; `unknown`, the words tapped in a studied chapter and not
 *   known since. The vocabulary, a row per day from the first studied, stays null until each studied
 *   episode's words are in.
 */
/** @typedef {{ range: number, order: ChapterOrder, ep: string }} Settings */

/** The range, order and episode picked last time, remembered in this browser. */
const SETTINGS_KEY = 'ci-stats-settings';
const SVG = 'http://www.w3.org/2000/svg';
/** The space between the two parts of a day's column. */
const GAP = 2;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {Stats | null} */
let stats = null;
/** What the vocabulary says while there is no count: still loading, or a file did not come. */
let vocabularyPending = '…';
/** @type {Settings} */
let settings = { range: 7, order: 'recent', ep: '' };
/** The days in the chart, for its tooltip. */
/** @type {DayRow[]} */
let charted = [];

// ---------- settings ----------

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    // Storage blocked or garbled: the defaults do.
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}

// ---------- loading ----------

async function load() {
  const connection = savedConnection();
  if (!connection) {
    $('status').innerHTML = 'Chưa kết nối server. Mở <a href="index.html">một tập</a>, bấm nút <b>Anki</b> và nhập địa chỉ server cùng token.';
    return;
  }
  try {
    // What a page here left unsent goes first, so the numbers below have it.
    await report(connection).catch(() => {});
    const [listened, studied, history, taps, titles] = await Promise.all([
      call(connection, '/listened'), call(connection, '/studied'), call(connection, '/vocab'), call(connection, '/tapped'), loadTitles(),
    ]);
    /** @type {string[]} */
    const episodes = [...new Set([...listened.chapters, ...studied.chapters].map((c) => c.ep))];
    const chaptersOf = Object.fromEntries(await Promise.all(episodes.map(async (ep) => [ep, await loadChapters(ep)])));
    stats = {
      days: listened.days, heard: listened.chapters, studied: studied.chapters, chaptersOf, titles,
      tapped: tappedByDay(history.tapped), unknown: unknownWords(taps.chapters), vocabulary: stats?.vocabulary ?? null,
    };
    // Last in, as it fetches every studied episode's words; it draws when they are.
    loadVocabulary(studied.chapters, history);
  } catch (error) {
    // A refresh that fails keeps the numbers already shown.
    if (!stats) $('status').textContent = /** @type {Error} */ (error).message;
    return;
  }
  $('status').hidden = true;
  $('dashboard').hidden = false;
  render();
}

/** The vocabulary, from the words each studied episode counts as and every day each was tapped or known. */
async function loadVocabulary(/** @type {Studied[]} */ studied, /** @type {TapHistory} */ history) {
  const episodes = [...new Set(studied.map((s) => s.ep))];
  try {
    const [vocab, lines] = await Promise.all([
      fetch('data/vocab.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('vocab.json')))),
      Promise.all(episodes.map((ep) => fetch(`data/${encodeURIComponent(ep)}.vocab.json`)
        .then((r) => (r.ok ? r.json() : null)).catch(() => null))),
    ]);
    if (!stats) return;
    const linesOf = Object.fromEntries(episodes.map((ep, i) => [ep, lines[i]?.cues ?? []]));
    stats.vocabulary = vocabularyByDay({ studied, linesOf, vocab, history }, vocabularyDays(studied, studyDay(new Date())));
  } catch {
    vocabularyPending = '—';
  }
  render();
}

/** @returns {Promise<Record<string, string>>} */
async function loadTitles() {
  const index = await fetch('data/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return Object.fromEntries((index?.episodes ?? []).map((/** @type {{ id: string, title: string }} */ e) => [e.id, e.title]));
}

/** @returns {Promise<Chapter[]>} */
async function loadChapters(/** @type {string} */ ep) {
  const data = await fetch(`data/${encodeURIComponent(ep)}.chapters.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return data?.chapters ?? [];
}

// ---------- rendering ----------

function render() {
  if (!stats) return;
  const today = studyDay(new Date());
  renderToday(stats, today);
  renderGoal(stats, today);
  renderVocabulary(stats, today);
  renderDays(stats, today);
  renderChapters(stats, today);
}

function renderToday(/** @type {Stats} */ { days, studied, tapped }, /** @type {string} */ today) {
  const { player = 0, listen = 0 } = days[today] ?? {};
  $('today-hours').textContent = formatDuration(player + listen);
  $('today-split').textContent = `học ${formatDuration(player)} · nghe lại ${formatDuration(listen)}`;
  $('today-chapters').textContent = String(studied.filter((s) => s.dates.includes(today)).length);
  $('today-tapped').textContent = String(tapped[today] ?? 0);
  $('streak').textContent = String(streak(days, today));
}

function renderGoal(/** @type {Stats} */ { days, studied, unknown }, /** @type {string} */ today) {
  const p = progress(days, today);
  const share = Math.min(1, p.total / (GOAL_HOURS * 3600));
  $('goal-hours').textContent = String(GOAL_HOURS);
  $('goal-total').textContent = `${formatHours(p.total)} giờ`;
  $('goal-share').textContent = `/ ${GOAL_HOURS} · ${(share * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
  $('goal-fill').style.width = meterWidth(share);
  $('goal-meter').setAttribute('aria-valuemax', String(GOAL_HOURS));
  $('goal-meter').setAttribute('aria-valuenow', (p.total / 3600).toFixed(1));
  $('goal-note').textContent = share >= 1 ? `Đã đủ ${GOAL_HOURS} giờ.`
    : p.reach ? `Gần đây trung bình ${formatDuration(p.pace)} mỗi ngày: đủ ${GOAL_HOURS} giờ ${reachLabel(p.reach)}.`
      : 'Có giờ nghe của một ngày trọn vẹn thì sẽ ước được ngày đạt mục tiêu.';
  $('total-chapters').textContent = String(studied.length);
  $('unknown-words').textContent = String(unknown);
  $('total-days').textContent = String(listenedDays(days));
}

function renderVocabulary(/** @type {Stats} */ { vocabulary }, /** @type {string} */ today) {
  const count = (/** @type {number} */ n) => n.toLocaleString('vi-VN');
  $('vocab-goal').textContent = count(GOAL_WORDS);
  $('vocab-meter').setAttribute('aria-valuemax', String(GOAL_WORDS));
  const now = vocabulary?.at(-1);
  if (!vocabulary || !now) {
    for (const id of ['vocab-understood', 'vocab-understood-tile', 'vocab-solid', 'vocab-heard']) $(id).textContent = vocabularyPending;
    return;
  }
  const share = Math.min(1, now.understood / GOAL_WORDS);
  $('vocab-understood').textContent = `${count(now.understood)} từ`;
  $('vocab-share').textContent = `/ ${count(GOAL_WORDS)} · ${(share * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
  $('vocab-fill').style.width = meterWidth(share);
  $('vocab-meter').setAttribute('aria-valuenow', String(now.understood));
  const before = vocabulary.at(-2) ?? now;
  $('vocab-today').textContent = `Hôm nay ${formatChange(now.understood - before.understood)} từ hiểu khi nghe · ${formatChange(now.solid - before.solid)} từ đã vững.`;
  $('vocab-understood-tile').textContent = count(now.understood);
  $('vocab-solid').textContent = count(now.solid);
  $('vocab-heard').textContent = count(now.heard);
  drawVocabChart(vocabulary, today);
}

/** The two counts day by day as lines, each ending in a dot and its value, from the first day studied. */
function drawVocabChart(/** @type {VocabDay[]} */ rows, /** @type {string} */ today) {
  const box = $('vocab-chart-box');
  const chart = /** @type {SVGSVGElement} */ (/** @type {unknown} */ ($('vocab-chart')));
  const width = Math.max(240, box.clientWidth);
  const height = 190;
  const top = 10;
  const axis = 22;
  const left = 46;
  const right = 48; // room for the values the lines end in
  const plotHeight = height - top - axis;
  const plotWidth = width - left - right;
  const ticks = wordTicks(Math.min(...rows.map((r) => r.solid)), Math.max(...rows.map((r) => r.understood)));
  const low = ticks[0];
  const high = ticks.at(-1) ?? low + 1;
  const y = (/** @type {number} */ n) => top + plotHeight - ((n - low) / (high - low)) * plotHeight;
  const x = (/** @type {number} */ i) => left + (rows.length > 1 ? (i / (rows.length - 1)) * plotWidth : plotWidth / 2);
  chart.setAttribute('viewBox', `0 0 ${width} ${height}`);
  chart.setAttribute('height', String(height));

  /** @type {SVGElement[]} */
  const nodes = ticks.flatMap((t) => [
    svg('line', { class: 'grid', x1: left, x2: width - right, y1: y(t), y2: y(t) }),
    svg('text', { class: 'tick', x: left - 8, y: y(t) + 4, 'text-anchor': 'end' }, t.toLocaleString('vi-VN')),
  ]);
  const series = /** @type {const} */ (['understood', 'solid']);
  for (const key of series) {
    nodes.push(svg('path', { class: `line line-${key}`, d: rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r[key])}`).join(' ') }));
  }
  // The values at the line ends, pushed apart when the lines end close together.
  const last = rows.length - 1;
  const ends = series.map((key) => y(rows[last][key]));
  const apart = 14;
  if (ends[1] - ends[0] < apart) {
    const middle = (ends[0] + ends[1]) / 2;
    ends[0] = middle - apart / 2;
    ends[1] = middle + apart / 2;
  }
  series.forEach((key, k) => {
    nodes.push(svg('circle', { class: `dot dot-${key}`, cx: x(last), cy: y(rows[last][key]), r: 4 }));
    nodes.push(svg('text', { class: 'end-label', x: x(last) + 8, y: ends[k] + 4 }, rows[last][key].toLocaleString('vi-VN')));
  });
  const every = Math.max(1, Math.ceil(rows.length / 5));
  rows.forEach((r, i) => {
    if (i !== last && (i % every !== 0 || last - i < every / 2)) return;
    const [, month, date] = r.day.split('-').map(Number);
    const anchor = i === last ? (rows.length > 1 ? 'end' : 'middle') : i === 0 ? 'start' : 'middle';
    nodes.push(svg('text', { class: 'tick', x: x(i), y: height - 6, 'text-anchor': anchor }, i === last ? 'Hôm nay' : `${date}/${month}`));
  });

  // The crosshair follows the pointer to the nearest day; its dots and the tooltip say that day.
  const crosshair = svg('g', { visibility: 'hidden' });
  const rule = svg('line', { class: 'crosshair', y1: top, y2: top + plotHeight });
  const marks = series.map((key) => svg('circle', { class: `dot dot-${key}`, r: 4 }));
  crosshair.append(rule, ...marks);
  const hover = svg('rect', {
    class: 'hover', x: left, y: top, width: plotWidth + right / 2, height: plotHeight, tabindex: 0,
    'aria-label': `${rows.length} ngày, từ ${shortDay(rows[0].day, today)} đến hôm nay`,
  });
  const show = (/** @type {number} */ i) => {
    const r = rows[i];
    rule.setAttribute('x1', String(x(i)));
    rule.setAttribute('x2', String(x(i)));
    marks.forEach((mark, k) => {
      mark.setAttribute('cx', String(x(i)));
      mark.setAttribute('cy', String(y(r[series[k]])));
    });
    crosshair.setAttribute('visibility', 'visible');
    showVocabTip(rows, i, x(i), y(r.understood), today);
  };
  let focused = last;
  hover.addEventListener('pointermove', (event) => {
    const at = (/** @type {PointerEvent} */ (event).offsetX / box.clientWidth) * width;
    focused = Math.max(0, Math.min(last, Math.round(rows.length > 1 ? ((at - left) / plotWidth) * last : 0)));
    show(focused);
  });
  hover.addEventListener('focus', () => show(focused));
  hover.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[/** @type {KeyboardEvent} */ (event).key];
    if (!step) return;
    event.preventDefault();
    focused = Math.max(0, Math.min(last, focused + step));
    show(focused);
  });
  const hide = () => {
    crosshair.setAttribute('visibility', 'hidden');
    $('vocab-tooltip').hidden = true;
  };
  hover.addEventListener('pointerleave', hide);
  hover.addEventListener('blur', hide);
  nodes.push(crosshair, hover);
  chart.replaceChildren(...nodes);
  $('vocab-tooltip').hidden = true;
}

/** A day of the vocabulary chart: both counts, and how each moved from the day before. */
function showVocabTip(/** @type {VocabDay[]} */ rows, /** @type {number} */ i, /** @type {number} */ x, /** @type {number} */ lineTop, /** @type {string} */ today) {
  const r = rows[i];
  const before = rows[i - 1];
  const tip = $('vocab-tooltip');
  const line = (/** @type {number} */ value, /** @type {number | undefined} */ previous, /** @type {string} */ label, /** @type {string} */ keyClass) => {
    const row = document.createElement('div');
    const key = document.createElement('span');
    key.className = `line-key ${keyClass}`;
    const strong = document.createElement('b');
    strong.textContent = value.toLocaleString('vi-VN');
    row.append(key, strong, ` ${label}${previous === undefined ? '' : ` (${formatChange(value - previous)})`}`);
    return row;
  };
  const day = document.createElement('div');
  day.className = 'tt-day';
  day.textContent = shortDay(r.day, today);
  tip.replaceChildren(
    day,
    line(r.understood, before?.understood, 'hiểu khi nghe', 'key-understood'),
    line(r.solid, before?.solid, 'đã vững', 'key-solid'),
  );
  tip.hidden = false;
  const box = $('vocab-chart-box');
  const chartTop = $('vocab-chart').getBoundingClientRect().top - box.getBoundingClientRect().top;
  const scale = box.clientWidth / Math.max(240, box.clientWidth);
  tip.style.left = `${Math.min(Math.max(0, x * scale - tip.offsetWidth / 2), box.clientWidth - tip.offsetWidth)}px`;
  tip.style.top = `${Math.max(0, chartTop + lineTop * scale - tip.offsetHeight - 12)}px`;
}

function renderDays(/** @type {Stats} */ { days, studied, tapped }, /** @type {string} */ today) {
  charted = dayRows({ days, studied, words: tapped, today, count: settings.range });
  for (const chip of document.querySelectorAll('[data-range]')) {
    chip.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (chip).dataset.range) === settings.range));
  }
  drawChart(today);

  // The chart's numbers as a table, the latest day first: the days with anything in them, and today.
  const active = charted.filter((r) => r.day === today || r.player + r.listen >= 60 || r.chapters || r.words).reverse();
  $('day-rows').replaceChildren(...active.map((r) => {
    const row = document.createElement('tr');
    const listened = cell(formatDuration(r.player + r.listen));
    if (r.player >= 60 && r.listen >= 60) {
      const split = document.createElement('div');
      split.className = 'sub';
      split.textContent = `học ${formatDuration(r.player)} · nghe lại ${formatDuration(r.listen)}`;
      listened.append(split);
    }
    row.append(cell(shortDay(r.day, today)), listened, cell(String(r.chapters), 'num'), cell(String(r.words), 'num'));
    return row;
  }));
}

/** Any progress at all shows: a few hours of a thousand would otherwise draw nothing. */
const meterWidth = (/** @type {number} */ share) => (share > 0 ? `max(4px, ${share * 100}%)` : '0');

function cell(/** @type {string} */ text, className = '') {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

// ---------- the chart ----------

/** @returns {SVGElement} */
function svg(/** @type {string} */ tag, /** @type {Record<string, string | number>} */ attributes, text = '') {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text) element.textContent = text;
  return element;
}

/** A column part from `top` down to `bottom`, its top corners rounded when it is the column's end. */
function part(/** @type {number} */ x, /** @type {number} */ width, /** @type {number} */ top, /** @type {number} */ bottom, /** @type {boolean} */ end, /** @type {string} */ className) {
  const r = end ? Math.min(4, width / 2, bottom - top) : 0;
  const d = `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${bottom} Z`;
  return svg('path', { d, class: className });
}

/** The days as columns of hours, studying under listening again, one tick of gridline per step. */
function drawChart(/** @type {string} */ today) {
  const box = $('chart-box');
  const chart = /** @type {SVGSVGElement} */ (/** @type {unknown} */ ($('chart')));
  const width = Math.max(240, box.clientWidth);
  const height = 190;
  const top = 8;
  const axis = 22;
  const left = 54;
  const plotHeight = height - top - axis;
  const plotWidth = width - left - 4;
  const ticks = hourTicks(Math.max(0, ...charted.map((r) => r.player + r.listen)));
  const ceiling = ticks.at(-1) ?? 3600;
  const y = (/** @type {number} */ seconds) => top + plotHeight - (seconds / ceiling) * plotHeight;
  const slot = plotWidth / charted.length;
  const bar = Math.max(1, Math.min(24, slot - GAP));
  chart.setAttribute('viewBox', `0 0 ${width} ${height}`);
  chart.setAttribute('height', String(height));

  /** @type {SVGElement[]} */
  const nodes = ticks.flatMap((t) => [
    svg('line', { class: 'grid', x1: left, x2: width, y1: y(t), y2: y(t) }),
    svg('text', { class: 'tick', x: left - 8, y: y(t) + 4, 'text-anchor': 'end' }, formatTick(t)),
  ]);
  const weekly = charted.length <= 7;
  const every = weekly ? 1 : charted.length <= 30 ? 7 : 15;
  charted.forEach((r, i) => {
    const x = left + i * slot + (slot - bar) / 2;
    const column = svg('g', { class: 'col' });
    const base = y(0);
    const studyTop = y(r.player);
    if (r.player > 0) column.append(part(x, bar, studyTop, base, !(r.listen > 0), 'seg-player'));
    // The space between the parts comes out of the upper one, so the column stays its true height.
    const listenBase = r.player > 0 ? studyTop - GAP : base;
    const listenTop = y(r.player + r.listen);
    if (r.listen > 0 && listenBase - listenTop > 0.5) column.append(part(x, bar, listenTop, listenBase, true, 'seg-listen'));
    const hit = svg('rect', {
      class: 'hit', x: left + i * slot, y: top, width: slot, height: plotHeight + axis, tabindex: 0,
      'aria-label': `${shortDay(r.day, today)}: ${formatDuration(r.player + r.listen)}`,
    });
    for (const event of ['pointerenter', 'focus', 'click']) hit.addEventListener(event, () => showTip(i, column, x + bar / 2, y(r.player + r.listen), today));
    hit.addEventListener('blur', hideTip);
    column.append(hit);
    nodes.push(column);
    if ((charted.length - 1 - i) % every === 0) {
      const last = i === charted.length - 1;
      const [, month, date] = r.day.split('-').map(Number);
      const label = last ? 'Hôm nay' : weekly ? weekday(r.day) : `${date}/${month}`;
      nodes.push(svg('text', { class: 'tick', x: last ? width - 2 : x + bar / 2, y: height - 6, 'text-anchor': last ? 'end' : 'middle' }, label));
    }
  });
  chart.replaceChildren(...nodes);
  hideTip();
}

/** The day under the pointer or focus: its hours on each page, its chapters and words. */
function showTip(/** @type {number} */ i, /** @type {SVGElement} */ column, /** @type {number} */ x, /** @type {number} */ columnTop, /** @type {string} */ today) {
  const r = charted[i];
  const tip = $('tooltip');
  const line = (/** @type {string} */ value, /** @type {string} */ label, keyClass = '') => {
    const row = document.createElement('div');
    if (keyClass) {
      const key = document.createElement('span');
      key.className = `line-key ${keyClass}`;
      row.append(key);
    }
    const strong = document.createElement('b');
    strong.textContent = value;
    row.append(strong, ` ${label}`);
    return row;
  };
  const day = document.createElement('div');
  day.className = 'tt-day';
  day.textContent = shortDay(r.day, today);
  const total = document.createElement('div');
  total.className = 'tt-value';
  total.textContent = formatDuration(r.player + r.listen);
  tip.replaceChildren(
    day, total,
    line(formatDuration(r.player), 'học', 'key-player'),
    line(formatDuration(r.listen), 'nghe lại', 'key-listen'),
    Object.assign(document.createElement('div'), { className: 'tt-sub', textContent: `${r.chapters} chương · ${r.words} từ đã tra` }),
  );
  tip.hidden = false;
  const box = $('chart-box');
  const chartTop = $('chart').getBoundingClientRect().top - box.getBoundingClientRect().top;
  tip.style.left = `${Math.min(Math.max(0, x - tip.offsetWidth / 2), box.clientWidth - tip.offsetWidth)}px`;
  tip.style.top = `${Math.max(0, chartTop + columnTop - tip.offsetHeight - 8)}px`;
  box.classList.add('has-hot');
  for (const other of box.querySelectorAll('.col')) other.classList.toggle('is-hot', other === column);
}

function hideTip() {
  $('tooltip').hidden = true;
  $('chart-box').classList.remove('has-hot');
}

// ---------- chapters and episodes ----------

/** Episode titles run to forty characters; the filter only has to tell them apart. */
const shorten = (/** @type {string} */ title) => (title.length > 20 ? `${title.slice(0, 20)}…` : title);

/** Every chapter heard or studied, in the order picked, then the episodes they belong to. */
function renderChapters(/** @type {Stats} */ { heard, studied, chaptersOf, titles }, /** @type {string} */ today) {
  const rows = chapterRows({ heard, studied, chaptersOf });
  const episodes = episodeRows({ rows, chaptersOf, titles });

  const select = /** @type {HTMLSelectElement} */ ($('chapter-episode'));
  if (!episodes.some((e) => e.ep === settings.ep)) settings.ep = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'Mọi tập';
  select.replaceChildren(all, ...[...episodes].sort((a, b) => a.ep.localeCompare(b.ep)).map((e) => {
    const option = document.createElement('option');
    option.value = e.ep;
    option.textContent = shorten(e.title);
    return option;
  }));
  select.value = settings.ep;
  for (const chip of document.querySelectorAll('[data-order]')) {
    chip.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (chip).dataset.order === settings.order));
  }

  const shown = sortChapters(rows.filter((r) => !settings.ep || r.ep === settings.ep), settings.order);
  $('chapters-label').textContent = `Chương · ${shown.length}`;
  const text = (/** @type {string} */ className, /** @type {string} */ content, tag = 'span') => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = content;
    return element;
  };
  $('chapter-rows').replaceChildren(...shown.map((r) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'pl-item';
    link.href = chapterLink(r);
    const sub = [r.n === null ? r.ep : `${r.ep} §${r.n + 1}`, formatTime(r.end - r.start), dayLabel(r.last, today)];
    const line = text('pl-sub', sub.join(' · '));
    if (r.studied.length) line.prepend(text('pl-done', `✓ học ${r.studied.length} ngày · `));
    link.append(text('pl-zh', r.zh), text('pl-vi', r.vi), text('pl-stat', `${formatPasses(r.passes)} · ${formatDuration(r.seconds)}`), line);
    item.append(link);
    return item;
  }));
  if (!shown.length) {
    const empty = document.createElement('li');
    empty.className = 'note';
    empty.textContent = 'Chưa có chương nào. Nghe một chương trong player, hoặc bấm "✓ Học xong" khi học xong.';
    $('chapter-rows').append(empty);
  }

  $('episode-rows').replaceChildren(...episodes.map((e) => {
    const link = document.createElement('a');
    link.className = 'episode';
    link.href = `player.html?ep=${encodeURIComponent(e.ep)}`;
    const meter = document.createElement('div');
    meter.className = 'meter is-thin';
    const fill = document.createElement('div');
    fill.className = 'meter-fill';
    fill.style.width = meterWidth(e.chapters ? e.studied / e.chapters : 0);
    meter.append(fill);
    const studiedText = e.chapters ? `đã học ${e.studied}/${e.chapters} chương` : `đã học ${e.studied} chương`;
    link.append(text('title', e.title, 'div'), text('sub', [studiedText, `nghe ${formatDuration(e.seconds)}`, dayLabel(e.last, today)].join(' · '), 'div'), meter);
    return link;
  }));
  $('episodes-label').textContent = `Tập · ${episodes.length}`;
}

// ---------- controls ----------

for (const chip of document.querySelectorAll('[data-range]')) {
  chip.addEventListener('click', () => {
    settings.range = Number(/** @type {HTMLElement} */ (chip).dataset.range);
    saveSettings();
    render();
  });
}

for (const chip of document.querySelectorAll('[data-order]')) {
  chip.addEventListener('click', () => {
    settings.order = /** @type {ChapterOrder} */ (/** @type {HTMLElement} */ (chip).dataset.order);
    saveSettings();
    render();
  });
}

$('chapter-episode').addEventListener('change', () => {
  settings.ep = /** @type {HTMLSelectElement} */ ($('chapter-episode')).value;
  saveSettings();
  render();
});

$('chart').addEventListener('pointerleave', hideTip);
// A tap anywhere else puts the tooltip away, as there is no pointer to leave on a phone.
document.addEventListener('pointerdown', (event) => {
  if (!(/** @type {Element} */ (event.target).closest('.hit'))) hideTip();
});

new ResizeObserver(() => { if (stats) drawChart(studyDay(new Date())); }).observe($('chart-box'));
new ResizeObserver(() => { if (stats?.vocabulary?.length) drawVocabChart(stats.vocabulary, studyDay(new Date())); }).observe($('vocab-chart-box'));
// Back on the page after listening elsewhere: the numbers have moved on.
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

loadSettings();
if (![7, 30, 90].includes(settings.range)) settings.range = 7;
await load();
