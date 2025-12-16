
import { Engine } from '../src/engine/engine';
import * as path from 'path';
import * as fs from 'fs';

// Mock fs to avoid creating real files
jest.mock('fs');

describe('Import Functionality', () => {
  let engine: Engine;
  const baseDir = '/test/dir';

  beforeEach(() => {
    engine = new Engine();
    // Clear mocks
    (fs.existsSync as jest.Mock).mockClear();
    (fs.readFileSync as jest.Mock).mockClear();
    (fs.existsSync as jest.Mock).mockReturnValue(true); // Default exists
  });

  test('Simple Import (Explicit)', () => {
    const mainScript = `
import "lib"
main = $greeting`;
    const libScript = `greeting = [Hello]`;

    // Mock FS
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      // Main mock logic
      return true;
    });
    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('lib')) return libScript;
      return '';
    });

    engine.compile(mainScript, baseDir);
    const result = engine.generate('main');
    expect(result.trim()).toBe('Hello');
  });

  test('From Import (Named)', () => {
    const mainScript = `
from lib import greeting
main = $greeting`;
    const libScript = `
greeting = [Hi]
ignored = [Bad]`;

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('lib')) return libScript;
      return '';
    });

    engine.compile(mainScript, baseDir);
    const result = engine.generate('main');
    expect(result.trim()).toBe('Hi');

    // Verify 'ignored' is NOT imported
    expect(() => engine.generate('ignored')).toThrow();
  });

  test('Import with Star (Splat)', () => {
    const mainScript = `from lib import * \n main = $greeting`;
    const libScript = `greeting = [Welcome]`;

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('lib')) return libScript;
      return '';
    });

    engine.compile(mainScript, baseDir);
    expect(engine.generate('main').trim()).toBe('Welcome');
  });

  test('Import Implicit Extension', () => {
    const mainScript = `import "other"`;
    // We expect engine to try other.perm if other doesn't exist

    const existsMock = fs.existsSync as jest.Mock;
    existsMock.mockImplementation((p: string) => {
      // Mock path resolution check
      // Engine joins baseDir + module.
      // baseDir is /test/dir
      // module is other (after quote stripping)
      // target is /test/dir/other
      if (p === path.resolve('/test/dir/other')) return false;
      if (p === path.resolve('/test/dir/other.perm')) return true;
      return true;
    });

    (fs.readFileSync as jest.Mock).mockReturnValue('val=[1]');

    engine.compile(mainScript, baseDir);
    expect(existsMock).toHaveBeenCalledWith(expect.stringContaining('other.perm'));
  });

  test('Circular Dependency', () => {
    const scriptA = `import "B" \n valA=[A]`;
    const scriptB = `import "A" \n valB=[B]`;

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      const key = path.basename(p);
      if (key === 'A.perm' || key === 'A') return scriptA;
      if (key === 'B.perm' || key === 'B') return scriptB;
      return '';
    });

    // Should not hang/crash
    engine.compile(scriptA, baseDir);

    expect(engine.generate('valB').trim()).toBe('B');
  });
});
