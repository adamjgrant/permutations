import { compile } from '../src';

const warn = (src: string): string[] => compile(src).warnings.map((w) => w.message);

describe('warnings for code that does not do what it looks like', () => {
  test('repeats and transforms after plain text', () => {
    expect(warn('It was very{2} good')[0]).toMatch(/"very\{2\}" is printed as written.*\[very\]\{2\}/);
    expect(warn('Hello world:upper')[0]).toMatch(/\[world\]:upper/);
    expect(warn('It was [very]{2} good')).toEqual([]);
    expect(warn('[very] {2}')[0]).toMatch(/with no space, as in \[word\]\{2\}/);
    // Escaped on purpose, or quoted in long form: no warning.
    expect(warn('a \\{2} b, very\\{2}, world\\:upper, \\${x}')).toEqual([]);
    expect(warn('branch main\n  "very{2} and ${x}"')).toEqual([]);
    expect(warn('branch main\n  very{2}')[0]).toMatch(/very\{2\}/);
    expect(warn('[Hello]:upper')).toEqual([]);
  });

  test('inline code and settings outside brackets', () => {
    expect(warn('Say ${x}')[0]).toMatch(/no inline code/);
    expect(warn('[a & b]; delimiter="-"')[0]).toMatch(/settings only work at the end/);
    // Inside brackets a malformed clause is an error, not text.
    expect(() => compile("[a & b; delimiter=', ']")).toThrow(/double quotes/);
  });

  test('a tag in the middle of text, and a tag on a whole branch, when nothing tests it', () => {
    expect(warn('email me @bob please')[0]).toMatch(/"@bob" is a tag: it is not printed, and no guard tests it.*\\@bob/);
    expect(warn('main = Hello @x')[0]).toMatch(/"@x" is a tag/);
    expect(warn('main = [what @q|that] [@q: ?|@else: .]')).toEqual([]);
    // Tested by a guard: the tag is meant, and it takes effect where it is written.
    expect(warn('main = Hi @casual there, [@casual: mate|@else: sir].')).toEqual([]);
    // Long-form tag lines are never mistaken for text.
    expect(warn('branch main\n  hello\n  tag t\n  there')).toEqual([]);
  });

  test('guards: else not last, and nothing to fall back on', () => {
    expect(warn('[x @q|y] [@else: E|@q: Q]')[0]).toMatch(/Put it last/);
    expect(warn('[x @q|y] [@q: yes]')[0]).toMatch(/nothing to pick and the result is dropped/);
    expect(warn('[x @q|y] [@q: yes|@else: no]')).toEqual([]);
  });

  test('guards are judged by what can really come before them', () => {
    // Every opening sets one of the two tags, so the fully guarded choice always has a pick.
    expect(warn('opening = [Hi @casual|Dear Sir @formal]\nmain = $opening, [@casual: cheers|@formal: regards]')).toEqual([]);
    expect(warn('[x @q|y @q] [@q: yes]')).toEqual([]);
    // A guard on a tag that is only set later never holds.
    expect(warn('[@q: Excuse me,|Hey,] [what @q|that] is it')[0]).toMatch(/The guard @q: never holds.*never picked/);
    expect(warn('[a @k=1|b @k=2] [@k=3: three|@else: other]')[0]).toMatch(/The guard @k=3: never holds/);
    expect(warn('[a @q] [@!q: never|always]')[0]).toMatch(/The guard @!q: never holds/);
    // A branch nothing uses is judged by its code alone.
    expect(warn('main = hi\nunused = [@q: yes]')[0]).toMatch(/nothing to pick/);
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

describe('tag values in results', () => {
  test('numbers, booleans and text', () => {
    const tags = compile('[a @k=5.5 @n=-2 @z=05 @yes=true @no=false @bare @word=low]').one().tags;
    expect(tags).toEqual({ k: 5.5, n: -2, z: '05', yes: true, no: false, bare: true, word: 'low' });
  });

  test('an any-order group that is too big for tags is reported where it is', () => {
    expect(() => compile('[[a @x] & b & c & d & e & f & g & h & i]')).toThrow(/9 items.*at most 8\. Split it into smaller groups \(line 1, column 1\)/);
  });
});

