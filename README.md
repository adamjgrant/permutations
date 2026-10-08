# Permutations (v3, in progress)

Write many possible texts in one condensed line, then count, sample or list them.

```
$ perm 'Hello [world|friend]!' --all
Hello world!
Hello friend!
```

- **`DSL.md`**: the language reference, for people and LLMs.
- **`SPEC.md`**: the design, including the web app's three panes (editable flow chart,
  code, example generations) and the open questions.

## Status

| Piece | State |
|---|---|
| Parser (short form), engine, counting, uniform sampling, CLI | working, tested |
| Long form, `perm fmt` | working, tested (round trips checked) |
| Web app: editable flow chart, code, examples; select-and-act strip; tracing; steady examples | working, tested (`web/`, unit and browser tests) |

## Use

```bash
npm install
npm run build
node dist/cli.js 'Hello [world|friend]!' -n 5
node dist/cli.js file.perm --count
```

Web app:

```bash
cd web && npm install && npm run dev   # http://localhost:5173
npm test                               # layout, patch, definition and navigation tests
npm run typecheck && npm run build     # checks, then dist/
```

How the web app works:

- **Click any box** in the chart to select it. The strip at the bottom of the chart names the
  selection and offers its actions: edit, vary some words, add, move or delete alternatives,
  make something optional, tags and guards, insert text or a reference after any piece (or at
  the end of a branch), inline or extract a branch, set a delimiter and a final join, change
  or remove a repeat or transform, and rename, convert or delete a branch. Nothing depends on
  hover, and the keyboard can do all of it (Help lists the keys).
- **Click an example** to see the path that made it light up in the chart. While you edit,
  even when you add alternatives, the examples keep their picks everywhere else, so you see
  the effect of each change.
- **The chart edits the code, never regenerates it.** Every change is a text patch that keeps
  your comments, spacing and indentation, and Cmd+Z undoes it from anywhere.
- Big programs stay readable: each branch card says who uses it, and with many references the
  dashed lines show only for what you select. Help has a legend for the chart's shapes.
- `npm run e2e`, `npm run e2e:more` and `npm run e2e:latest` drive the main flows in a Chrome
  started with `--remote-debugging-port=9333`. `scripts/gate.sh` runs everything (build, core
  and web unit tests, the browser scenarios, and a check for em dashes) and prints GATE OK.
- Imports (`use`, `from`) are not available in the browser.

As a library:

```js
const { compile, seededRandom } = require('permutations');
const prog = compile('Hello [world|friend]!');
prog.count;                           // 2n
prog.one();                           // { text, tags }
prog.sample(5);                       // up to 5 distinct results
prog.sample(5, seededRandom(42));     // the same 5 every time
prog.sampleSteady(5, 42);             // 5 that stay put while the program is edited
[...prog.all()];                      // everything, lazily
prog.at(1n);                          // the result at an index
prog.trace(1n);                       // how it was made: the choices taken and nodes walked
```

`CompileOptions` accepts `load` (to resolve imports), `values`, `fns` (custom
transforms), `delimiter`, `entry` and `rng`.

On the command line, `--seed N` makes the random choices repeatable, and `-` reads the
program from standard input: `echo 'Hi [there|you]' | perm - --all`.

Versions 1 (JSON, permy.link) and 2 (`$$flag` / `${js}` DSL) are in git history.
