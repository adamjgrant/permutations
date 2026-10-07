// Build, dev server and test runner for the web app. Usage:
//   node build.mjs            one-off build into dist/
//   node build.mjs --serve    live rebuild and static server (PORT, default 5173)
//   node build.mjs --test     bundle tests with esbuild and run them with node:test
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const args = new Set(process.argv.slice(2));

function copyStatic() {
  mkdirSync(dist, { recursive: true });
  for (const f of ['index.html', 'style.css']) cpSync(join(root, 'public', f), join(dist, f));
}

const appOptions = {
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  outfile: join(dist, 'app.js'),
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
};
if (!args.has('--serve')) appOptions.minify = true;

if (args.has('--test')) {
  const out = join(root, '.test-out');
  rmSync(out, { recursive: true, force: true });
  const entries = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.ts')).map((f) => join(root, 'tests', f));
  await esbuild.build({ entryPoints: entries, bundle: true, platform: 'node', format: 'cjs', outdir: out, logLevel: 'warning' });
  const files = readdirSync(out).filter((f) => f.endsWith('.js')).map((f) => join(out, f));
  const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  rmSync(out, { recursive: true, force: true });
  process.exit(r.status ?? 1);
} else if (args.has('--serve')) {
  copyStatic();
  const ctx = await esbuild.context(appOptions);
  await ctx.watch();
  const port = Number(process.env.PORT ?? 5173);
  const { hosts, port: p } = await ctx.serve({ servedir: dist, port, host: '127.0.0.1' });
  console.log(`Serving http://${hosts[0]}:${p}/ (rebuilds on change; static files are copied at start)`);
  const { watch } = await import('node:fs');
  watch(join(root, 'public'), () => copyStatic());
} else {
  copyStatic();
  await esbuild.build(appOptions);
}
