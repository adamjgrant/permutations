# Permutations DSL Reference

Status: draft for v3. Items marked **[open]** are undecided and listed in `SPEC.md`
section 9. Everything else describes intended behavior.

This is the one document you need to read or write Permutations. It is written for
people and for LLMs. If you are an LLM asked to write Permutations code, read
section 11 first.

---

## 1. What this is

A Permutations program describes many possible texts in one compact line. The engine
can count them, pick random ones, or list them all.

```
Hello [world|friend]!
```

This program has 2 permutations: `Hello world!` and `Hello friend!`.

Run it:

```
perm 'Hello [world|friend]!'        # one random result
perm 'Hello [world|friend]!' --all  # both
perm 'Hello [world|friend]!' --count
```

## 2. The mental model

Text flows left to right. Wherever there is a **choice**, one option is taken. The
result is every path from the start to the end.

- **Plain text** is itself.
- **`[a|b]`** is "a or b".
- **`$name`** means "insert the named piece defined elsewhere".
- Everything else (any order, repeats, transforms, tags) is a variation on those three.

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
long form or Collapse to short form, or convert the whole file with Long form and Short form. Use
short form for quick sketches and small definitions. Use long form when a definition has
more than two levels of nesting or needs comments on individual options.

### 3.1 Long form reference

A long-form definition starts with `branch NAME` and its body is indented underneath. Short
and long definitions can sit in the same file, and long-form lines can contain short-form
expressions.

| Line | Meaning |
|---|---|
| `branch name` | A definition. The indented lines are its body, joined as a sequence. |
| `one of` | A choice. Each indented line or block is one option. |
| `sequence` | Pieces joined with the delimiter. Use it for an option made of several pieces. |
| `tight` | Pieces glued together with no delimiter. |
| `any order` | Every ordering of the indented items. |
| `repeat 6` or `repeat 2..4` | Repeat the indented piece. |
| `transform lower \| upper` | Apply one of the transforms to the indented piece. |
| `ref name` | A reference. |
| `nothing` | An empty piece, or an empty option inside `one of`. |
| `tag q`, `tag severity = 5` | Set a tag. Goes inside the option it belongs to (a `sequence`, `when` or `otherwise` block). |
| `when q`, `when not q`, `when k = 5`, `otherwise` | A guarded option, directly under `one of`. The indented lines are its content. |
| `delimiter ", "` | Sets the delimiter for the enclosing block. Also allowed directly under `branch`. |
| `"text"` | Literal text, with `\"` and `\\` escapes. |
| any other line | A short-form expression: `Oh, Hi`, `How [are\|is] it`, `what @q`. |

Rules:

- **Indent consistently.** Children are indented deeper than their parent, all by the same
  amount. A tab counts as two spaces.
- **Keywords are reserved only when they are the entire line.** `nothing` is a construct;
  `nothing to see` is text. To write a line that is exactly a keyword as text, quote it:
  `"nothing"`, `"one of"`.
- **Blocks need children.** `one of` with nothing under it is an error.
- **Tags belong to an option.** A `tag` line directly under `one of` is an error. Put it in
  a `sequence` (or `when`) that is one of the options.
- **Comments** are `#` lines, as in short form.

Example with tags, a guard and a tight join:

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
it, and so is text that cannot be written in the other form (for example a line break
inside text can only be written in long form).

## 4. Core constructs

### 4.1 Text

Any characters that are not special are text.

```
Good morning
```

Most punctuation is plain text. Characters are only special in these places:

