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
| Web app: three panes, live flow chart, chart edits as text patches | working (`web/`), see below |

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
npm test                               # layout and patch tests
```

Not built yet in the web app: renaming or creating definitions from the chart, editing tag
and guard chips, and the Expand and Collapse buttons (they appear once wired to `formatSource`).

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
