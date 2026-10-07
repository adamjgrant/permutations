import assert from 'node:assert/strict';
import { visit } from '../../src/index';
import type { AnyOrderNode, GroupNode, Node, RefNode, TextNode } from '../../src/core/types';
import { analyze } from '../src/model';
import { applyPatches, ChoiceNode, EditResult } from '../src/patch';

export function nodes<T extends Node>(src: string, kind: T['kind']): T[] {
  const a = analyze(src);
  const out: T[] = [];
  const seen = new Set<unknown>();
  for (const d of [a.main, ...a.others]) {
    visit(d.body, (n) => {
      if (n.kind === kind && !seen.has(n)) {
        seen.add(n);
        out.push(n as T);
      }
    });
  }
  return out;
}
export const choices = (src: string): ChoiceNode[] => [...nodes<GroupNode>(src, 'group'), ...nodes<AnyOrderNode>(src, 'anyorder')].sort((a, b) => a.range[0] - b.range[0]);
export const groups = (src: string): GroupNode[] => nodes<GroupNode>(src, 'group').sort((a, b) => a.range[0] - b.range[0]);
export const texts = (src: string): TextNode[] => nodes<TextNode>(src, 'text');
export const refs = (src: string): RefNode[] => nodes<RefNode>(src, 'ref');

export function run(src: string, r: EditResult | { error: string } | undefined): string {
  assert.ok(r, 'edit refused');
  assert.ok(!('error' in r), 'edit failed: ' + ('error' in r ? r.error : ''));
  return applyPatches(src, r.patches);
}

/** Every result with its tags, sorted: two programs with the same value mean the same thing. */
export function meaning(src: string): string {
  const a = analyze(src);
  const rows = [...a.program.all({ limit: 5000 })].map((o) => JSON.stringify([o.text, o.tags]));
  return rows.sort().join('\n');
}
export const count = (src: string): bigint => analyze(src).program.count;
