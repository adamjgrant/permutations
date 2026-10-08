import type { GroupNode } from "../src/core/types";
import { compile, CompileOptions, PermError, seededRandom, formatSource } from '../src';

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

  test('\\n and \\t are a line break and a tab in short form too', () => {
    expect(texts('Dear Sam,\\nThanks.')).toEqual(['Dear Sam,\nThanks.']);
    expect(texts('a\\tb')).toEqual(['a\tb']);
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

  test('last joins the final two items: a, b and c', () => {
    expect(texts('Pack [tent & stove & map; delimiter=", " last=" and "]')).toContain('Pack stove, map and tent');
    expect(texts('[a & b; delimiter=", " last=" and "]')).toEqual(['a and b', 'b and a']);
    expect(texts('[a & [b|] & c; delimiter=", " last=" and "]')).toContain('a and c');
    expect(texts('[very]{3; delimiter=", " last=" and "}')).toEqual(['very, very and very']);
    expect(texts('[ho]{3; last="!"}')).toEqual(['hoho!ho']);
    expect(() => compile('[a|b; last=" and "]')).toThrow(/last joins the final two items/);
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

  test('ranges work in a bracket-free definition choice too', () => {
    expect(count('hex = 0..9 | A..F\nmain = $hex')).toBe(16n);
    // A definition that is exactly a range is a choice too.
    expect(count('v = 1..2\nmain = $v')).toBe(2n);
    expect(count('digit = 0..9\nmain = $digit')).toBe(10n);
  });

  test('a line without a name next to main is an error, not ignored', () => {
    expect(() => compile('main = Hello [world|friend]\nHow are you?')).toThrow(/Line 2 is not part of any branch/);
    expect(() => compile('main = Hello\n  world')).toThrow(/Line 2 is not part of any branch/);
    expect(count('Hello [world|friend]')).toBe(2n);
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
    expect(() => compile('a = x $a\nmain = $a')).toThrow(/cannot use itself/);
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

describe('steady sampling', () => {
  test('the same seed gives the same examples, with traces', () => {
    const p = compile("main = [Hello|Oh, Hi] $g\ng = [How [are you|'s [it|everything]]|What [is new|is going on]]");
    const a = p.sampleSteady(5, 42).map((o) => o.text);
    expect(p.sampleSteady(5, 42).map((o) => o.text)).toEqual(a);
    expect(new Set(a).size).toBe(5);
    for (const o of p.sampleSteady(5, 42)) expect(o.picks.length).toBeGreaterThan(0);
  });

  test('each complete path is equally likely', () => {
    // 4 paths: a, b c, b d, b e. Picking per choice uniformly would give a half the time.
    const p = compile('[a|b [c|d|e]]');
    const seen: Record<string, number> = {};
    for (let seed = 0; seed < 4000; seed++) {
      const t = p.sampleSteady(1, seed)[0]!.text;
      seen[t] = (seen[t] ?? 0) + 1;
    }
    for (const k of ['a', 'b c', 'b d', 'b e']) {
      expect(seen[k]).toBeGreaterThan(850);
      expect(seen[k]).toBeLessThan(1150);
    }
  });

  test('adding an alternative to one choice leaves the picks of the others alone', () => {
    const before = compile('[Hi|Hello|Hey] there, [Ann|Bob|Cat|Dan] and [Eve|Fay|Gil]. Nice [day|night].');
    const after = compile('[Hi|Hello|Hey] there, [Ann|Bob|Cat|Dan] and [Eve|Fay|Gil]. Nice [day|night|week].');
    let kept = 0;
    let total = 0;
    for (let seed = 0; seed < 40; seed++) {
      const a = before.sampleSteady(5, seed).map((o) => o.text.split(' Nice')[0]);
      const b = after.sampleSteady(5, seed).map((o) => o.text.split(' Nice')[0]);
      for (let i = 0; i < 5; i++) {
        total++;
        if (a[i] === b[i]) kept++;
      }
    }
    expect(kept / total).toBeGreaterThan(0.9);
  });

  test('a new alternative changes only the rows it wins, wherever it is added', () => {
    const before = compile('Dear [Sam|Alex|Jordan], thanks for [writing|getting in touch].');
    for (const after of [
      compile('Dear [Sam|Alex|Jordan|Robin], thanks for [writing|getting in touch].'),
      compile('Dear [Robin|Sam|Alex|Jordan], thanks for [writing|getting in touch].'),
    ]) {
      let same = 0;
      let rows = 0;
      for (let seed = 0; seed < 60; seed++) {
        const a = before.sampleSteady(5, seed).map((o) => o.text);
        const b = after.sampleSteady(5, seed).map((o) => o.text);
        for (let i = 0; i < 5; i++) {
          if (b[i]?.includes('Robin') || a.some((t, j) => j < i && t === b[i])) continue;
          rows++;
          if (a[i] === b[i]) same++;
        }
      }
      expect(same / rows).toBeGreaterThan(0.95);
    }
  });

  test('a new any-order item keeps the order of the others', () => {
    const before = compile('[a & b & c & d]');
    const after = compile('[a & b & c & d & e]');
    // The first row never redraws for a duplicate, so it shows the ordering itself.
    for (let seed = 0; seed < 60; seed++) {
      const a = before.sampleSteady(3, seed)[0]!.text;
      const b = after.sampleSteady(3, seed)[0]!.text.replace(/ ?e ?/, ' ').trim().replace(/ +/g, ' ');
      expect(b).toBe(a);
    }
  });

  test('tags and guards stay consistent', () => {
    const p = compile('Excuse me, [what @q|that] is really neat [@q: ?|@else: .]');
    const texts = new Set<string>();
    for (let seed = 0; seed < 50; seed++) for (const o of p.sampleSteady(2, seed)) texts.add(o.text);
    expect([...texts].sort()).toEqual(['Excuse me, that is really neat.', 'Excuse me, what is really neat?']);
  });

  test('small programs give everything', () => {
    expect(compile('[a|b|c]').sampleSteady(5, 1).map((o) => o.text).sort()).toEqual(['a', 'b', 'c']);
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

describe('ranges, quotes and host values', () => {
  test('a leading zero pads the numbers of a range', () => {
    const inOrder = (src: string): string[] => [...compile(src).all()].map((r) => r.text);
    expect(inOrder('[00..03]')).toEqual(['00', '01', '02', '03']);
    expect(inOrder('[8..11]')).toEqual(['8', '9', '10', '11']);
    expect(inOrder('[3..1]')).toEqual(['3', '2', '1']);
    expect(() => compile('[0..10000]')).toThrow(/at most 10000 \(line 1, column 2\)/);
    // Ranges written back keep their padding.
    expect(formatSource('main = [00..59]', 'long').output).toMatch(/\[00\.\.59\]/);
  });

  test('a closing curly quote takes no delimiter before it', () => {
    expect(texts('[“Hi] [”]')).toEqual(['“Hi”']);
  });

  test('a host value replaces a branch of the same name in the file you run', () => {
    expect(compile('name = friend\nmain = Hi $name', { values: { name: 'Ann' } }).one().text).toBe('Hi Ann');
    expect(compile('name = friend\nmain = Hi $name').one().text).toBe('Hi friend');
    const w = compile('main = Hi', { values: { who: 'x' } }).warnings;
    expect(w[0]?.message).toMatch(/host value who is not used/);
    expect(w[0]?.line).toBe(0);
  });
});


describe('the delimiter of an any-order group', () => {
  test('goes between the items only, like a repeat between its copies', () => {
    expect(texts('[x [1|2] & y; delimiter=" and "]')).toEqual(['x 1 and y', 'x 2 and y', 'y and x 1', 'y and x 2']);
    expect(texts('[[a @t] [b|c] & d; delimiter=", "]')).toContain('a b, d');
    expect(texts('[cat [1|2]]{2; delimiter=", "}')).toContain('cat 1, cat 2');
    // A choice's delimiter still reaches everything inside it.
    expect(texts('[[x [1|2] & y]; delimiter="-"]')).toContain('x-1-y');
  });
});

describe('steady examples can show one alternative', () => {
  test('when no row goes through it, the last row does', () => {
    const p = compile('main = Dear [Sam|Alex|Jordan|Robin|Kim|Lee|Max|Ana|Bo|Cy|Di|Ed], thanks for [writing|calling].');
    const group = p.ast.kind === 'seq' ? (p.ast.pieces.find((x) => x.node.kind === 'group')?.node as GroupNode) : undefined;
    expect(group).toBeDefined();
    for (let seed = 0; seed < 20; seed++) {
      const rows = p.sampleSteady(5, seed, { show: { group: group!, option: 11 } });
      expect(rows).toHaveLength(5);
      expect(rows.some((r) => r.text.startsWith('Dear Ed,'))).toBe(true);
      // The other rows are the usual ones.
      expect(rows.slice(0, 4).map((r) => r.text)).toEqual(p.sampleSteady(5, seed).slice(0, 4).map((r) => r.text));
    }
  });

  test('it finds its way through references to the alternative', () => {
    const p = compile('main = [$a|$b] end\na = [x|y]\nb = [u|v|w|NEW]');
    const b = p.definitions.find((d) => d.name === 'b')!;
    const body = b.body;
    const g = (body.kind === 'seq' ? body.pieces[0]!.node : body) as GroupNode;
    for (let seed = 0; seed < 10; seed++) {
      expect(p.sampleSteady(5, seed, { show: { group: g, option: 3 } }).some((r) => r.text === 'NEW end')).toBe(true);
    }
  });
});
