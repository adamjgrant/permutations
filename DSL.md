# Permutations DSL Reference

This is the one document you need to read or write Permutations (version 3). It is written
for people and for LLMs. If you are an LLM asked to write Permutations code, read section 12
first, then check your program against the examples in section 11.

In the examples below, `->` shows what a line produces. It is not part of the code.

---

## 1. What this is

A Permutations program describes many possible texts in one compact line. The engine
can count them, pick random ones, or list them all.

```
Hello [world|friend]!
```

This program has 2 permutations: `Hello world!` and `Hello friend!`.

Run it (this is shell, so `#` starts a shell comment here):

```sh
perm 'Hello [world|friend]!'          # one random result
perm 'Hello [world|friend]!' --all    # both
perm 'Hello [world|friend]!' --count  # 2
```

## 2. The mental model

Text flows left to right. Wherever there is a **choice**, one option is taken. The
result is every path from the start to the end.

- **Plain text** is itself.
- **`[a|b]`** is "a or b".
- **`$name`** means "insert the named piece defined elsewhere".
- Everything else (any order, repeats, ranges, transforms, tags) is a variation on those three.

Spaces you type between pieces are **join points**. The engine fills them with a
delimiter, a single space by default, and it tidies punctuation for you (section 7).
You never need to hand-place a trailing space.

## 3. Two forms: short and long

Every feature has a **short form** (fast to type) and a **long form** (easy to read and
maintain). They mean exactly the same thing and can be mixed freely, even inside one
definition.

Short:

```
greeting = [Hello|Hi] [world|friend]!
```

Long:

```
branch greeting
  one of
    Hello
    Hi
  one of
    world
    friend
  "!"
```

Each line in a long-form block is one piece, and pieces on separate lines are joined with
the delimiter. The quoted `"!"` attaches to the previous piece because of the punctuation
rule (section 7), giving `Hello world!`.

Convert between the forms with `perm fmt --short file.perm`, `perm fmt --long file.perm`
or `perm fmt --auto file.perm`. In the web app, select a branch name and choose Expand to
long form or Collapse to short form, or convert the whole file with Long form and Short form.
Use short form for quick sketches and small definitions. Use long form when a definition has
more than two levels of nesting or needs comments on individual options.

### 3.1 Long form reference

A long-form definition starts with `branch NAME` and its body is indented underneath. Short
and long definitions can sit in the same file, and long-form lines can contain short-form
expressions.

The lines of long form (this list is not a table, so every example can be copied as is):

- `branch name`: a definition. The indented lines are its body, joined as a sequence.
- `one of`: a choice. Each indented line or block is one option.
- `sequence`: pieces joined with the delimiter. Use it for an option made of several pieces.
- `tight`: pieces glued together with no delimiter.
- `any order`: every ordering of the indented items.
- `repeat 6` or `repeat 2..4`: repeat the indented piece.
- `transform lower | upper`: apply one of the transforms to the indented piece.
- `ref name`: a reference.
- `nothing`: an empty piece, or an empty option inside `one of`.
- `tag q` or `tag severity = 5`: set a tag, from this line on. It goes in the sequence it
  belongs to (a `branch`, `sequence`, `when` or `otherwise` block), not directly under
  `one of`.
- `when q`, `when not q`, `when k = 5`, `otherwise`: a guarded option, directly under
  `one of`. The indented lines are its content.
- `delimiter ", "`: the delimiter for the enclosing block. Also allowed directly under
  `branch`.
- `last " and "`: under `any order` or `repeat`, what joins the final two items (section 6).
- `"text"`: literal text, with `\"`, `\\`, `\n` (line break) and `\t` (tab) escapes.
- `# ...`: a comment, at any indent. To write a line that is the text `#...`, quote it:
  `"#1"`.
- any other line: a short-form expression, such as `Oh, Hi`, `How [are|is] it` or `what @q`.

Rules:

- **Indent consistently.** The children of a block are indented deeper than it, all by the
  same amount. A tab counts as two spaces.
- **Keywords are reserved only when they are the entire line.** `nothing` is a construct;
  `nothing to see` is text. To write a line that is exactly a keyword as text, quote it:
  `"nothing"`, `"one of"`.
