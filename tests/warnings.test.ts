import { compile } from '../src';

const warn = (src: string): string[] => compile(src).warnings.map((w) => w.message);

describe('warnings for code that does not do what it looks like', () => {
  test('repeats and transforms after plain text', () => {
    expect(warn('It was very{2} good')[0]).toMatch(/"very\{2\}" is printed as written.*\[very\]\{2\}/);
    expect(warn('Hello world:upper')[0]).toMatch(/\[world\]:upper/);
    expect(warn('It was [very]{2} good')).toEqual([]);
    expect(warn('[Hello]:upper')).toEqual([]);
  });

  test('inline code and settings outside brackets', () => {
    expect(warn('Say ${x}')[0]).toMatch(/no inline code/);
    expect(warn('[a & b]; delimiter="-"')[0]).toMatch(/settings only work at the end/);
    expect(warn("[a & b; delimiter=', ']")[0]).toMatch(/double quotes/);
  });

  test('a tag in the middle of text, and a tag on a whole branch', () => {
    expect(warn('email me @bob please')[0]).toMatch(/"@bob" is a tag, not text.*\\@bob/);
    expect(warn('main = Hello @x')[0]).toMatch(/"@x" is a tag/);
    expect(warn('main = [what @q|that] [@q: ?|@else: .]')).toEqual([]);
  });

  test('guards: else not last, and nothing to fall back on', () => {
    expect(warn('[x @q|y] [@else: E|@q: Q]')[0]).toMatch(/Put it last/);
    expect(warn('[x @q|y] [@q: yes]')[0]).toMatch(/nothing to pick and the result is dropped/);
    expect(warn('[x @q|y] [@q: yes|@else: no]')).toEqual([]);
  });

  test('positions are reported', () => {
    const w = compile('main = fine\nother = very{2}').warnings[0]!;
    expect(w.line).toBe(2);
  });
});

describe('error messages that suggest the fix', () => {
  test('unknown references', () => {
    expect(() => compile('main = $names\nname = x')).toThrow(/use brackets: \[\$name\]s/);
    expect(() => compile('main = $letters\nletters.A = a\nletters.B = b')).toThrow(/pick one: \$letters.A, \$letters.B/);
    expect(() => compile('main = $greting\ngreeting = hi')).toThrow(/Did you mean \$greeting\?/);
  });

  test('unknown transform, missing entry point, any-order tags', () => {
    expect(() => compile('[Foo]:upr')).toThrow(/Transforms: lower, upper/);
    expect(() => compile('a = x\nb = y')).toThrow(/--entry NAME\. Its branches: a, b/);
    expect(() => compile('[a @t & b]')).toThrow(/Wrap it in brackets, as in \[\[a @t\] & b\]/);
  });
});
