
# Permutations DSL


A powerful, text-first permutation engine designed for generating randomized strings, dialogue trees, and test data with embedded logic.


**Simple Example:**
```text
# Assignments must use brackets
greeting=[ [ Hello | Hi ] [ world | friend ]! ]
```
> Output: "Hi friend!"


**Advanced Example:**
```text
# Logic, flags, and nesting
status=[ online | offline$$is_offline ]
alert=[ User is $status. ${ is_offline ? "Check connection." : "All good." } ]
```
> Output: "User is offline. Check connection."

## 🚀 Quickstart

### 1. Install

```bash
npm install -g permutations
```

### 2. Run

Create a file `script.perm` and run it:

```bash
perm script.perm
```

---

## 🛠️ Development Setup

If you want to contribute or modify the source:

```bash
git clone https://github.com/adamjgrant/permutations.git
cd permutations
npm install
npm run build
npm link
```

---

## 📖 Syntax Guide



### Choices `[...]`
Define branching options using brackets and pipes.
```text
color = [ Red | Green | Blue ]
```
*Note: Whitespace surrounding options inside brackets is trimmed.*

### Nesting
Choices can be nested infinitely.
```text
# Deeply nested structures
mood = [ Happy | Sad [ moderately | very ] ]
sentence = [ I am $mood. ]
```

### Variables `$`
Define reusable patterns at the top level and reference them with `$.`
```text
animal = [ cat | dog ]
story = [ I saw a $animal. ]
```

### Splats `*`
Flatten a list into another list.
```text
colors = [ Red | Blue ]
shapes = [ Circle | Square ]
# Mix them all together
mix = [ *$colors | *$shapes ] 
# Result: [Red|Blue|Circle|Square]
```


### Logic `$`
Set state flags and use them later.

**Setting Flags:**
Use `$$flagName` inside a choice. If that option is picked, the flag becomes true.
```text
# If "Formal" is picked, 'is_formal' becomes true
greeting = [ Hello$$is_formal | Hi ]
```

**Interpolation:**
Use `${ ... }` to execute JavaScript logic based on flags.
```text
# Check the flag set earlier
message = [ $greeting friend. ${ is_formal ? "How do you do?" : "Sup?" } ]
```

### Comments `#`
Lines starting with `#` are comments and are ignored.
```text
# This is a comment
main = [ A | B ]
### Imports
Modularize your code by importing variables from other `.perm` files.
```python
from lib import greeting
# or
from lib import *
# or
import lib

main = [ $greeting ]
```

---

## 💡 Tips & Tricks

### Whitespace Handling
### Whitespace Handling & Syntax
* **Hardened Syntax**: All variable assignments must be wrapped in brackets `[]`.
  * `var = [ value ]`
* **Smart Trimming**: Whitespace **surrounding** options inside brackets is trimmed.
  * `[ A | B ]` -> "A" or "B" (Clean)
  * `[  Hello  ]` -> "Hello" (Clean)
* **Preservation**: Whitespace **inside** an option is preserved.
  * `[ Hello   World ]` -> "Hello   World"

### Entry Point
By default, the engine looks for a variable named `main` to start generation. You can override this by passing a second argument to the CLI:


```

## 🧠 Advanced Concepts


### Left-to-Right Context Flow
The engine evaluates text from left to right. This means you can set a flag at the start of a sentence and check it at the end.

```text
sentence = [ [ High$$h | Low ] quality ${ h ? "guaranteed!" : "..." } ]
```
> Output: "High quality guaranteed!"

### Standard Library Access
Interpolation blocks `${ ... }` have access to standard JavaScript objects like `Math`, `Date`, and can process logic.

```text
year = [ Copyright ${ new Date().getFullYear() } ]
dice = [ Rolled a ${ Math.ceil(Math.random() * 6) } ]
```
