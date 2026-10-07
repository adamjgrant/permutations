// Small helpers for working with source offsets. Offsets always index into the
// ORIGINAL source (the parser blanks comment lines with spaces, so they are stable).

export type Range = [number, number];

const isWs = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/** Shrink a range so it neither starts nor ends on whitespace. An all-whitespace range collapses to [start, start]. */
export function trimRange(src: string, range: Range): Range {
  let [s, e] = range;
  e = Math.min(e, src.length);
  while (s < e && isWs(src[s])) s++;
  while (e > s && isWs(src[e - 1])) e--;
  if (e <= s) return [range[0], range[0]];
  return [s, e];
}

export function contains(outer: Range, pos: number): boolean {
  return pos >= outer[0] && pos <= outer[1];
}

/**
 * Escape text so the parser reads it back as the same literal text.
 * Specials: backslash, brackets, pipe, dollar, at. A standalone `&` (which would split
 * an any-order group) and a leading `#` on a line (which would start a comment) are escaped too.
 */
export function escapeText(value: string, atLineStart = false): string {
  let v = value.replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
  v = v.replace(/[\\\[\]|$@]/g, (c) => '\\' + c);
  v = v.replace(/(^|\s)&(?=\s|$)/g, (_m, pre: string) => pre + '\\&');
  if (v.startsWith('#') && atLineStart) v = '\\' + v;
  return v;
}

export function isAtLineStart(src: string, offset: number): boolean {
  let i = offset - 1;
  while (i >= 0 && src[i] !== '\n') {
    if (!isWs(src[i])) return false;
    i--;
  }
  return true;
}
