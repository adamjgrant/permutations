# Permutations v3: Spec (draft)

A breaking rethink. Nothing from the v1 JSON format or the v2 `$$flag` / `${js}` DSL
needs to stay compatible. v1 (2020 to 2021, permy.link) and v2 (Dec 2025) remain in git
history as reference.

## 1. What it is

A tool for writing one compact description of many possible texts, then seeing and
sampling them. Uses: dialogue and utterance variants, test data, prompt variations.

It ships as one engine with two front ends:

- **Web app**: three panes (below).
- **CLI**: `perm` for generating, counting, formatting and converting.

Both read the same DSL.

## 2. The interface

```
+---------------------------+-----------------------------+
|                           |  CODE (the DSL)             |
|  FLOW CHART               |                             |
|  main at the top,         +-----------------------------+
|  BRANCHES below a         |  5 RANDOM EXAMPLES          |
|  dashed line              |  (distinct, with count)     |
+---------------------------+-----------------------------+
```

- **Flow chart (left, editable).** Rectangles are text. Rounded pills are references to
  named branches. Alternatives are rows, and dashed edges run from a pill to that
  branch's definition in the BRANCHES section. Small markers show tags, delimiters,
  transforms and empty alternatives.
- **Code (top right).** The DSL. The code is the source of truth.
- **Examples (bottom right).** 5 random outputs, distinct when possible, with the total
  permutation count shown. Tags attached to an output show as chips.

Chart and code stay in sync in both directions. See section 7.

## 3. Model

One parse produces a graph. The chart draws it, the engine walks it.

Node types: `Text`, `Empty`, `Seq`, `Choice`, `AnyOrder`, `Ref`, `Splat`, `Repeat`,
`Transform`, `Tag`, `Guard`.

An output is `{ text, tags }`. A permutation is one path through the graph.

Properties the engine must keep:

- **Compile once, query many.** `count`, `one()`, `sample(n)`, `all()`.
- **Counting without enumeration.** Counts come from memoized dynamic programming over
  `(node, tag state)`. AnyOrder contributes n!. Transforms do not change counts.
- **Uniform sampling.** `one()` and `sample(n)` are uniform over complete permutations,
  not per node, so lopsided branches are not over-sampled. This works by picking a
  random index below `count` and unranking it.
- **Distinct examples.** `sample(n)` is without replacement. If `n >= count` it returns
  everything.
- **Paths versus strings.** `count` counts paths. Two paths can print the same string.
  `all({ distinct: true })` and `sample` de-duplicate by text.
- **No unbounded recursion.** References must be acyclic. Repetition is explicit (`{n}`).
- **No arbitrary code in the language.** See section 5.

## 4. The DSL: two forms, one language

Every construct has a **short form** (fast, inline) and a **long form** (readable,
maintainable). They parse to the same graph. You can mix them freely, even inside one
definition, and nest one inside the other.

### 4.1 Short form

```
main = [Hello|Oh, Hi] $greeting
greeting = [How [are you|'s [it|everything]]|What]
```

| Construct | Short form |
|---|---|
| Definition | `name = body` (one line, or several lines inside `[ ]`) |
| Whole file as a single program | A file with no `main` and one unnamed expression uses that expression as `main` |
| Choice | `[a|b|c]`, or without brackets as a whole definition: `name = a | b | c` |
| Empty alternative | `[Good morning!|]` |
| Reference | `$name`, `$ns.name` |
| Any order (every ordering) | `[a & b]` |
| Repeat | `$hex{6}`, `[a|b]{2..3}` |
| Range | `[1..6]`, `[0..9|A..F]` |
| Transform (applies to the item it is attached to) | `$name:upper`, `[Foo]:lower` |
| Choice of transforms | `[Foo]:[lower|upper]` |
| Set a tag | `[what @q|that]`, `[Warning @severity=5|Notice @severity=1]` |
| Guarded option | `[@q: ?|@else: .]` |
| Delimiter, local | `[a & b; delimiter=" "]`, `$x; delimiter=""` |
| Namespaced branch | `letters.B = b` |
| Import | `use lib`, `from lib use greeting` |
| Comment | a line whose first non-space character is `#` |

Escapes: `\[ \] \| \$ \@ \* \\` and `\#` at the start of a line. Hashtags and emails
inside a line need no escaping, except a literal `@` right after whitespace.

### 4.2 Long form

Indented, keyword-led blocks. A line that is exactly a keyword construct is reserved, so
literal text with that exact content is quoted. Any other line is a short-form expression.
The precise rules are in `DSL.md` section 3.1.

```
branch main
  one of
    Hello
    Oh, Hi
  ref greeting

branch greeting
  one of
    sequence
      How
      one of
        are you
        sequence
          's
          one of
            it
            everything
    What
```

