
import { Engine } from '../src/engine/engine';

describe('Whitespace Behavior Reproduction', () => {
  let engine: Engine;

  beforeEach(() => {
    engine = new Engine();
  });

  test('User Scenario: Greeting and Name', () => {
    const script = `
greeting = [ Hello | Hi | Welcome ]
name = [ user | stranger | friend ]
main = $greeting, $name!
    `;

    engine.compile(script);

    // Generate multiple times to cover different choices, though whitespace pattern should be consistent
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      results.add(engine.generate('main'));
    }

    console.log('--- RAW VALUES ---');
    results.forEach(r => {
      // Replace space with dot for visibility
      console.log(`"${r}" (length: ${r.length})`);
    });
    console.log('------------------');

    // We expect at least the spaces explicitly present in the choice options + the comma-space
    // " Hello " + ", " + " stranger " + "!"
    // " Hello ,  stranger !"
  });
});
