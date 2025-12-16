
import { Engine } from '../src/engine/engine';

describe('Comment Support Verification2', () => {
  test('Comments should be ignored', () => {
    const script = [
      '# This is a comment',
      'main = [ A ]'
    ].join('\n');

    const engine = new Engine();
    engine.compile(script);
    const result = engine.generate('main');

    expect(result.trim()).toBe('A');
  });
});
