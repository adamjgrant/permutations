export type TransformFn = (input: string) => string;

export const builtinTransforms: Record<string, TransformFn> = {
  lower: (s) => s.toLowerCase(),
  upper: (s) => s.toUpperCase(),
  // The first letter, past any opening punctuation: "(hello) world" gives "(Hello) world".
  capitalize: (s) => s.replace(/\p{L}/u, (c) => c.toUpperCase()),
  // The first letter of each word, words being what spaces and hyphens separate, so "don't
  // stop" gives "Don't Stop" and "well-known" gives "Well-Known". Digits stay as they are: "3rd".
  title: (s) => s.replace(/(^|[\s\-\u2010-\u2014])([^\p{L}\p{N}\s]*)(\p{L})/gu, (_m, sep: string, pre: string, c: string) => sep + pre + c.toUpperCase()),
  trim: (s) => s.trim(),
};
