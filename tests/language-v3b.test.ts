import { compile, formatSource } from '../src';

const all = (src: string, opts = {}): string[] => [...compile(src, opts).all()].map((o) => o.text);

describe('tags take effect where they are written', () => {
  test('short form: a guard later in the same alternative sees the tag', () => {
    expect(all('x @t [@t: yes|@else: no]')).toEqual(['x yes']);
    expect(all('Hi @casual there, [@casual: mate|@else: sir].')).toEqual(['Hi there, mate.']);
    expect(all('[@t x|y] [@t: T|@else: E]')).toEqual(['x T', 'y E']);
    // At the end of an alternative, as before.
    expect(all('[what @q|that] [@q: ?|@else: .]')).toEqual(['what?', 'that.']);
    // A later tag with the same name wins from where it is.
    expect(compile('a @k=1 b @k=2').one().tags).toEqual({ k: 2 });
  });

  test('long form: a tag line sets the tag for the lines after it', () => {
    expect(all('branch main\n  a\n  tag q\n  one of\n    when q\n      yes\n    otherwise\n      no')).toEqual(['a yes']);
    expect(all('branch main\n  one of\n    sequence\n      a\n      tag q\n      [@q: Q|@else: E]\n    b')).toEqual(['a Q', 'b']);
  });

  test('the formatter keeps them where they are', () => {
    const src = 'main = Hi @casual there, [@casual: mate|@else: sir].';
    expect(formatSource(src, 'short').output).toBe(src);
    const long = formatSource(src, 'long').output;
    expect(long).toContain('  Hi\n  tag casual\n  there,');
    expect(all(long)).toEqual(all(src));
  });
});

describe('ranges', () => {
  test('a definition that is exactly a range is a choice', () => {
    expect(all('digit = 0..9\nmain = $digit')).toHaveLength(10);
    expect(all('1..3')).toEqual(['1', '2', '3']);
  });

  test('a range can carry a guard or tags', () => {
    expect(all('[kid @kid|adult] [@kid: 1..2|@else: 18..19]')).toEqual(['kid 1', 'kid 2', 'adult 18', 'adult 19']);
    expect(compile('[1..2 @t|x]').one().text).toMatch(/^(1|2|x)$/);
    expect([...compile('[1..2 @t|x]').all()].map((o) => o.tags)).toEqual([{ t: true }, { t: true }, {}]);
    for (const mode of ['short', 'long'] as const) {
      const out = formatSource('main = [kid @kid|adult] [@kid: 1..2|@else: 18..19]', mode).output;
      expect(all(out)).toEqual(['kid 1', 'kid 2', 'adult 18', 'adult 19']);
    }
  });

  test('a character range stays within one kind of character', () => {
    expect(() => compile('[a..E]')).toThrow(/same kind/);
    expect(() => compile('[a..9]')).toThrow(/same kind/);
    expect(all('[a..c]')).toEqual(['a', 'b', 'c']);
  });
});

describe('settings that are written wrong are errors, not text', () => {
  test('in a clause', () => {
    expect(() => compile("[a & b; delimiter='-']")).toThrow(/double quotes/);
    expect(() => compile('[a & b; delimiter=", ", last=" and "]')).toThrow(/spaces, not commas/);
    expect(() => compile('[a & b; sep="-"]')).toThrow(/Unknown setting 'sep'/);
    expect(() => compile('[a]{2; delimiter=-}')).toThrow(/double quotes/);
    expect(() => compile('[a & b; delimiter="-" c]')).toThrow(/very end/);
    // Plain text with a semicolon is still text.
    expect(all('[a; b|c]')).toEqual(['a; b', 'c']);
  });

  test('on a delimiter line', () => {
    expect(() => compile("delimiter = '-'\nmain = a")).toThrow(/double quotes/);
    expect(() => compile('delimiter = ", " extra\nmain = a')).toThrow(/nothing after them/);
  });

  test('a definition with a name that is not valid', () => {
    expect(() => compile('greeting = Hi\nmy-name = Sam')).toThrow(/"my-name" is not a valid name/);
    expect(all('my\\-name \\= Sam')).toEqual(['my-name = Sam']);
  });
});

describe('spacing and transforms', () => {
  test('no delimiter next to a line break', () => {
    expect(all('branch main\n  Dear Sam,\n  "\\n\\n"\n  Thanks.')).toEqual(['Dear Sam,\n\nThanks.']);
  });

  test('a straight quote before a word opens a quotation; before a suffix it closes', () => {
    expect(all("She said [hi] 'loudly'.")).toEqual(["She said hi 'loudly'."]);
    expect(all("[Ann] 's car, [we] 're here")).toEqual(["Ann's car, we're here"]);
  });

  test('capitalize and title go by letters, in any language', () => {
    expect(all("[don't stop, it's l'été]:title")).toEqual(["Don't Stop, It's L'été"]);
    expect(all('[3rd well-known "quoted" place]:title')).toEqual(['3rd Well-Known "Quoted" Place']);
    expect(all('[(hello) world]:capitalize')).toEqual(['(Hello) world']);
  });

  test('a host transform that fails, or gives back something else, is reported', () => {
    const fns = { boom: () => { throw new Error('nope'); }, num: () => 5 as unknown as string };
    expect(() => compile('[a]:boom', { fns }).one()).toThrow(/The transform boom failed on "a": nope/);
    expect(() => compile('[a]:num', { fns }).one()).toThrow(/must give back text/);
  });
});

describe('results and warnings', () => {
  test('tag values that are numbers only when writing them as numbers keeps them', () => {
    expect(compile('[x @id=9007199254740993 @n=12 @f=1.50]').one().tags).toEqual({ id: '9007199254740993', n: 12, f: '1.50' });
  });

  test('a big any-order group gets a warning', () => {
    expect(compile('[a & b & c & d & e & f & g & h]').warnings[0]?.message).toMatch(/8 items, so it gives 40,320 orderings/);
    expect(compile('[a & b & c]').warnings).toEqual([]);
  });
});