- **Blocks need children.** `one of` with nothing under it is an error.
- **Tags belong to a sequence.** A `tag` line directly under `one of` is an error. Put it in
  a `sequence` (or `when`) that is one of the options. A tag takes effect from its line on.
- **Ranges need brackets here too.** A line `0..9` under `one of` is the text `0..9`. Write
  the line as `[0..9]` (a short-form expression).

Example with a tag and a guard:

```
branch main
  Excuse me,
  one of
    sequence
      what
      tag q
    that
  is really neat
  one of
    when q
      ?
    otherwise
      .
```

Gives `Excuse me, what is really neat?` and `Excuse me, that is really neat.`

`perm fmt` guarantees the converted program means exactly the same thing: same results,
same counts, same tags. Definitions that contain a comment are skipped rather than losing
it.

## 4. Core constructs

### 4.1 Text

Any characters that are not special are text.

```
Good morning
```

Most punctuation is plain text. Characters are only special in these places:

- `[` and `]`: always.
- `\`: always (it is the escape).
- `|`: inside brackets, and at the top level of a definition line.
- `&`: inside brackets, with whitespace on both sides (`Q&A` is plain text).
- `$`: followed by a letter or `_` (a reference). `$5` is plain text.
- `:`: directly after `]` or a reference, followed by a name or `[` (a transform).
  `Note: hi` is plain text.
- `{`: directly after `]` or a reference, followed by a digit (a repeat). `very{2}` is plain
  text.
- `@`: after whitespace or at the start of an option (a tag or guard). `bob@example.com` is
  plain text.
- `;`: inside brackets or repeat braces, before `name=` (a settings clause, section 6).
- `#`: the first non-space character on a line, anywhere in the file (a comment).

So `Note: this is fine`, `50% off`, `a & b` outside brackets, email addresses and hashtags
like `#sale` in the middle of a line need no escaping. To use a special character literally
in the places above, put `\` before it: `\[`, `\]`, `\|`, `\&`, `\$`, `\:`, `\{`, `\@`,
`\;`, `\#`, `\\`. A backslash before any other character keeps that character as text, so
`\ ` is a space that is part of the text (not a join point) and `\=` is an equals sign.

```
Price: \$5 \[approx\]          ->  Price: $5 [approx]
Email \@support for help       ->  Email @support for help
```

Two escapes make characters you cannot otherwise type on one line: `\n` is a line break
and `\t` is a tab.

```
Dear Sam,\n\nThanks [a lot|so much].
```

### 4.2 Choice

```
[red|green|blue]
```

Three options. Spaces around an option are ignored, so `[Good morning! | Hi]` is the same as
`[Good morning!|Hi]`.

Choices nest, and text can sit around them:

```
[How [are you|'s [it|everything]]|What]
```

Short form: `[a|b|c]`. Long form: `one of`, one option per line.

**Without brackets.** When a definition's whole right-hand side is a choice, the brackets
are optional. These two lines mean the same thing:

```
greeting = Hello | Hi | Hey
greeting = [Hello | Hi | Hey]
```

Ranges work there too: `hex = 0..9 | A..F` is the same as `hex = [0..9|A..F]`.

Brackets are still required for a choice inside a sentence, such as `Say [Hello|Hi] now`.
If a definition mixes text with a choice, bracket the choice. A `|` outside brackets on a
definition line always splits the whole line into options.

Options can span lines inside the brackets. Whitespace and newlines around `|` and the
brackets are ignored.

```
mood = [
  happy |
  sad [moderately|very]
]
```

### 4.3 Empty option

An empty option makes the thing optional.

```
[Good morning!|] How are you?
```

Gives `Good morning! How are you?` or `How are you?`. There is never a stray space,
because an empty piece produces no delimiter. Long form: `nothing`.

### 4.4 Naming and references

A **definition** gives a piece a name:

```
greeting = [Hello|Hi]
main = $greeting, friend.
```

- Names start with a letter or `_`, then use letters, digits and `_`. A line that looks
  like a definition but has a name that is not valid, such as `my-name = Sam`, is an error.
- `main` is the entry point. A file with no `main` and a single unnamed expression uses
  that expression as `main`. Run another definition with `perm file --entry NAME`.
- If the file does define `main`, a line without a name is an error: it would never be used,
  so it is almost always a missing `name =` or a line meant to continue `main`.
- A reference is `$name`. The name ends at the first character that is not a letter,
  digit or `_`, so `$name's` and `$name.` work as written. To put a letter directly after
  a reference, put the reference in brackets: `[$name]s`.
- Every reference must exist. An unknown name is an error that suggests the closest name,
  unless the host supplies it as a value (section 4.12).
- **Names must not form a cycle.** `a = x $a` is an error. Use a repeat instead.

Long form:

```
branch greeting
  one of
    Hello
    Hi

branch main
  ref greeting
  ", friend."
```

### 4.5 References inside choices

A reference inside a choice contributes its own options, so merging needs no special
syntax. In "A or B, then C", the choice below has 4 options (A, B, X, Y), followed by 1 or 2,
for 8 results:

```
a = [A|B]
b = [X|Y]
c = [1|2]
main = [$a|$b] $c
```

Because sampling is uniform over complete results (section 8), `[$a|C]` gives A, B and C
equal odds, exactly as if you had written `[A|B|C]`.

### 4.6 Any order

`&` inside brackets produces every ordering of its items.

```
[foo & bar]                     ->  foo bar / bar foo
[A & T; delimiter=""]           ->  AT / TA
[tent & stove & map; delimiter=", " last=" and "]
                                ->  tent, stove and map / map, tent and stove / ...
```

The items are joined with the group's delimiter (section 7), and `last` sets what joins the
final two, which makes natural lists (two items give `tent and stove`). Items can be any
piece, not only text. The delimiter goes only between items: inside an item, the words keep
the spacing around the group, so `[a [big|small] tent & a map; delimiter=", "]` gives
`a big tent, a map`.

`n` items give `n!` results, so the editor warns above 7 items. In a program that uses tags,
an any-order group can have at most 8 items.

An item cannot carry a tag or guard by itself, because `@` would apply to the whole group.
Wrap the item in brackets: `[[a @t] & b]`.

Long form: `any order`, one item per line, with optional `delimiter` and `last` lines.

### 4.7 Repeat

`{n}` repeats the piece before it `n` times. `{n..m}` repeats it between `n` and `m` times.
The repeated piece must be a bracket group or a reference, written directly before the `{`
with no space: `[very]{2}` or `$hex{6}`. (`very{2}` is plain text, and so is `[very] {2}`.)

Each repetition makes its own independent choices, and sampling stays uniform over all the
results (a count with more results is picked more often).

```
hex = [0..9|A..F]
color = #$hex{6}                ->  #3FA09B
```

Repeats are glued together with no delimiter, which suits codes like the one above. For
words, give the repeat a delimiter, and optionally a `last`:

```
[cat|dog]{3; delimiter=" "}                     ->  cat dog cat
[cat|dog|bird]{3; delimiter=", " last=" and "}  ->  bird, cat and bird
```

Long form: `repeat 6` or `repeat 2..4`, with the piece indented under it.

### 4.8 Ranges

`[1..6]` is a choice among `1, 2, 3, 4, 5, 6`.

- Numbers can have several digits: `[8..12]` is `8, 9, 10, 11, 12`.
- A leading zero pads every number to the same width: `[00..59]` is `00, 01, ... 59`.
  Without one, numbers are not padded: `[0..59]` starts `0, 1, 2`.
- A range can count down: `[3..1]` is `3, 2, 1`.
- Character ranges use single characters of one kind: `[a..e]`, `[A..F]`, `[0..9]`.
  `[a..E]` is an error, because it would run through punctuation.
- Ranges combine with other options: `[0..9|A..F]`, `[1..6|a lot]`.
- A range can carry a guard or tags, which every value then has:
  `[@kid: 5..9|@else: 18..60]`, `[1..3 @low|4..6 @high]`.
- A range is an option, so it needs brackets, or a whole definition: `digit = 0..9` and
  `hex = 0..9 | A..F` are choices. In a sentence, `0..9` without brackets is plain text.
- A range can have at most 10,000 values.

Ranges cover the old use of random numbers (a dice roll is `[1..6]`).

### 4.9 Transforms

`:name` directly after a bracket group or a reference changes that piece's text. It applies
to the piece it is attached to and nothing else.

- `lower`: every letter lowercase. `[hELLO wORLD]:lower` gives `hello world`.
- `upper`: every letter uppercase: `HELLO WORLD`.
- `capitalize`: the first letter uppercase, past any opening punctuation, the rest
  unchanged: `[hELLO wORLD]:capitalize` gives `HELLO wORLD`, `[(hi) there]:capitalize`
  gives `(Hi) there`.
- `title`: the first letter of each word uppercase, the rest unchanged. Words are what
  spaces and hyphens separate, so `[don't stop, well-known]:title` gives
  `Don't Stop, Well-Known`; a word starting with a digit stays as it is (`3rd`).
- `trim`: removes spaces at both ends.

All of them work on letters of any language. `capitalize` and `title` do not lowercase
anything. For "Hello world" from any input, chain them: `[hELLO wORLD]:lower:capitalize`.
Chained transforms apply left to right.

```
[Foo]:upper                     ->  FOO
$greeting:capitalize
[Foo]:[lower|upper]             ->  foo / FOO (a choice of transforms: 2 results)
```

A single transform does not change how many permutations there are. A choice of transforms
multiplies them.

To write a colon right after a group as text, escape it: `[1..12]\:[00..59]` gives times
such as `3:07`.

**Custom transforms** are supplied by the host, never written inside the DSL. On the
command line, `perm --fn ./fns.js` loads a JavaScript file whose exports are functions
from text to text:

```js
// fns.js (CommonJS; an ES module's named exports or default object work too)
module.exports = {
  shout: (text) => text.toUpperCase() + '!',
};
```

Then `[hi]:shout` gives `HI!`. Names are letters, digits and `_`, and a custom transform
with a built-in name replaces the built-in. The `--fn` path is relative to the current
directory (imports are relative to the importing file). A transform that throws, or gives
back something other than text, is reported as an error that names it. In the library,
pass `fns` to `compile`.

Long form: `transform lower | upper` with the piece indented under it.

### 4.10 Tags and guards

Tags let a later choice depend on an earlier one, and let you label results.

**Set a tag** by writing `@name` after an option's text. If that option is taken, the tag is
set from that point on, for the rest of the walk, including inside and after references.

```
[what @q|that]
```

A tag takes effect exactly where it is written, so a guard later in the same option sees it:
`Hi @casual there, [@casual: mate|@else: sir]` gives `Hi there, mate`. A tag is never
printed. An `@word` that no guard tests, in the middle of text or on a whole branch, gets a
warning, since it may be meant as text (an email handle, say). To print an `@` word, write
`\@name`.

**Guard an option** by starting it with `@name:`. A guarded option is only eligible when
the tag is set. `@!name:` means not set. `@else:` is eligible when no earlier guard in the
same choice matched, so put it last. Options without a guard are always eligible.

```
Excuse me, [what @q|that] is really neat [@q: ?|@else: .]
```

Gives `Excuse me, what is really neat?` or `Excuse me, that is really neat.`

Ineligible options are removed before choosing, so the chosen option is still uniform
among those that remain. If every option of a choice is guarded and none is eligible, the
path has nowhere to go and is dropped: it is not counted and never produced. That is
almost always a missing `@else:`, so it gets a warning.

**Values and labels.** `@key=value` sets a tag with a value. A value is any text without
spaces or the characters `| ] [ & ; :` (a guard's value ends at its `:`). A later tag with
the same name replaces the value. Tags travel with the output.

```
[Server is down @severity=5|Disk is at 80% @severity=1]
```

Guards can test a value: `@severity=5:`. The test compares the text exactly, so `05` and `5`
are different values.

Tags are read left to right. A guard only sees tags set before it (to its left).

Long form: `tag name` or `tag key = value`, and `when name`, `when not name`,
`when key = value`, `otherwise`.

### 4.11 Namespaces and imports

A dotted name groups related pieces.

```
letters.B = b
letters.C = c
main = A [$letters.B|$letters.C]
```

A dot continues a name only when a letter or `_` follows it immediately, so `Hi $name.`
ends the reference at the period.

Import other files (command line and library only; the web app is a single file):

```
use lib
from lib use greeting, farewell
```

`use lib` makes the file's definitions available as `$lib.greeting`. `from lib use greeting`
makes them available by their own names, as `$greeting`. Import paths are file paths,
relative to the importing file, and the `.perm` extension is implied: `use parts/lib` makes
`$lib.greeting`. Circular imports are an error. An imported definition keeps its own file's
`delimiter` setting, if the file has one (`--delimiter` replaces only the file you run).
A definition in your file with the same name as one from `from lib use` hides it, with a
warning. `perm file --entry lib.greeting` (or `--entry greeting`) starts from an imported
definition.

### 4.12 Host values

A host value is text supplied from outside the program, used like a reference:

```sh
perm 'Hi $name' --set name=Ann     # Hi Ann
```

In the file you run, a host value replaces the references to a definition with the same
name, so the file can give a default: with `name = friend` in the file, `--set name=Ann`
gives `Hi Ann`, and no `--set` gives `Hi friend`. (It replaces references, so it cannot
replace `main` itself.) A value that nothing refers to gets a warning, which catches typos.
In the library, pass `values` to `compile`.

## 5. Comments

```
# A comment: the first non-space character on the line is #
main = Hello
```

A `#` that starts a line is a comment, wherever that line is: at the top level, in a
long-form block, or between the options of a multi-line choice (a handy way to switch an
option off). A `#` after text on a line is text, so hashtags work mid-line and `main = Hi
# there` prints `Hi # there`. Put comments on their own line. To start a line with the
character `#`, write `\#` (short form) or a quoted line `"#..."` (long form).

## 6. Settings

There are two settings:

- `delimiter` (default: a single space): what fills a join point (section 7).
- `last` (default: the delimiter): what joins the final two items of an any-order group or
  a repeat.

Where they go:

- **For the whole file:** a line `delimiter = ", "`. It can be anywhere in the file and
  applies to all of it. `perm --delimiter STR` replaces it. There is no file-wide `last`:
  a line `last = ...` is an ordinary definition named `last`.
- **For one group:** a clause at the very end of `[ ]` or `{ }`, after `;`:
  `[a & b; delimiter=" and "]`, `[x]{3; delimiter=", " last=" and "}`. A choice (`|`) can
  take `delimiter` but not `last`.
- **In long form:** `delimiter ", "` and `last " and "` lines in the block.

Values are double-quoted strings, with `\"`, `\\`, `\n` and `\t` escapes. Separate two
settings with a space, not a comma. A clause written any other way is an error that says
what is wrong: single quotes, a comma between settings, an unknown setting, a value without
quotes, or a clause that is not at the very end. So is a `delimiter` line that is not
exactly `delimiter = "..."`. (A settings clause outside brackets, as in `[a & b]; delimiter=", "`,
is text, and gets a warning.)

## 7. Spacing and delimiters

You write spaces for readability. The engine decides what actually appears.

**Join points.** A join point is any place where you typed whitespace between two pieces
(text, a bracket group, or a reference). It prints the current delimiter, a single space
by default. Pieces that touch have no join point.

```
Hello [world|friend]!      ->  Hello world!
[Good|Bad] day             ->  Good day
$a$b                       ->  the two touching, no delimiter
```

**Smart rules**, applied to the generated text:

1. An empty piece produces no delimiter.
2. No delimiter before a piece starting with closing punctuation or a suffix:
   `. , ; : ! ? ) ] ’ ” % …`. A straight `'` counts as closing before `s`, `re`, `ll`, `d`,
   `ve`, `m` or `t` (`Ann's`, `we're`) or on its own; before any other word it opens a
   quotation, so `She said [hi|yo] 'loudly'.` gives `She said hi 'loudly'.`
3. No delimiter after a piece ending with opening punctuation: `( [ “ ‘ ¿ ¡`.
4. No delimiter next to a line break, so a long-form letter with `"\n"` lines comes out
   without stray spaces.
5. Spaces inside one run of text are kept exactly as written.

Rules 2 and 4 look at what follows together with the pieces glued to it, so the result is
the same however the text is split into pieces.

```
How [are you|'s [it|everything]]    ->  How are you / How's it / How's everything
```

**Changing the delimiter.**

- Globally: `delimiter = ", "` in the file, or `perm --delimiter ", "`.
- Locally: a clause on a choice, `[ ... ; delimiter="" ]`. The innermost setting wins, and
  it applies to everything inside that choice, including nested groups.
- On an any-order group or a repeat, the clause goes only between the items (or copies).
  The pieces inside each item keep the delimiter around the group, so
  `[the [red|blue] tent & a map; delimiter=", "]` gives `the red tent, a map`, not
  `the, red, tent, a map`.
- Without a clause, any-order groups use the delimiter around them, so `[a & b]` gives
  `a b`, and `[a & b; delimiter=" and "]` gives `a and b` or `b and a`.

```
delimiter = " AND "
main = a [b|c]                 ->  a AND b / a AND c
```

**The delimiter reaches into references.** A referenced definition uses the delimiter of
the place it is used, unless it sets its own. To pin a definition's spacing, give it a
clause:

```
x = [a|A] b
main = [$x c; delimiter="-"]          ->  a-b-c / A-b-c

x = [[a|A] b; delimiter=" "]
main = [$x c; delimiter="-"]          ->  a b-c / A b-c
```

A DNA-style tight join:

```
Example DNA Sequence [[A & T][G & C]; delimiter=""]
```

Gives `Example DNA Sequence ATGC` / `TAGC` / `ATCG` / `TACG`. The join between the label
and the group uses the outer (default) delimiter, and the inside is tight.

To glue two pieces, write them touching (`$a$b`, `[un|re]do`). To force a join point
where there is none, add a space. Long form has `tight` for a run of glued lines.

## 8. Counting, sampling, listing

- `count` is the number of **paths**. Two paths can print the same text.
- `one()` is uniform over all paths. It does not enumerate, so it is fast on huge
  programs.
- `sample(n)` (and `perm -n`) gives up to `n` results with distinct text, and all of them
  if `n` is at least the count. Two results with the same text but different tags count as
  one.
- `all()` lists everything, as a generator. Be careful, counts multiply: `$hex{6}` is
  16,777,216 results.
- With a seed (`perm --seed 7`, or `seededRandom(7)` in the library), random results are
  repeatable.

## 9. CLI

```
perm FILE_OR_PROGRAM [options]

  (no option)         one random result
  -n N                N distinct random results
  --all [--limit N]   every result
  --count             how many permutations
  --json              results as JSON (see below)
  --entry NAME        start from NAME instead of main (also lib.x or an imported x)
  --delimiter STR     global delimiter (replaces the delimiter setting of this file)
  --set key=value     host value, available as $key (section 4.12); repeatable
  --fn FILE           load custom transforms (section 4.9), path relative to the current
                      directory; repeatable
  --seed N            repeatable random choices (same N, same results)
  -q, --quiet         do not print warnings

perm fmt --short|--long|--auto FILE [-w]   convert definitions between forms
                                           (prints the result, or overwrites FILE with -w)
```

`fmt --auto` writes a definition in short form when it fits in 90 characters with at most
two levels of nested choices, and in long form otherwise. Definitions that contain a comment
are left alone. Repeats can repeat at most 1000 times.

If the first argument is an existing file, it is read as a program. A name that looks like
a file (such as `a.perm`) but does not exist is an error. Anything else is treated as the
program itself. Use `-` to read the program from standard input.

`--json` prints an array with one object per result:

```json
[
  { "text": "Server is down", "tags": { "severity": 5, "urgent": true } }
]
```

A bare tag is `true`. A value is a number when writing it as a number gives it back exactly
(`5`, `-2`, `0.5`; not `05`, `1.50` or a 17-digit id, which stay text), `true` or `false`
when it is one of those words, and text otherwise.

Errors in the program go to standard error with the line and column, and the exit code is
1. A mistake in the command itself (an unknown option, a missing value) exits with 2.
Warnings (section 10) go to standard error too, and do not stop the program.

## 10. Warnings

Some code is valid but almost certainly does not do what it looks like. The CLI prints a
warning for it (hide them with `-q`), and the web app shows it under the chart with a link
to the line.

Each warning below shows what you wrote, what happens, and what to write instead:

- `very{2}` or `[very] {2}`: printed as written. Write `[very]{2}`.
- `world:upper`: printed as written. Write `[world]:upper`.
- `${...}`: printed as written; there is no inline code. Use ranges, transforms, tags or
  host values.
- `[a & b]; delimiter=", "`: the clause is printed as text. Write `[a & b; delimiter=", "]`.
- `email @bob please`, with no guard testing `bob`: `@bob` is a tag, so it is not printed.
  Write `email \@bob please`.
- `[@else: E|@q: Q]`: the guard after `@else:` still competes with it. Write
  `[@q: Q|@else: E]`.
- `[x @q|y] [@q: yes]`: when `q` is not set, the result is dropped. Write
  `[@q: yes|@else: no]`.
- `[@q: hi|hey] [what @q|that]`: the guard tests a tag that is only set later, so `hi` is
  never picked. Move the tag earlier, or the guard later.
- `[a & b & c & d & e & f & g & h]`: more than 7 any-order items give tens of thousands of
  orderings.
- `--set nmae=Ann`: nothing refers to `$nmae`. Use the right name.
- `greeting = ...` in a file that also has `from lib use greeting`: the one in the file is
  used. Rename one of them.

## 11. Worked examples

**Greeting with a shared tail**

```
main = [Hello|Oh, Hi] $greeting
greeting = [How [are you|'s [it|everything]]|What [is new|is going on]]
```

**Optional prefix**

```
[Good morning!|] How are you?
```

**Sentence with a question mark that depends on an earlier choice**

```
Excuse me, [what @q|that] is really neat [@q: ?|@else: .]
```

**A list in any order, with commas and a final "and"**

```
Pack [a tent & a stove & a map; delimiter=", " last=" and "].
```

Gives `Pack a tent, a stove and a map.`, `Pack a map, a tent and a stove.` and the other
4 orderings.

**Weather**

```
it's [windy|still|blustery], [cloudy|partly cloudy|clear skies], and [10..100]% chance of rain.
```

**Times of day**

```
main = [1..12]\:[00..59] [am|pm]          ->  3:07 pm
```

**Labelled test data**

```
main = [Server is down @severity=5|Disk is at 80% @severity=1|Cache warmed @severity=0]
```

**Hex color**

```
main = #$hex{6}
hex = [0..9|A..F]
```

**A letter with line breaks**

```
main = Dear $name,\n\n[Thanks|Thank you] for [writing|reaching out].
name = Sam | Alex
```

**Agreement between parts, with a default from the host**

```
name = there
main = [Hi|Hello] $name, [your order @order|your ticket] is [@order: on its way|@else: being worked on].
```

`perm file --set name=Ann` gives, for example, `Hello Ann, your ticket is being worked on.`

## 12. Rules for an LLM writing this language

Do:

- Put a **space** wherever a space belongs in the output. Never put a trailing space
  inside a bracket to make one.
- Use `[a|b]` for choices, `[a & b]` for every ordering, `$name` for reuse.
- Keep short definitions in short form. Use long form when nesting exceeds two levels.
- Give shared sub-phrases a name and reference it, instead of repeating text.
- Use `[x|]` for optional text.
- Use tags and guards when a later choice must agree with an earlier one, and end every
  fully guarded choice with `@else:`. A tag takes effect where it is written, so the guard
  must come after it.
- Put repeats and transforms directly after `]` or a reference: `[very]{2}`, `$x:upper`.
- Give a repeat of words a delimiter, `[cat|dog]{2; delimiter=" "}`: repeats glue their
  copies together by default, which suits codes like `[0..9|A..F]{6}` but not words.
- For lists, use `last`: `[a & b & c; delimiter=", " last=" and "]`.
- Use `\n` for a line break inside short-form text.
- Check your program with `perm file --count` and `perm file -n 5`, and fix every warning.

Do not:

- Do not write JavaScript or `${...}`. There is no inline code. Use ranges, transforms,
  tags and host values.
- Do not create cycles between definitions.
- Do not write `then`, `rotate`, `$$flag`, `${...}`, or JSON such as `{ "branch": ... }`
  from older versions. (`branch name` on its own line is fine: it starts a long-form
  definition.)
- Do not leave a line without `name =` in a file that has `main`. It is an error, because
  it would never be used.
- Do not rely on a global delimiter to place punctuation. The punctuation rules handle
  `. , ! ? ' ) %` already.
- Do not put a `#` comment after text on a line. It will be treated as text. Do not put
  `# ...` notes after example lines either.
- Do not put a tag on an any-order item directly (`[a @t & b]`). Wrap it: `[[a @t] & b]`.
- Do not use single quotes or commas in settings: `[a & b; delimiter=", " last=" and "]`.
- Do not put Markdown table escapes such as `\|` into a program: `[a|b]` is a choice,
  `[a\|b]` is the text `a|b`.

Recipe for a request such as "make variants of a support greeting that matches tone":

1. Write the plain sentence.
2. Replace each varying word or phrase with `[a|b]`.
3. If two varying parts must agree, tag the first and guard the second.
4. If a part appears twice, name it with a definition and reference it.
5. Run `perm file --count` to check the size, and `perm file -n 5` to look at samples.

## 13. Grammar

Short form. Whitespace between pieces is a join point; pieces that touch are glued.

```
file        = { line }
line        = comment | setting | import | definition | expression
comment     = { space } "#" any-text                 (any line, even inside brackets)
setting     = "delimiter" "=" string                 (nothing else on the line)
import      = "use" file-path | "from" file-path "use" name { "," name }
definition  = path "=" ( sequence | range | option "|" option { "|" option } )
expression  = sequence                               (only in a file without main)
sequence    = { piece | tag }                        (whitespace between pieces joins them)
piece       = text | group postfix* | ref postfix*
group       = "[" ( choice | anyorder ) [ ";" settings ] "]"
choice      = option { "|" option }
anyorder    = sequence "&" sequence { "&" sequence }  (& with whitespace on both sides)
option      = [ guard ] ( range | sequence ) { tag }  (an option may be empty)
guard       = "@" [ "!" ] name [ "=" value ] ":"  |  "@else:"
tag         = "@" name [ "=" value ]                 (after whitespace; it takes effect there)
range       = digits ".." digits  |  char ".." char  (two characters of the same kind)
ref         = "$" path
postfix     = ":" ( name | "[" name { "|" name } "]" )
            | "{" digits [ ".." digits ] [ ";" settings ] "}"
settings    = setting-pair { space setting-pair }
setting-pair = ( "delimiter" | "last" ) "=" string
string      = '"' { char | "\" char } '"'            (\n line break, \t tab)
text        = { char | "\" char }                    (\n line break, \t tab)
path        = name { "." name }
name        = ( letter | "_" ) { letter | digit | "_" }
value       = one or more characters other than whitespace and | ] [ & ; :
file-path   = a path relative to the importing file, without ".perm"; the namespace for
              `use` is its last part
```

Long form, indentation based:

```
branch    = "branch" path NEWLINE INDENT item { item } DEDENT
item      = block | leaf | comment | shortline
block     = ( "one of" | "sequence" | "tight" | "any order"
            | "repeat" digits [ ".." digits ] | "transform" name { "|" name }
            | "when" [ "not" ] name [ "=" value ] | "otherwise" )
            NEWLINE INDENT item { item } DEDENT
leaf      = "nothing" | "ref" path | "tag" name [ "=" value ]
            | "delimiter" string | "last" string | string
shortline = any other line, parsed as a short-form sequence
```

## 14. Cheat sheet

A list rather than a table, so every example can be copied exactly as written:

- Either or: `[a|b]`
- Optional: `[a|]`
- Every ordering: `[a & b]`
- A list with "and": `[a & b & c; delimiter=", " last=" and "]`
- Reuse: `x = ...` then `$x`
- Repeat: `$x{3}`, `[very]{2..4}`
- A number or letter range: `[1..6]`, `[A..F]`, `[00..59]`, or `digit = 0..9`
- Change case: `$x:upper`, `[x]:lower:capitalize`
- A line break: `\n`
- Make later text depend on earlier: `[a @t|b]` then `[@t: x|@else: y]`
- Label an output: `[a @severity=5|b]`
- Different spacing: `[ ... ; delimiter=""]` or `delimiter = ", "`
- Group names: `ns.name = ...`, `$ns.name`
- Pull in a file: `use lib` or `from lib use x`
- A value from outside: `$name` with `--set name=...`
- A literal special character: `\[ \] \| \& \$ \: \{ \@ \; \# \\`
