import { compile, formatSource, FormatMode } from '../src';

const texts = (src: string): string[] =>
  [...compile(src).all()].map((o) => o.text + (Object.keys(o.tags).length ? ' ' + JSON.stringify(o.tags) : '')).sort();

describe('long form parsing', () => {
  test('the sketch, written in long form', () => {
    const src = `branch main
  one of
    Hello
    Oh, Hi
  ref greeting

branch greeting
  one of
    sequence
      How
      one of
        are you
        sequence
          's
          one of
            it
            everything
    sequence
      What
      one of
        is new
        is going on
`;
    const short = `main = [Hello|Oh, Hi] $greeting
greeting = [How [are you|'s [it|everything]]|What [is new|is going on]]`;
    expect(texts(src)).toEqual(texts(short));
    expect(compile(src).count).toBe(10n);
  });

  test('forms mix freely in one file and inside one definition', () => {
    const src = `greeting = Hello | Hi
branch main
  ref greeting
  one of
    friend
    [there|you]
  tight
    "!"
`;
    expect(texts(src)).toEqual(['Hello friend!', 'Hello there!', 'Hello you!', 'Hi friend!', 'Hi there!', 'Hi you!']);
  });

  test('nothing, quoting and reserved words', () => {
    const src = `branch main
  one of
    Good morning!
    nothing
  How are you?
`;
    expect(texts(src)).toEqual(['Good morning! How are you?', 'How are you?']);
    expect(texts('branch main\n  "nothing"\n')).toEqual(['nothing']);
    expect(texts('branch main\n  one of\n    "one of"\n    "ref x"\n')).toEqual(['one of', 'ref x']);
  });

  test('tight glues pieces, sequence joins them', () => {
    expect(texts('branch main\n  tight\n    a\n    b\n')).toEqual(['ab']);
    expect(texts('branch main\n  sequence\n    a\n    b\n')).toEqual(['a b']);
  });

  test('any order, repeat and transform', () => {
    const src = `hex = [0..9|A..F]
branch a
  any order
    delimiter ""
    foo
    bar
branch b
  repeat 3
    delimiter "-"
    x
branch c
  transform lower | upper
    Foo
branch main
  ref a
  ref b
  ref c
`;
    const p = compile(src);
    expect(p.count).toBe(4n);
    expect(texts(src)).toContain('foobar x-x-x foo');
    expect(texts(src)).toContain('barfoo x-x-x FOO');
  });

  test('tags, guards and values', () => {
    const src = `branch main
  Excuse me,
  one of
    sequence
      what
      tag q
    that
  is really neat
  one of
    when q
      ?
    otherwise
      .
`;
    expect(texts(src)).toEqual(['Excuse me, that is really neat.', 'Excuse me, what is really neat? {"q":true}']);
    const v = `branch main
  one of
    sequence
      Server is down
      tag severity = 5
    Disk is at 80%
`;
    expect(texts(v)).toContain('Server is down {"severity":5}');
  });

  test('when not and value guards', () => {
    const src = `branch main
  one of
    sequence
      a
      tag x
    b
  one of
    when not x
      no
    when x
      yes
`;
    expect(texts(src)).toEqual(['a yes {"x":true}', 'b no']);
  });

  test('delimiter inside a branch', () => {
    const src = `branch main
  delimiter " AND "
  a
  b
`;
    expect(texts(src)).toEqual(['a AND b']);
  });

  test('errors', () => {
    expect(() => compile('branch main\n')).toThrow(/needs indented lines/);
    expect(() => compile('branch main\n  one of\n')).toThrow(/needs indented lines/);
    expect(() => compile('branch main\n  one of\n      a\n    b\n')).toThrow(/Inconsistent indentation/);
    expect(() => compile('branch main\n  one of\n    tag q\n    a\n')).toThrow(/belongs inside an option/);
    expect(() => compile('branch main\n  nothing\n    a\n')).toThrow(/cannot have indented lines/);
    expect(() => compile('branch main\n  when q\n    a\n')).toThrow(/belong directly under 'one of'/);
  });
});

const CORPUS: string[] = [
  `main = [Hello|Oh, Hi] $greeting
greeting = [How [are you|'s [it|everything]]|What [is new|is going on]]`,
  'main = Hello [world|friend]!',
  'main = [Good morning!|] How are you?',
  'main = All personnel [must have a parents signature & ages 18 and younger]',
  'main = Example DNA Sequence [[A & T][G & C]; delimiter=""]',
  'hex = [0..9|A..F]\nmain = #$hex{3}',
  'main = [a|b]{2..3}',
  'main = [x]{3; delimiter="-"}',
  'main = [Foo]:[lower|upper] bar',
  'main = Excuse me, [what @q|that] is really neat [@q: ?|@else: .]',
  'main = [a @x|b @y] [@x: 1|@y: 2]',
  'main = [Server is down @severity=5|Disk is at 80% @severity=1]',
  'greeting = Hello | Hi | Hey\nmain = $greeting there',
  'letters.B = b\nletters.C = c\nmain = A [$letters.B|$letters.C]',
  'x = hello world\nmain = $x:capitalize and $x:upper',
  'main = [Good|Bad]day',
  'main = a\\@b and \\$5 and \\[x\\]',
  'main = [[a|b] & c]',
  "x = A\nmain = $x's thing",
  'x = [p|q]\nmain = $x{2}',
  'a = [A|B]\nb = [X|Y]\nc = [1|2]\nmain = [$a|$b] $c',
  'main = [a @k=1|b @k=2] [@k=1: one|@k=2: two]',
  'main = [@!x: no|@x: yes]',
  'main = one [two|three; delimiter=", "] four',
  'main = [a|b] [c|d] [e|f]',
  'main = Pack [tent & stove & map; delimiter=", " last=" and "].',
  'main = [very]{2..3; delimiter=", " last=" and "}',
];