| Character | Special when |
|---|---|
| `[` `]` | always |
| `\` | always (it is the escape) |
| `\|` | inside brackets, and at the top level of a definition line |
| `&` | inside brackets, with whitespace on both sides (`Q&A` is plain text) |
| `$` | followed by a letter or `_` (a reference). `$5` is plain text. |
| `:` | directly after `]` or a reference (a transform) |
| `{` | directly after a piece and followed by a digit (a repeat) |
| `@` | right after whitespace, inside an option (a tag or guard) |
| `#` | first non-space character on a line (a comment) |

So `Note: this is fine`, `50% off`, `a & b` outside brackets and hashtags like `#sale` in
the middle of a line need no escaping. To use a special character literally in the places
above, put `\` before it.

```
Price: \$5 \[approx\]
```

### 4.2 Choice

```
[red|green|blue]                  # 3 options
[Good morning! |Hi]               # trailing spaces inside an option are ignored
```

Choices nest, and text can sit around them:

```
[How [are you|'s [it|everything]]|What]
```

Short form: `[a|b|c]`. Long form: `one of`, one option per line.

**Without brackets.** When a definition's whole right-hand side is a choice, the brackets
are optional:

```
greeting = Hello | Hi | Hey
greeting = [Hello | Hi | Hey]     # same thing
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

- Names start with a letter or `_`, then use letters, digits and `_`.
- `main` is the entry point. A file with no `main` and a single unnamed expression uses
  that expression as `main`.
  If the file does define `main`, a line without a name is an error: it would never be used,
  so it is almost always a missing `name =` or a line meant to continue `main`.
- A reference is `$name`. The name ends at the first character that is not a letter,
  digit or `_`, so `$name's` and `$name.` work as written. To put a letter directly after
  a reference, use a transform-free group: `[$name]s`.
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
syntax. "A or B, then C":

```
a = [A|B]
b = [X|Y]
c = [1|2]
main = [$a|$b] $c        # 4 choices (A, B, X, Y), then 1 or 2: 8 results
```

Because sampling is uniform over complete results (section 8), `[$a|C]` gives A, B and C
equal odds, exactly as if you had written `[A|B|C]`.

### 4.6 Any order

`&` inside brackets produces every ordering of its items.

```
[foo & bar]                  # "foo bar" or "bar foo"
[A & T; delimiter=""]        # "AT" or "TA"
```

`n` items give `n!` results, so the editor warns above 7 items. In a program that uses tags,
an any-order group can have at most 8 items. The items are joined with
that group's delimiter (section 7). Items can be any piece, not only text.

Long form: `any order`.

### 4.7 Repeat

`{n}` repeats the piece before it `n` times. `{n..m}` repeats between `n` and `m` times.
Each repetition makes its own independent choices, and sampling stays uniform over all the
results (a count with more results is picked more often).

```
hex = [0..9|A..F]
color = #$hex{6}              # #3FA09B
```

Repeats are glued together with no delimiter. Add one with `{6; delimiter=" "}`. Long form:
`repeat 6`.

### 4.8 Ranges

`[1..6]` is a choice among `1, 2, 3, 4, 5, 6`. Character ranges work too: `[a..e]`,
`[A..F]`. They combine with other options: `[0..9|A..F]`.

Ranges cover the old use of random numbers (a dice roll is `[1..6]`).

### 4.9 Transforms

`:name` after a piece changes that piece's text. It applies to the piece it is attached to
and nothing else.

```
[Foo]:upper               # FOO
$greeting:capitalize
[Foo]:[lower|upper]       # foo or FOO (a choice of transforms)
```

Built-in: `lower`, `upper`, `capitalize`, `title`, `trim`. Custom transforms are supplied
by the host (`perm --fn ./fns.js` or the app), never written inside the DSL. Transforms do
not change how many permutations there are. Long form: `transform lower | upper` with the piece indented under it.

### 4.10 Tags and guards

Tags let a later choice depend on an earlier one, and let you label results.

**Set a tag** by writing `@name` after an option's text. If that option is taken, the tag
is set for the rest of the walk.

```
[what @q|that]
```

**Guard an option** by starting it with `@name:`. A guarded option is only eligible when
the tag is set. `@!name:` means not set. `@else:` is eligible when no earlier guard in the
same choice matched.

```
Excuse me, [what @q|that] is really neat [@q: ?|@else: .]
```

Gives `Excuse me, what is really neat?` or `Excuse me, that is really neat.`

Ineligible options are removed before choosing, so the chosen option is still uniform
among those that remain.

**Values and labels.** `@key=value` sets a tag with a value. Tags travel with the output.

```
[Server is down @severity=5|Disk is at 80% @severity=1]
```

`perm --json` prints `{ "text": "...", "tags": { "severity": 5 } }`, and the web app shows
tags as chips next to each example. Guards can test a value: `@severity=5:`.

Tags are read left to right. A guard only sees tags set before it. Long form: `tag name`
and `when name` / `otherwise`.

### 4.11 Namespaces and imports

A dotted name groups related pieces.

```
letters.B = b
letters.C = c
main = A [$letters.B|$letters.C]
```

A dot continues a name only when a letter follows it immediately, so `Hi $name.` ends the
reference at the period.

Import other files:

```
use lib                          # then write $lib.greeting
from lib use greeting            # then write $greeting
```

Import paths are relative to the importing file and the `.perm` extension is implied.
Circular imports are an error.

## 5. Comments

```
# A comment: the first non-space character on the line is #
main = Hello   # not a comment: this whole line is text after the =
```

Only a `#` that starts a line is a comment, so hashtags work mid-line. Put comments on
their own line.

## 6. Settings

Settings are lines at the top of a file, or an options clause inside a bracket.

```
delimiter = " "
```

| Setting | Default | Meaning |
|---|---|---|
| `delimiter` | single space | What fills a join point (section 7) |

Inside brackets or after a piece, a clause `; delimiter=" AND "` sets it just there.

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
   `. , ; : ! ? ) ] ' ’ % …`, including `'s`.
3. No delimiter after a piece ending with opening punctuation: `( [ “ ‘ ¿ ¡`.
4. Spaces inside one run of text are kept exactly as written.

```
main = How [are you|'s [it|everything]]    ->  How are you / How's it / How's everything
```

**Changing the delimiter.**

- Globally: `delimiter = ", "` at the top of the file, or `perm --delimiter ", "`.
- Locally: a clause on a group, `[ ... ; delimiter="" ]`. The innermost setting wins, and
  it applies to everything inside that group, including nested groups.
- Any-order groups use the delimiter of their own scope, so `[a & b]` gives `a b`, and
  `[a & b; delimiter=" and "]` gives `a and b` or `b and a`.

```
delimiter = " AND "
main = a [b|c]                 ->  a AND b / a AND c
```

A DNA-style tight join:

```
Example DNA Sequence [[A & T][G & C]; delimiter=""]
```

Gives `Example DNA Sequence ATGC` / `TAGC` / `ATCG` / `TACG`. The join between the label
and the group uses the outer (default) delimiter, and the inside is tight.

**[open]** Escapes to force or suppress a delimiter at one specific spot.

## 8. Counting, sampling, listing

- `count` is the number of **paths**. Two paths can print the same text.
- `one()` is uniform over all paths. It does not enumerate, so it is fast on huge
  programs.
- `sample(n)` gives up to `n` distinct results, and all of them if `n` is at least the
  count.
- `all()` lists everything, as a generator. Be careful, counts multiply: `$hex{6}` is
  16,777,216 results.

## 9. CLI

```
perm FILE_OR_PROGRAM [options]

  (no option)         one random result
  -n N                N distinct random results
  --all [--limit N]   every result
  --count             how many permutations
  --json              output text plus tags as JSON
  --entry NAME        start from NAME instead of main
  --delimiter STR     global delimiter
  --set key=value     host value, available as $key
  --fn FILE           register custom transforms
  --seed N            repeatable random choices (same N, same results)

perm fmt --short|--long|--auto FILE [-w]   convert definitions between forms
                                           (prints the result, or overwrites FILE with -w)
```

If the first argument is not an existing file, it is treated as a program. Use `-` to read the
program from standard input.

## 10. Worked examples

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

**Any order, with a custom join**

```
All personnel [must have a parents signature & ages 18 and younger]
```

**Weather**

```
it's [windy|still|blustery], [cloudy|partly cloudy|clear skies], and [5|10|20|30|40|50|60|70|80|90|100]% chance of precipitation.
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

## 11. Rules for an LLM writing this language

Do:

- Put a **space** wherever a space belongs in the output. Never put a trailing space
  inside a bracket to make one.
- Use `[a|b]` for choices, `[a & b]` for every ordering, `$name` for reuse.
- Keep short definitions in short form. Use long form when nesting exceeds two levels.
- Give shared sub-phrases a name and reference it, instead of repeating text.
- Use `[x|]` for optional text.
- Use tags and guards when a later choice must agree with an earlier one.

Do not:

- Do not write JavaScript or `${...}`. There is no inline code. Use ranges, transforms,
  tags and host values.
- Do not create cycles between definitions.
- Do not write `then`, `branch`, `rotate`, `$$flag`, or JSON arrays from older versions.
- Do not rely on a global delimiter to place punctuation. The punctuation rules handle
  `. , ! ? ' ) %` already.
- Do not put a `#` comment after text on a line. It will be treated as text.

Recipe for a request such as "make variants of a support greeting that matches tone":

1. Write the plain sentence.
2. Replace each varying word or phrase with `[a|b]`.
3. If two varying parts must agree, tag the first and guard the second.
4. If a part appears twice, name it with a definition and reference it.
5. Run `perm file --count` to check the size, and `perm file -n 5` to look at samples.

## 12. Grammar (informal)

```
file        = { line }
line        = comment | setting | import | definition | sequence
comment     = "#" any-text            (only at the start of a line)
setting     = "delimiter" "=" string
import      = "use" path | "from" path "use" name { "," name }
definition  = path "=" ( sequence | sequence { "|" sequence } )
sequence    = piece { [ whitespace ] piece }
piece       = ( text | group | ref ) { postfix }
group       = "[" alternatives [ ";" settings ] "]"
alternatives= option { "|" option }  |  item { "&" item }
option      = [ guard ] sequence { tag }
guard       = "@" [ "!" ] name [ "=" value ] ":"  |  "@else:"
tag         = "@" name [ "=" value ]
ref         = "$" path
postfix     = ":" ( name | group )  |  "{" n [ ".." m ] [ ";" settings ] "}"
range       = ch ".." ch                  (inside a group, as an option)
path        = name { "." name }
```

Long form (informal), indentation based:

```
branch   = "branch" path NEWLINE INDENT item+ DEDENT
item     = block | leaf | shortline
block    = ("one of" | "sequence" | "tight" | "any order"
           | "repeat" n [".." m] | "transform" name {"|" name}
           | "when" ["not"] name ["=" value] | "otherwise") NEWLINE INDENT item+ DEDENT
leaf     = "nothing" | "ref" path | "tag" name ["=" value]
           | "delimiter" string | string
shortline = any other line, parsed as a short-form expression
```

## 13. Cheat sheet

| I want | Write |
|---|---|
| Either or | `[a\|b]` |
| Optional | `[a\|]` |
| Every ordering | `[a & b]` |
| Reuse | `x = ...` then `$x` |
| Repeat | `$x{3}` or `$x{2..4}` |
| A number or letter range | `[1..6]` `[A..F]` |
| Change case | `$x:upper` |
| Make later text depend on earlier | `[a @t\|b]` then `[@t: x\|@else: y]` |
| Label an output | `[a @severity=5\|b]` |
| Different spacing | `[ ... ; delimiter=""]` or `delimiter = ", "` |
| Group names | `ns.name = ...`, `$ns.name` |
| Pull in a file | `use lib` / `from lib use x` |
