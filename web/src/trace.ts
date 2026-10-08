// Which boxes of the chart a traced result went through, so the chart can show how one example
// was made. Pure: takes the layout's boxes and the engine's trace, returns box ids.

import type { Trace } from '../../src/index';
import type { Box } from './layout';
import { inside, rowContext } from './nav';
import { alternatives } from './patch';

const BY_NODE = new Set(['text', 'ref', 'value']);

export function pathBoxes(boxes: Box[], tr: Trace): Set<string> {
  const on = new Set<string>();
  const nodes = new Set<unknown>(tr.nodes);

  // The alternatives taken: one row per pick (a range alternative stands for many options).
  for (const pk of tr.picks) {
    const opt = pk.group.options[pk.option];
    const alts = alternatives(pk.group);
    const ai = alts.findIndex((a) => a.option === opt || (opt !== undefined && a.options.includes(opt)));
    for (const r of boxes) if (r.kind === 'row' && r.node === pk.group && r.index === ai) on.add(r.id);
  }
  // Every item of an any-order group on the path is used.
  for (const r of boxes) if (r.kind === 'row' && r.node && r.node.kind === 'anyorder' && nodes.has(r.node)) on.add(r.id);
  // Frames for repeats, transforms and any-order groups on the path.
  for (const f of boxes) if (f.kind === 'frame' && f.node && nodes.has(f.node)) on.add(f.id);
  // Text, references and host values the walk went through.
  for (const b of boxes) if (BY_NODE.has(b.kind) && b.node && nodes.has(b.node)) on.add(b.id);

  const defs = boxes.filter((b) => b.kind === 'def');
  const mainDef = defs[0];
  // Other leaves (ranges, empty alternatives, chips) belong to their alternative, or, outside
  // any alternative, to the frame or definition around them.
  for (const b of boxes) {
    if (on.has(b.id) || b.kind === 'def' || b.kind === 'frame' || b.kind === 'row' || BY_NODE.has(b.kind)) continue;
    if (b.kind === 'sectionLabel' || b.kind === 'nsHeader') continue;
    const row = rowContext(boxes, b).row;
    if (row) {
      if (on.has(row.id)) on.add(b.id);
      continue;
    }
    if (b.kind === 'defLabel') continue;
    const frame = boxes.filter((f) => f.kind === 'frame' && inside(b, f)).sort((p, q) => p.w * p.h - q.w * q.h)[0];
    if (frame ? on.has(frame.id) : true) on.add(b.id);
  }

  // Containers holding anything on the path, and the definitions the path entered.
  const lit = boxes.filter((b) => on.has(b.id));
  for (const c of boxes) {
    if (c.kind !== 'frame' && c.kind !== 'def') continue;
    if (lit.some((b) => b.id !== c.id && inside(b, c))) on.add(c.id);
  }
  if (mainDef) on.add(mainDef.id);
  for (const d of defs) {
    if (!on.has(d.id)) continue;
    const label = boxes.find((b) => b.kind === 'defLabel' && b.name === d.name);
    if (label) on.add(label.id);
  }
  return on;
}
