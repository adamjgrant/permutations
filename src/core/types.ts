// Syntax tree for the Permutations DSL. Every node carries its source range so the
// chart editor can turn edits into text patches instead of regenerating code.

export type Range = [number, number];

export interface Tag {
  name: string;
  value?: string | undefined;
}

export type Guard =
  | { kind: 'else' }
  | { kind: 'tag'; name: string; negate: boolean; value?: string | undefined };

export interface TextNode {
  kind: 'text';
  id: number;
  value: string;
  range: Range;
}

export type Target =
  | { kind: 'def'; def: Def }
  | { kind: 'value'; value: string };

export interface RefNode {
  kind: 'ref';
  id: number;
  path: string;
  splat: boolean;
  range: Range;
  target?: Target | undefined;
}

export interface Piece {
  node: Node;
  /** True when the source had whitespace between this piece and the previous one. */
  join: boolean;
}

export interface SeqNode {
  kind: 'seq';
  id: number;
  pieces: Piece[];
  /** Delimiter used for this sequence's own join points (defaults to the scope's). */
  joinDelim?: string | undefined;
  /** Delimiter pushed down to children (defaults to the scope's). */
  scopeDelim?: string | undefined;
  range: Range;
}

export interface Option {
  seq: SeqNode;
  tags: Tag[];
  guard?: Guard | undefined;
  range: Range;
}

export interface GroupNode {
  kind: 'group';
  id: number;
  options: Option[];
  delimiter?: string | undefined;
  /** True when written without brackets as a whole definition: `a = x | y`. */
  bare: boolean;
  range: Range;
}

export interface AnyOrderNode {
  kind: 'anyorder';
  id: number;
  items: SeqNode[];
  delimiter?: string | undefined;
  range: Range;
  /** Lazily built, one sequence per ordering (only needed when tags exist). */
  orderings?: SeqNode[] | undefined;
}

export interface RepeatNode {
  kind: 'repeat';
  id: number;
  inner: Node;
  min: number;
  max: number;
  delimiter?: string | undefined;
  /** One sequence per repeat count, min to max. */
  expanded: SeqNode[];
  range: Range;
}

export interface TransformNode {
  kind: 'transform';
  id: number;
  inner: Node;
  fns: string[];
  range: Range;
}

export type Node =
  | TextNode
  | RefNode
  | SeqNode
  | GroupNode
  | AnyOrderNode
  | RepeatNode
  | TransformNode;

export interface Def {
  name: string;
  body: Node;
  module: Module;
  range: Range;
}

export interface Module {
  /** Where this module came from, for error messages and relative imports. */
  path: string;
  source: string;
  defs: Map<string, Def>;
  /** `use lib` gives the namespace alias `lib`. */
  namespaces: Map<string, Module>;
  /** `from lib use a` gives the named import `a`. */
  named: Map<string, { module: Module; name: string }>;
  delimiter?: string | undefined;
  /** The single unnamed expression, if the file has one. */
  anonymous?: Def | undefined;
  hasTags: boolean;
}

export interface Output {
  text: string;
  tags: Record<string, string | number | true>;
}

export class PermError extends Error {
  constructor(message: string, public offset?: number, public line?: number, public col?: number) {
    super(message);
    this.name = 'PermError';
  }
}