| Construct | Long form |
|---|---|
| Definition | `branch name` followed by an indented body |
| Choice | `one of` with one item per line |
| Sequence | `sequence` (joined with the delimiter) or `tight` (glued) |
| Empty alternative | `nothing` |
| Reference | `ref name` |
| Any order | `any order` |
| Repeat | `repeat 6` |
| Transform | `transform lower \| upper` with the piece indented under it |
| Tag | `tag q`, `tag severity = 5` |
| Guard | `when q`, `when not q`, `otherwise`, directly under `one of` |
| Delimiter | `delimiter " "` as a line inside any block |

Any item line in a long-form block may itself be a short-form expression, so
`one of` / `[a|b] $c` is valid.

### 4.3 Converting between them

- `perm fmt --short file.perm` and `perm fmt --long file.perm` rewrite each definition.
- The chart's **Expand** and **Collapse** actions do the same for a selected node, so you
  can sketch fast and tidy later, or the reverse.
- **Edits preserve the surrounding style.** When the chart edits code, it writes the form
  already used at that spot. A new node in a long-form block is written in long form.
- `--auto` picks short form for a definition that fits on one line and has at most two
  nesting levels, and long form otherwise.

### 4.4 Whitespace and delimiters

The default delimiter is **a single space**. It is smart, so you do not hand-place
spaces.

**Join points.** The source is a series of pieces: text runs, groups and references.
Wherever the source has whitespace between two pieces, that is a join point. At
generation time a join point emits the current delimiter, unless a rule below suppresses
it. Where the source pieces touch, nothing is emitted:

```
Hello [world|friend]!      -> "Hello world!"   (space is a join, "!" attaches)
[Good|Bad]day              -> "Goodday"        (pieces touch, no join)
```

Items inside an AnyOrder group and the copies of a `{n}` repeat are also joined with the
delimiter in scope. Any-order uses the group's delimiter, so `[A & T]` gives `A T` by
default and `[A & T; delimiter=""]` gives `AT`. Repeats are glued unless a delimiter is
given, `$hex{6; delimiter=" "}`.

**Smart rules**, applied to the generated text at a join point:

1. An empty piece never produces a delimiter, so `[Good morning!|] How are you?` gives
   `Good morning! How are you?` or `How are you?`, never a stray space.
2. No delimiter before a piece that starts with closing punctuation or a suffix mark:
   `. , ; : ! ? ) ] ' ’ % …` and the `'s` family.
3. No delimiter after a piece that ends with opening punctuation: `( [ “ ‘ ¿ ¡`.
4. Runs of whitespace inside a text run are kept as written. The delimiter applies only
   between pieces.

**Configuring it.** The delimiter is a property that nests:

- **Global**: a header line, `delimiter = " "`, or `perm --delimiter`.
- **Local**: on any group, reference or long-form block. The innermost setting wins.
- **Any-order groups use it too**, so `join` is just the delimiter of that group.
  `All personnel [must have a parents signature & ages 18 and younger]` joins with the
  global space. `[[A & T][G & C]; delimiter=""]` joins tightly throughout.
- **Chart**: an edge shows a label only when its delimiter is not the default.

```
delimiter = " AND "
main = a [b|c]          # "a AND b", "a AND c"
```

Open: escape syntax for forcing a join or a glue at a specific spot (section 9).

## 5. What happened to flags and `${js}`

They were solving four problems. Each gets a declarative feature, and counts stay
computable.

| Old use | What it was for | New feature |
|---|---|---|
| `$$flag` then `${ flag ? a : b }` | A later choice depends on an earlier one (what / `?`) | **Tags and guards**: `[what @q|that]` then `[@q: ?|@else: .]`. A guard excludes options whose condition is false, so the choice among the rest is still uniform. |
| `${ key: "v" }` metadata | Labelling outputs (severity, intent) | **Tags carry out with the output.** `@severity=5` shows as a chip in the examples pane and as `tags` in `--json`. |
| `${ new Date()... }`, `${ Math.random()... }` | Computed values | **Ranges** (`[1..6]`, `[0..9|A..F]`) and **host values** (`$year` supplied by `--set year=2026` or the app). |
| Case changes and similar | Post-processing | **Transforms**, built in. Custom transforms are registered by the host (`perm --fn ./fns.js`, or a plugin in the app) and are never written inline in the DSL. |

Why this matters: because there is no inline JS, the engine can count and unrank every
permutation, and the web app can load shared programs without running untrusted code.

Tag semantics: tags set by a chosen option are visible to later guards in the same walk,
left to right. Tags are strings, or `key=value`.

