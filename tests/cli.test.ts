import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(__dirname, '../dist/cli.js');

function run(args: string[], cwd?: string) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', ...(cwd ? { cwd } : {}) });
  return { out: r.stdout, err: r.stderr, code: r.status };
}

let dir: string;
beforeAll(() => {
  if (!fs.existsSync(CLI)) throw new Error('Run `npm run build` first (npm test does this for you)');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-cli-'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('perm CLI', () => {
  test('--set replaces a branch of the same name, and an unused value is a warning', () => {
    fs.writeFileSync(path.join(dir, 'default.perm'), 'name = friend\nmain = Hi $name\n');
    expect(run(['default.perm'], dir).out).toBe('Hi friend\n');
    expect(run(['default.perm', '--set', 'name=Ann'], dir).out).toBe('Hi Ann\n');
    const typo = run(['default.perm', '--set', 'nmae=Ann'], dir);
    expect(typo.out).toBe('Hi friend\n');
    expect(typo.err).toMatch(/warning: The host value nmae is not used/);
  });

  test("an imported branch keeps its own file's delimiter, and inherits when the file has none", () => {
    fs.writeFileSync(path.join(dir, 'dash.perm'), 'delimiter = "-"\ngreet = [a] [b]\n');
    fs.writeFileSync(path.join(dir, 'plain.perm'), 'greet = [a] [b]\n');
    fs.writeFileSync(path.join(dir, 'usedash.perm'), 'from dash use greet\nmain = [x] $greet\n');
    fs.writeFileSync(path.join(dir, 'usens.perm'), 'use dash\nmain = [x] $dash.greet\n');
    fs.writeFileSync(path.join(dir, 'useplain.perm'), 'from plain use greet\nmain = [[x] $greet; delimiter="+"]\n');
    expect(run(['usedash.perm'], dir).out).toBe('x a-b\n');
    expect(run(['usens.perm'], dir).out).toBe('x a-b\n');
    expect(run(['useplain.perm'], dir).out).toBe('x+a+b\n');
  });

  test('--entry can start from an imported branch; a branch here that hides an imported one is a warning', () => {
    fs.writeFileSync(path.join(dir, 'shared.perm'), 'greeting = Hi | Hello\ncode = [1..3]\n');
    fs.writeFileSync(path.join(dir, 'uses.perm'), 'from shared use greeting\nuse shared\ngreeting = Yo\nmain = $greeting $shared.code\n');
    const r = run(['uses.perm', '--all'], dir);
    expect(r.out).toBe('Yo 1\nYo 2\nYo 3\n');
    expect(r.err).toMatch(/greeting is defined here and also brought in from shared.perm/);
    expect(run(['uses.perm', '--entry', 'shared.code', '--all', '-q'], dir).out).toBe('1\n2\n3\n');
  });

  test('--fn loads named exports, and says when a file adds none', () => {
    fs.writeFileSync(path.join(dir, 'fns.js'), 'module.exports = { shout: (t) => t.toUpperCase() + "!" };\n');
    fs.writeFileSync(path.join(dir, 'esm.mjs'), 'export default { whisper: (t) => t.toLowerCase() };\n');
    fs.writeFileSync(path.join(dir, 'none.js'), 'module.exports = 5;\n');
    expect(run(['[hi]:shout', '--fn', 'fns.js'], dir).out).toBe('HI!\n');
    expect(run(['[HI]:whisper', '--fn', 'esm.mjs'], dir).out).toBe('hi\n');
    expect(run(['[hi]', '--fn', 'none.js'], dir).err).toMatch(/adds no transforms/);
    const missing = run(['[hi]', '--fn', 'nope.js'], dir);
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/could not load nope.js/);
  });

  test('inline program, --all and --count', () => {
    expect(run(['Hello [world|friend]!', '--all']).out).toBe('Hello world!\nHello friend!\n');
    expect(run(['Hello [world|friend]!', '--count']).out).toBe('2\n');
  });

  test('-n gives distinct results, --json gives tags', () => {
    const lines = run(['[a|b|c|d]', '-n', '3']).out.trim().split('\n');
    expect(new Set(lines).size).toBe(3);
    const json = JSON.parse(run(['[x @sev=2|y]', '--all', '--json']).out);
    expect(json[0]).toEqual({ text: 'x', tags: { sev: 2 } });
  });

  test('files, imports, --entry, --set and --delimiter', () => {
    fs.writeFileSync(path.join(dir, 'lib.perm'), 'greeting = Hello | Hi\n');
    fs.writeFileSync(path.join(dir, 'main.perm'), 'from lib use greeting\nmain = $greeting $name\nother = x\n');
    expect(run(['main.perm', '--set', 'name=Sam', '--all'], dir).out).toBe('Hello Sam\nHi Sam\n');
    expect(run(['main.perm', '--entry', 'other', '--set', 'name=Sam'], dir).out).toBe('x\n');
    // The whole file must link, so an unknown reference is an error even outside the entry.
    expect(run(['main.perm', '--entry', 'other'], dir).err).toMatch(/Unknown reference \$name/);
    expect(run(['a [b|c]', '--all', '--delimiter', '+']).out).toBe('a+b\na+c\n');
  });

  test('errors exit non-zero with a position', () => {
    const r = run(['Hello [world']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Unclosed \[ \(line 1, column 7\)/);
    expect(run(['--bogus']).code).toBe(2);
  });

  test('--seed makes sampling repeatable, and - reads the program from stdin', () => {
    const a = run(['[a|b|c|d|e|f|g|h]', '-n', '4', '--seed', '42']).out;
    const b = run(['[a|b|c|d|e|f|g|h]', '-n', '4', '--seed', '42']).out;
    expect(a).toBe(b);
    expect(run(['[a|b]', '--seed', 'x']).code).toBe(2);
    const r = spawnSync('node', [CLI, '-', '--all'], { input: 'Hello [world|friend]!', encoding: 'utf-8' });
    expect(r.stdout).toBe('Hello world!\nHello friend!\n');
  });

  test('a missing file is an error, not a one-line program', () => {
    const r = run(['nosuchfile.perm', '--count']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/File not found: nosuchfile.perm/);
    expect(run(['Hello.']).out).toBe('Hello.\n');
  });

  test('--help and no arguments', () => {
    expect(run(['--help']).code).toBe(0);
    expect(run([]).code).toBe(2);
  });

  test('fmt prints by default and rewrites with -w', () => {
    const f = path.join(dir, 'f.perm');
    fs.writeFileSync(f, '# keep\ngreeting = [Hello|Hi] [world|friend]!\nmain = $greeting\n');
    const printed = run(['fmt', '--long', f]).out;
    expect(printed.startsWith('# keep\nbranch greeting')).toBe(true);
    expect(fs.readFileSync(f, 'utf-8')).toContain('greeting = [Hello|Hi]'); // unchanged
    run(['fmt', '--long', f, '-w']);
    expect(fs.readFileSync(f, 'utf-8')).toBe(printed);
    expect(run([f, '--count']).out).toBe('4\n');
    expect(run(['fmt', f]).code).toBe(2);
  });
});
