
import { Engine } from '../src/engine/engine';

describe('Complex Logic Scenarios', () => {
  let engine: Engine;

  beforeEach(() => {
    engine = new Engine();
  });


  test('Variable Chaining & Resolution', () => {
    // Tests that variables can reference other variables deeply
    const script = `
part_a = [ A ]
part_b = [ $part_a | B ]
part_c = [ $part_b | C ]
main = $part_c`;

    engine.compile(script);

    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      // Trim results to ignore layout whitespace
      results.add(engine.generate('main').trim());
    }

    expect(results.has('A')).toBe(true);
    expect(results.has('B')).toBe(true);
    expect(results.has('C')).toBe(true);
  });

  test('Interpolation as Constants', () => {
    // Tests defining a constant via interpolation and using it
    // Use trimming to handle indentation
    // Note: Assignment preserves whitespace, so 'year = ...' includes the space.
    // We use 'year=...' to ensure no leading space in the variable value.
    const script = `
year=#{ 2025 }
version=#{ "v2.0" }
main = Copyright $year Version $version`;

    engine.compile(script);
    const result = engine.generate('main');

    // "Copyright " + "2025" + " Version " + "v2.0"
    expect(result.trim()).toBe('Copyright 2025 Version v2.0');
  });

  test('Flag Logic & Short-circuiting', () => {
    const script = `
line = [ START #active | SKIP ] : #{ active ? "IS_ACTIVE" : "NOT_ACTIVE" }
main = $line`;

    engine.compile(script);

    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const res = engine.generate('main').replace(/\s+/g, ' ').trim();
      results.add(res);
    }

    expect(results.has('START : IS_ACTIVE')).toBe(true);
    expect(results.has('SKIP : NOT_ACTIVE')).toBe(true);
  });

  test('Complex Object Return (Metadata)', () => {
    const script = `
meta = #{ { key: "value" } }
main = Text $meta`;

    engine.compile(script);
    const result = engine.generate('main');
    expect(result.trim()).toBe('Text');
  });
});
