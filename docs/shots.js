// @ts-check
// An app interface's lines on their screens: which screenshots a chapter shows, and where on one a
// line sits. Frames are kept in the screen's points and placed in percent of the picture, so the box
// lands on the line at whatever size the screenshot is drawn.

/** @typedef {[string, number, number, number, number] | null} Place `[shot, x, y, width, height]`, or null for a line with no place. */

/**
 * The screenshots of a chapter, in the order its lines first appear on them: one screen scrolled
 * down, top to bottom.
 * @param {Place[]} places per line
 * @param {{ from: number, to: number }} chapter
 * @returns {string[]}
 */
export function chapterShots(places, { from, to }) {
  /** @type {string[]} */
  const shots = [];
  for (let line = from; line <= to; line += 1) {
    const shot = places[line]?.[0];
    if (shot && !shots.includes(shot)) shots.push(shot);
  }
  return shots;
}

/**
 * Where a line's frame goes on its screenshot, in percent of the picture, a few points wider than the
 * text so the box sits around it rather than on it, and never past the screen's edge.
 * @param {number[]} box `[x, y, width, height]` in points
 * @param {{ width: number, height: number }} screen in points
 */
export function framePercent([x, y, w, h], { width, height }, pad = 4) {
  const left = Math.max(0, x - pad);
  const top = Math.max(0, y - pad);
  const right = Math.min(width, x + w + pad);
  const bottom = Math.min(height, y + h + pad);
  const percent = (/** @type {number} */ v, /** @type {number} */ of) => Math.round((v / of) * 10000) / 100;
  return { left: percent(left, width), top: percent(top, height), width: percent(right - left, width), height: percent(bottom - top, height) };
}
