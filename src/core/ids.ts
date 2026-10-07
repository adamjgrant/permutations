let counter = 1;

/** Unique node ids, used by the engine to memoize counts per node. */
export function newId(): number {
  return counter++;
}
