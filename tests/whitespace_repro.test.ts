
import { Engine } from '../src/engine/engine';

describe('Whitespace Behavior Reproduction', () => {
  let engine: Engine;

  beforeEach(() => {
    engine = new Engine();
  });


  test('Whitespace Trimming (New Behavior)', () => {
    // Scenario 1: Loose formatting should now be auto-trimmed
    const looseScript = [
      'greeting = [ [ Hello ] ]',
      'name = [ [ stranger ] ]',
      'main = [ $greeting, $name! ]'
    ].join('\n');

    engine.compile(looseScript);
    const result = engine.generate('main');

    // Expected: "Hello, stranger!"
    // - Inner choices [ Hello ] and [ stranger ] are trimmed to "Hello" and "stranger"
    // - Main choice [ $greeting, $name! ] is trimmed (though references don't add padding)
    expect(result).toBe('Hello, stranger!');
  });

  test('Internal Whitespace Preservation', () => {
    // Scenario 2: Internal spaces should stay
    const script = [
      'greeting=[ [ Hello   World ] ]', // Internal spaces preserved
      'main=[ $greeting ]'
    ].join('\n');

    engine.compile(script);
    const result = engine.generate('main');

    expect(result).toBe('Hello   World');
  });
});
