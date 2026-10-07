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
| Web app: flow chart, code, examples; chart edits are text patches in both short and long form; rename, extract to branch, new/delete branch, tag and guard chips, range boxes, Expand and Collapse, syntax help, keyboard access | working (`web/`) |

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

The chart edits the code, never regenerates it: every change is a text patch (one undo step) that
keeps your comments, spacing and indentation. Keyboard: arrows move between boxes, Enter edits,
Delete removes, Alt+Up/Down reorders, `+` adds, `t` and `g` add a tag or guard, Space selects for
Extract to branch. Imports (`use`, `from`) need a loader and are not available in the browser.

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
