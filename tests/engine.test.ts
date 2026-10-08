import { compile, CompileOptions, PermError, seededRandom } from '../src';

const texts = (src: string, opts?: CompileOptions): string[] =>
  [...compile(src, opts).all()].map((o) => o.text).sort();

const count = (src: string, opts?: CompileOptions): bigint => compile(src, opts).count;

/** Small deterministic RNG so sampling tests are repeatable. */
function lcg(seed = 12345): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('basics', () => {
  test('choice and trailing punctuation', () => {
    expect(texts('Hello [world|friend]!')).toEqual(['Hello friend!', 'Hello world!']);
  });

  test('plain text is itself', () => {
    expect(texts('Good morning')).toEqual(['Good morning']);
    expect(count('Good morning')).toBe(1n);
  });

  test('empty option never leaves a stray space', () => {
    expect(texts('[Good morning!|] How are you?')).toEqual(['Good morning! How are you?', 'How are you?']);
  });

  test('empty piece in the middle keeps the pending join', () => {
    expect(texts('A [x|]B')).toEqual(['A B', 'A xB']);
  });

  test('nested choices', () => {
    expect(texts('mood = [happy|sad [moderately|very]]\nmain = I am $mood')).toEqual([
      'I am happy',
      'I am sad moderately',
      'I am sad very',
    ]);
  });

  test('multi-line definitions', () => {
    const src = `mood = [
  happy |
  sad [moderately|very]
]
main = I feel $mood.`;
    expect(texts(src)).toEqual(['I feel happy.', 'I feel sad moderately.', 'I feel sad very.']);
  });

  test('definitions without brackets', () => {
    const src = 'greeting = Hello | Hi | Hey\nmain = $greeting';
    expect(texts(src)).toEqual(['Hello', 'Hey', 'Hi']);
  });

  test('comments, but hashtags mid-line survive', () => {
    const src = '# a comment\nmain = Buy now #sale';
    expect(texts(src)).toEqual(['Buy now #sale']);
  });

  test('escapes and dollar amounts', () => {
    expect(texts('Price: \\$5 \\[approx\\]')).toEqual(['Price: $5 [approx]']);
    expect(texts('costs $5')).toEqual(['costs $5']);
  });

  test("a '|' in a bracket-free expression is text", () => {
    expect(texts('a | b')).toEqual(['a | b']);
  });
});

describe('sketch example and smart spacing', () => {
  const src = `main = [Hello|Oh, Hi] $greeting
greeting = [How [are you|'s [it|everything]]|What [is new|is going on]]`;

  test('suffix marks attach, spaces join', () => {
    expect(texts(src)).toEqual(
      [
        "Hello How are you",
        "Hello How's it",
        "Hello How's everything",
        'Hello What is new',
        'Hello What is going on',
        'Oh, Hi How are you',
        "Oh, Hi How's it",
        "Oh, Hi How's everything",
        'Oh, Hi What is new',
        'Oh, Hi What is going on',
      ].sort(),
    );
    expect(count(src)).toBe(10n);
  });
});

describe('references, namespaces, imports', () => {
  test('a reference inside a choice contributes its options', () => {
    expect(texts('a = [A|B]\nmain = [$a|C]')).toEqual(['A', 'B', 'C']);
  });

  test('a leading star is plain text', () => {
    expect(texts('a = [A|B]\nmain = *$a')).toEqual(['*A', '*B']);
  });

  test('A or B then C', () => {
    const src = 'a = [A|B]\nb = [X|Y]\nc = [1|2]\nmain = [$a|$b] $c';
    expect(count(src)).toBe(8n);
    expect(texts(src)).toContain('X 2');
  });

  test('dotted namespaces', () => {
    const src = 'letters.B = b\nletters.C = c\nmain = A [$letters.B|$letters.C]';
    expect(texts(src)).toEqual(['A b', 'A c']);
  });

  test('a dot only continues a name when a letter follows', () => {
    expect(texts('name = Sam\nmain = Hi $name.')).toEqual(['Hi Sam.']);
  });

  test('use and from-use imports', () => {
    const files: Record<string, string> = {
      '/p/lib.perm': 'greeting = [Hello|Hi]\nother = nope',
    };
    const load = (spec: string) => {
      const p = `/p/${spec}${spec.endsWith('.perm') ? '' : '.perm'}`;
      return files[p] !== undefined ? { path: p, source: files[p] as string } : undefined;
    };
    expect(texts('use lib\nmain = $lib.greeting there', { path: '/p/main.perm', load })).toEqual([
      'Hello there',
      'Hi there',
    ]);
    expect(texts('from lib use greeting\nmain = $greeting there', { path: '/p/main.perm', load })).toEqual([
      'Hello there',
      'Hi there',
    ]);
  });

  test('circular imports are an error', () => {
    const files: Record<string, string> = {
      '/p/a.perm': 'use b\nmain = x',
      '/p/b.perm': 'use a\nmain = y',
    };
    const load = (spec: string) => {
      const p = `/p/${spec}.perm`;
      return files[p] !== undefined ? { path: p, source: files[p] as string } : undefined;
    };
    expect(() => compile(files['/p/a.perm'] as string, { path: '/p/a.perm', load })).toThrow(/Circular import/);
  });

  test('host values', () => {
    expect(texts('main = Copyright $year', { values: { year: '2026' } })).toEqual(['Copyright 2026']);
  });
});

