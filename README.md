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
| Web app: flow chart, code, examples; click to select with a selection strip of actions; chart edits are text patches in short and long form; trace an example through the chart | working (`web/`) |

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

Click any box in the chart to select it; the strip at the bottom of the chart names the
selection and offers its actions (edit, add or move alternatives, tags and guards, make a choice
or make it optional, insert a reference, extract to a branch, rename or convert a branch). Click
an example to see the path that made it light up in the chart. The chart edits the code, never
regenerates it: every change is a text patch that keeps your comments, spacing and indentation,
and Cmd+Z undoes it from anywhere. `npm run e2e` drives the main flows in a Chrome started with
`--remote-debugging-port=9333`. Imports (`use`, `from`) are not available in the browser.

As a library:

```js
const { compile } = require('permutations');
const prog = compile('Hello [world|friend]!');
prog.count;      // 2n
prog.one();      // { text, tags }
prog.sample(5);  // up to 5 distinct results
[...prog.all()]; // everything, lazily
```

`CompileOptions` accepts `load` (to resolve imports), `values`, `fns` (custom
transforms), `delimiter`, `entry` and `rng`.

Versions 1 (JSON, permy.link) and 2 (`$$flag` / `${js}` DSL) are in git history.
