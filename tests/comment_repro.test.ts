
import { Engine } from '../src/engine/engine';

describe('Comment Support Verification2', () => {
  test('Comments should be ignored', () => {
    const script = `
# This is a comment
item=[A]
# Another comment
main=$item
    `;
    const engine = new Engine();
    engine.compile(script);
    const result = engine.generate('main');
    console.log('Result:', JSON.stringify(result));

    // Ideally, result should be "A"
    // Currently, it might be "\n# This is a comment\n..." attached to previous or next?
    expect(result.trim()).toBe('A');
  });
});