describe('any order', () => {
  test('every ordering, joined with the delimiter', () => {
    expect(texts('All personnel [must have a parents signature & ages 18 and younger]')).toEqual([
      'All personnel ages 18 and younger must have a parents signature',
      'All personnel must have a parents signature ages 18 and younger',
    ]);
  });

  test('tight join with a local delimiter', () => {
    expect(texts('Example DNA Sequence [[A & T][G & C]; delimiter=""]')).toEqual([
      'Example DNA Sequence ATCG',
      'Example DNA Sequence ATGC',
      'Example DNA Sequence TACG',
      'Example DNA Sequence TAGC',
    ]);
  });

  test('items can be choices', () => {
    expect(count('[[a|b] & c]')).toBe(4n);
  });

  test('n! growth is counted without enumerating', () => {
    expect(count('[a & b & c & d & e & f & g & h & i & j]')).toBe(3628800n);
  });
});

describe('repeat and ranges', () => {
  test('hex color', () => {
    const p = compile('main = #$hex{6}\nhex = [0..9|A..F]');
    expect(p.count).toBe(16777216n);
    expect(p.one().text).toMatch(/^#[0-9A-F]{6}$/);
  });

  test('range of counts', () => {
    expect(count('[a|b]{2..3}')).toBe(12n);
  });

  test('repeat with a delimiter', () => {
    expect(texts('[x]{3; delimiter="-"}')).toEqual(['x-x-x']);
  });

  test('number and letter ranges', () => {
    expect(texts('[1..3]')).toEqual(['1', '2', '3']);
    expect(texts('[a..c]')).toEqual(['a', 'b', 'c']);
  });
});

describe('transforms', () => {
  test('choice of transforms', () => {
    expect(texts('[Foo]:[lower|upper]')).toEqual(['FOO', 'foo']);
  });

  test('on a reference', () => {
    expect(texts('x = hello world\nmain = $x:capitalize')).toEqual(['Hello world']);
    expect(texts('x = hello world\nmain = $x:title')).toEqual(['Hello World']);
  });

  test('custom transform from the host', () => {
    expect(texts('[abc]:rev', { fns: { rev: (s) => [...s].reverse().join('') } })).toEqual(['cba']);
  });

  test('unknown transform is an error', () => {
    expect(() => compile('[abc]:nope')).toThrow(/Unknown transform/);
  });
});

describe('tags and guards', () => {
  const q = 'Excuse me, [what @q|that] is really neat [@q: ?|@else: .]';

  test('later choice depends on an earlier one', () => {
    expect(texts(q)).toEqual(['Excuse me, that is really neat.', 'Excuse me, what is really neat?']);
  });

  test('counts follow the correlation, not the product', () => {
    expect(count('[a @x|b @y] [@x: 1|@y: 2]')).toBe(2n);
    expect(texts('[a @x|b @y] [@x: 1|@y: 2]')).toEqual(['a 1', 'b 2']);
  });

  test('negated guards', () => {
    expect(texts('[a @x|b] [@!x: no|@x: yes]')).toEqual(['a yes', 'b no']);
  });

  test('values travel with the output', () => {
    const p = compile('[Server is down @severity=5|Disk is at 80% @severity=1]');
    const out = [...p.all()];
    expect(out.find((o) => o.text === 'Server is down')?.tags).toEqual({ severity: 5 });
    expect(out.find((o) => o.text === 'Disk is at 80%')?.tags).toEqual({ severity: 1 });
  });

  test('guards can test a value', () => {
    expect(texts('[hi @k=1|yo @k=2] [@k=1: one|@k=2: two]')).toEqual(['hi one', 'yo two']);
  });

  test('too many any-order items with tags is a positioned error, not a crash', () => {
    const src = 'main = [a & b & c & d & e & f & g & h & i] [x @t|y]';
    try {
      void compile(src).count;
      throw new Error('expected an error');
    } catch (e) {
      expect(e).toBeInstanceOf(PermError);
      expect((e as PermError).message).toMatch(/has 9 items.*at most 8/);
      expect((e as PermError).offset).toBe(src.indexOf('['));
    }
  });

  test('any order inside a program that uses tags', () => {
    expect(texts('[a & b] [@q: x|@else: y]')).toEqual(['a b y', 'b a y']);
  });

  test('a dead end counts as zero and is reported', () => {
    expect(count('[@q: x]')).toBe(0n);
    expect(() => compile('[@q: x]').one()).toThrow(/no permutations/);
  });
});

describe('delimiters', () => {
  test('global setting in the file', () => {
    expect(texts('delimiter = " AND "\nmain = a [b|c]')).toEqual(['a AND b', 'a AND c']);
  });

  test('option overrides the file', () => {
    expect(texts('delimiter = " AND "\nmain = a [b|c]', { delimiter: '+' })).toEqual(['a+b', 'a+c']);
  });
});

describe('errors', () => {
  test('unclosed bracket', () => {
    expect(() => compile('Hello [world')).toThrow(/Unclosed/);
  });

  test('unclosed bracket points at the bracket', () => {
    expect(() => compile('main = Hello\nother = a [b|c] [d')).toThrow(/Unclosed \[ \(line 2, column 17\)/);
  });

  test('tags and guards know where they are written', () => {
    const src = 'main = [what @q|that] [@q: ?|@else: .]';
    const p = compile(src);
    const found: string[] = [];
    const walk = (n: any): void => {
      if (n.kind === 'group') for (const o of n.options) {
        for (const t of o.tags) found.push(src.slice(t.range[0], t.range[1]));
        if (o.guard) found.push(src.slice(o.guard.range[0], o.guard.range[1]));
        walk(o.seq);
      }
      if (n.kind === 'seq') n.pieces.forEach((pc: any) => walk(pc.node));
    };
    walk(p.ast);
    expect(found).toEqual(['@q', '@q:', '@else:']);
  });

  test('definitions are listed for the chart', () => {
    const p = compile('b = x\nmain = $b\na = y');
    expect(p.definitions.map((d) => d.name)).toEqual(['b', 'main', 'a']);
  });

  test('unmatched close bracket', () => {
    expect(() => compile('Hello world]')).toThrow(/Unmatched/);
  });

  test('cycles', () => {
    expect(() => compile('a = x $a\nmain = $a')).toThrow(/refer to themselves/);
  });

  test('unknown reference reports a position', () => {
    expect(() => compile('main = $nope')).toThrow(/Unknown reference \$nope \(line 1, column 8\)/);
  });

  test('an unknown plain name hints at host values, a dotted one does not', () => {
    expect(() => compile('main = $year')).toThrow(/pass --set year=\.\.\./);
    expect(() => compile('main = $a.b')).toThrow(/^Unknown reference \$a\.b \(line 1, column 8\)$/);
  });

  test('mixing | and & is rejected', () => {
    expect(() => compile('[a | b & c]')).toThrow(/Cannot mix/);
  });

  test('missing entry point', () => {
    expect(() => compile('a = x\nb = y')).toThrow(PermError);
  });

  test('--entry style override', () => {
    expect(texts('a = x\nb = y', { entry: 'b' })).toEqual(['y']);
  });
});

describe('sampling', () => {
  test('one() is uniform over complete permutations, not per node', () => {
    // 4 paths: a, bc, bd, be. Per-node picking would give 'a' 50% of the time.
    const p = compile('[a|b [c|d|e]]', { rng: lcg() });
    const seen: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const t = p.one().text;
      seen[t] = (seen[t] ?? 0) + 1;
    }
    expect(Object.keys(seen).sort()).toEqual(['a', 'b c', 'b d', 'b e']);
    for (const n of Object.values(seen)) {
      expect(n).toBeGreaterThan(850);
      expect(n).toBeLessThan(1150);
    }
  });

  test('sample(n) returns distinct results', () => {
    const p = compile('[a|b|c|d|e|f]', { rng: lcg(7) });
    const s = p.sample(5).map((o) => o.text);
    expect(new Set(s).size).toBe(5);
  });

  test('sample(n) returns everything when n covers the set', () => {
    const p = compile('[a|b|c]', { rng: lcg(3) });
    expect(p.sample(10).map((o) => o.text).sort()).toEqual(['a', 'b', 'c']);
  });

  test('sample(n) on a huge program does not enumerate', () => {
    const p = compile('main = #$hex{8}\nhex = [0..9|A..F]', { rng: lcg(9) });
    expect(p.count).toBe(4294967296n);
    expect(p.sample(5)).toHaveLength(5);
  });

  test('all() honors limit and distinct', () => {
    const p = compile('[a|a|b]');
    expect([...p.all({ limit: 2 })]).toHaveLength(2);
    expect([...p.all({ distinct: true })].map((o) => o.text)).toEqual(['a', 'b']);
  });

  test('at() is stable and covers the range', () => {
    const p = compile('[a|b] [c|d]');
    const all = Array.from({ length: Number(p.count) }, (_v, i) => p.at(BigInt(i)).text);
    expect(new Set(all).size).toBe(4);
    expect(() => p.at(4n)).toThrow(RangeError);
  });
});

describe('tracing a result', () => {
  test('trace reports the option taken in every choice and the text on the path', () => {
    const src = 'main = [Hello|Hi] $g\ng = [there|you [all|two]]';
    const p = compile(src);
    for (let i = 0n; i < p.count; i++) {
      const tr = p.trace(i);
      expect(tr.text).toBe(p.at(i).text);
      const texts = tr.nodes.filter((n) => n.kind === 'text').map((n) => (n as { value: string }).value);
      expect(texts.join(' ')).toBe(tr.text);
      // One pick per choice the path passed through.
      expect(tr.picks.length).toBe(tr.text.split(' ').length === 2 ? 2 : 3);
      for (const pk of tr.picks) expect(pk.option).toBeGreaterThanOrEqual(0);
    }
    expect(p.trace(0n).nodes.some((n) => n.kind === 'ref')).toBe(true);
  });

  test('a repeated choice is picked once per copy', () => {
    const p = compile('main = [a|b]{3}');
    const tr = p.trace(5n);
    expect(tr.picks).toHaveLength(3);
    expect(tr.picks.map((x) => ['a', 'b'][x.option]).join('')).toBe(tr.text);
  });

  test('sampleIndices with a seeded rng repeats, and stays put across an edit that keeps the shape', () => {
    const a = compile('[red|green|blue] [cat|dog|fox|owl]');
    const b = compile('[red|green|blue] [cat|dog|fox|bat]');
    const pick = (p: typeof a) => p.sampleIndices(5, seededRandom(9));
    expect(pick(a)).toEqual(pick(a));
    expect(pick(a)).toEqual(pick(b));
  });

  test('sampleIndices gives distinct texts that at() reproduces', () => {
    const p = compile('[a|b|c|d|e|f]', { rng: lcg(11) });
    const idx = p.sampleIndices(4);
    expect(new Set(idx.map((i) => p.at(i).text)).size).toBe(4);
  });
});

describe('ported v1 and v2 examples', () => {
  test('weather', () => {
    const src =
      "it's [windy|still|blustery], [cloudy|partly cloudy|clear skies], and [5|10|20|30|40|50|60|70|80|90|100]% chance of precipitation.";
    expect(count(src)).toBe(99n);
    expect(texts(src)).toContain("it's still, cloudy, and 50% chance of precipitation.");
  });

  test('polite sentence', () => {
    const src = `main = [Hello|Hi|Greetings], [[How are you?|How's it going?] I just wanted to [take the time to tell you|remind you] to $advice|$advice]
advice = [Please remember|Take caution] to [mind the gap|stay six feet apart|clean up your area] [at all times.|to be a good citizen.]`;
    expect(count(src)).toBe(180n);
    expect(texts(src)).toContain(
      "Greetings, How's it going? I just wanted to take the time to tell you to Please remember to clean up your area to be a good citizen.",
    );
    expect(texts(src)).toContain('Hi, Take caution to mind the gap at all times.');
  });
});