describe('formatter round trips', () => {
  const modes: FormatMode[] = ['short', 'long', 'auto'];

  for (const src of CORPUS) {
    for (const mode of modes) {
      test(`${mode}: ${src.split('\n')[0]!.slice(0, 50)}`, () => {
        const before = texts(src);
        const count = compile(src).count;
        const { output, skipped } = formatSource(src, mode);
        expect(skipped).toEqual([]);
        expect(compile(output).count).toBe(count);
        expect(texts(output)).toEqual(before);
        // Converting again changes nothing.
        expect(formatSource(output, mode).output).toBe(output);
        // And a trip through the other form still means the same thing.
        const other = formatSource(output, mode === 'short' ? 'long' : 'short').output;
        expect(texts(other)).toEqual(before);
        expect(texts(formatSource(other, 'short').output)).toEqual(before);
      });
    }
  }

  test('ranges stay ranges through every conversion', () => {
    const src = 'hex = [0..9|A..F]\nroom = Room [1..2000]\nmain = #$hex{3} $room';
    const long = formatSource(src, 'long').output;
    expect(long).toContain('[0..9]');
    expect(long).toContain('[1..2000]');
    expect(long.length).toBeLessThan(300);
    const back = formatSource(long, 'short').output;
    expect(back).toContain('0..9');
    expect(back.length).toBeLessThan(120);
    expect(compile(back).count).toBe(compile(src).count);
  });

  test('long form output looks like long form', () => {
    const { output } = formatSource('greeting = [Hello|Hi] [world|friend]!', 'long');
    expect(output).toBe(`branch greeting
  one of
    Hello
    Hi
  tight
    one of
      world
      friend
    !`);
  });

  test('short form output is bracket-free when the whole definition is a choice', () => {
    const { output } = formatSource('branch greeting\n  one of\n    Hello\n    Hi\n    Hey\n', 'short');
    expect(output.trim()).toBe('greeting = Hello | Hi | Hey');
  });

  test('auto keeps small definitions short and expands big ones', () => {
    const big = 'main = [a [b [c [d|e]|f]|g]|h] and some more text so that this line gets long enough to expand';
    expect(formatSource('main = [a|b] c', 'auto').output).toBe('main = [a|b] c');
    expect(formatSource(big, 'auto').output.startsWith('branch main')).toBe(true);
  });

  test('comments, settings, imports and anonymous expressions are left alone', () => {
    const src = `# header comment
delimiter = " "
x = [a|b]
# about y
y = [c|d]
main = $x $y
`;
    const { output, changed } = formatSource(src, 'long');
    expect(output.startsWith('# header comment\ndelimiter = " "\nbranch x')).toBe(true);
    expect(output).toContain('# about y');
    expect(changed).toEqual(['x', 'y', 'main']);
  });

  test('a definition with a comment inside is skipped, not damaged', () => {
    const src = 'branch x\n  # keep me\n  one of\n    a\n    b\nmain = $x\n';
    const { output, skipped } = formatSource(src, 'short');
    expect(skipped.map((s) => s.name)).toEqual(['x']);
    expect(output).toContain('# keep me');
  });

  test('a line break in text converts to short form as \\n', () => {
    const src = 'branch main\n  "line one\\nline two"\n';
    const { output, skipped } = formatSource(src, 'short');
    expect(skipped).toEqual([]);
    expect(output.trim()).toBe('main = line one\\nline two');
    expect([...compile(output).all()][0]!.text).toBe('line one\nline two');
  });
});

describe('formatSource with names', () => {
  test('converts only the named definitions', () => {
    const src = 'a = [x|y]\nb = [p|q]\nmain = $a $b';
    const { output, changed } = formatSource(src, 'long', ['b']);
    expect(changed).toEqual(['b']);
    expect(output.startsWith('a = [x|y]\nbranch b')).toBe(true);
  });
});

describe('an unnamed main', () => {
  test('expands to branch main and back', () => {
    const long = formatSource('Hello [world|friend]!', 'long');
    expect(long.changed).toEqual(['main']);
    expect(long.output.startsWith('branch main\n')).toBe(true);
    expect([...compile(long.output).all()].map((o) => o.text)).toEqual(['Hello world!', 'Hello friend!']);
    expect(formatSource(long.output, 'short').output).toBe('main = Hello [world|friend]!');
    // Already short: nothing to do.
    expect(formatSource('Hello [a|b]', 'short').changed).toEqual([]);
  });
});
