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
  let v = value.replace(/[\\\[\]|$@]/g, (c) => '\\' + c);
  // Line breaks and tabs are written as \n and \t, which short form reads back as them.
  v = v.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t');
  v = v.replace(/(^|\s)&(?=\s|$)/g, (_m, pre: string) => pre + '\\&');
  // Typed text that would read as a repeat or a transform stays text: {2}, world:upper.
  v = v.replace(/\{(?=\d)/g, '\\{').replace(/(?<=[\p{L}\p{N}]):(?=(?:lower|upper|capitalize|title|trim)\b)/gu, '\\:');
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

/** Offset of the first character of the line containing `offset`. */
export function lineStart(src: string, offset: number): number {
  const i = src.lastIndexOf('\n', offset - 1);
  return i === -1 ? 0 : i + 1;
}

/** Offset of the newline that ends the line containing `offset` (or the end of the source). */
export function lineEnd(src: string, offset: number): number {
  const i = src.indexOf('\n', offset);
  return i === -1 ? src.length : i;
}

/** Leading whitespace of the line containing `offset`. */
export function indentOf(src: string, offset: number): string {
  const s = lineStart(src, offset);
  const m = /^[ \t]*/.exec(src.slice(s, lineEnd(src, s))) as RegExpExecArray;
  return m[0];
}

/** True when nothing but whitespace follows `offset` on its line. */
export function isAtLineEnd(src: string, offset: number): boolean {
  return src.slice(offset, lineEnd(src, offset)).trim() === '';
}

/**
 * The indentation unit this file uses for long-form blocks: the extra indent of the first
 * indented line under a `branch` header. Falls back to two spaces.
 */
export function indentUnit(src: string): string {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const head = /^([ \t]*)branch[ \t]+\S/.exec(lines[i] as string);
    if (!head) continue;
    const next = lines[i + 1] as string;
    if (next.trim() === '') continue;
    const lead = (/^[ \t]*/.exec(next) as RegExpExecArray)[0];
    if (lead.length > (head[1] as string).length && lead.startsWith(head[1] as string)) return lead.slice((head[1] as string).length);
  }
  return '  ';
}
