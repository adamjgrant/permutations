export type TransformFn = (input: string) => string;

export const builtinTransforms: Record<string, TransformFn> = {
  lower: (s) => s.toLowerCase(),
  upper: (s) => s.toUpperCase(),
  capitalize: (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s),
  title: (s) => s.replace(/\b(\p{L})(\p{L}*)/gu, (_m, a: string, b: string) => a.toUpperCase() + b),
  trim: (s) => s.trim(),
};