Transform scope is the item it is attached to, which settles the old question of what
"string" a function receives. `[Foo]:[lower|upper]` yields `foo` and `FOO`.

Considered and deferred: back-references (`[Alice|Bob]=who ... $who`) for picking once
and reusing.

## 6. Engine and CLI

Library:

```js
const prog = compile(source, { delimiter: " " });
prog.count;          // number of permutations
prog.one();          // one uniform random permutation
prog.sample(5);      // up to 5 distinct
prog.all();          // generator, so callers can stream and cap
prog.graph;          // the model the chart draws
```

`one()` never enumerates.

CLI:

```
perm file.perm                    # one random
perm file.perm -n 5               # five distinct
perm file.perm --all [--limit N]
perm file.perm --count
perm file.perm --json             # text plus tags
perm 'Hello [world|friend]!'      # inline program, no file
perm fmt --short|--long|--auto file.perm
perm file.perm --set year=2026 --fn ./fns.js --delimiter " "
```

The web app is a thin shell over the same library.

## 7. The editable chart

The risk is a lossy round trip, where the chart regenerates code and loses formatting,
comments or your choice of short versus long form. So:

- **The parser produces a concrete syntax tree with source ranges**, and the chart's
  graph is derived from it.
- **Chart edits become text patches**, not regenerated documents.
- Edits to support: change a node's text, add, delete and reorder alternatives, wrap
  selected nodes into a new named branch, inline a branch, change a delimiter, add a tag
  or guard, and expand or collapse between forms.
- **Invalid code** keeps the last good chart and shows the error inline, like the old
  "Waiting for edits..." status.
- Layout: `main` at the top and BRANCHES below the dashed line, namespaces grouped and
  collapsible. The sketch draws a shared continuation (`greeting`) once per row. We can
  also draw it once with fan-in edges. Layout choice is open.

## 8. Porting the old examples

**v1 weather**

```
it's [windy|still|blustery], [cloudy|partly cloudy|clear skies], and [5|10|20|30|40|50|60|70|80|90|100]% chance of precipitation.
```

**v1 polite sentence**

```
main = [Hello|Hi|Greetings], [[How are you?|How's it going?] I just wanted to [take the time to tell you|remind you] to $advice|$advice]
advice = [Please remember|Take caution] to [mind the gap|stay six feet apart|clean up your area] [at all times.|to be a good citizen.]
```

**v1 hex** (a chain of six nested `then`s becomes repetition)

```
main = $hex{6}
hex = [0..9|A..F]
```

**v1 empty string**

```
[Good morning!|] How are you?
```

**v1 rotate (DNA and personnel)**

```
Example DNA Sequence [[A & T][G & C]; delimiter=""]
All personnel [must have a parents signature & ages 18 and younger]
```

**v1 unwrapped branch** (A or B, then C). A reference inside a choice already contributes its
options, so no special syntax is needed:

```
main = [$a|$b] $c
```

**v1 sub-branches**

```
letters.B = b
letters.C = c
main = A [$letters.B|$letters.C]
```

**v1 functional**

```
[Foo]:[lower|upper]
```

**v1 config delimiter**

```
delimiter = " AND "
main = a [b|c]
```

**v2 flags**

```
main = Excuse me, [what @q|that] is really neat [@q: ?|@else: .]
```

**Not ported:** `complex_branching.json`. Its `then` rules are the murky part v3 removes
with plain sequencing, and its sample outputs appear inconsistent with those rules (the
final `"T"` never shows up). Re-express it by intent when needed.

## 9. Decisions and open questions

Decided:

- Choices use `[ ]`, and `{n}` is repeat.
- A definition line may write its choice without brackets: `greeting = Hello | Hi | Hey`.
  Brackets are required for a choice inside a sentence.
- Namespaces use `$ns.name`.
- Tags and guards use `@tag`, `@k=v`, `@q:`, `@else:`.

Resolved during the build:

- **Glue and join escapes.** Short form: pieces that touch are glued, a space is a join. To
  force the other way, add or remove the space, or wrap in `[...; delimiter=""]`. Long form
  has `tight` for glued runs. No extra escape syntax is needed.
- **AnyOrder limits.** n! is counted exactly. The UI warns above 7 items (5040). Duplicate
  items do not collapse; they count as separate paths and `distinct` removes repeated text.
- **Persistence, fork, rename, gist loading.** The web app keeps the current program in
  localStorage and supports share links. Forking, naming and gist loading are deferred.
- **Back-references** (`[Alice|Bob]=who ... $who`). Deferred. Tags and guards cover the
  coupling cases we have.

Removed: unwrapped references (`*$name`). Under uniform sampling they never changed results.
They can return if weighted choices are added.

The full user-facing language reference is `DSL.md`.
