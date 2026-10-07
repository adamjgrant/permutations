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
