# Project Specification: Permutation DSL (v2)

## 1. Project Overview
We are building a ground-up rewrite of a text permutation engine.
**Goal:** A writer-friendly DSL for generating randomized text strings with embedded logic.

**Core Philosophy:**
1.  **Text-First:** The syntax resembles the final output.
2.  **Unified Logic Marker (`$`):** All code, logic, and state manipulation is triggered by the `$` character.
3.  **Left-to-Right Flow:** State set at the beginning of a sentence (via flags) is available to logic expressions at the end of the sentence.

---

## 2. Syntax Grammar

### 2.1 The Magic Characters
* `[` `]` : **Permutation Group** (The "Choices")
* `|`     : **Alternator** (The "OR")
* `$`     : **Logic & References** (The "Brain")
* `#`     : **Comments** (Ignored)

### 2.2 Text & Permutations
* **Literals:** Plain text is preserved, including whitespace.
* **Grouping:** `[ Option A | Option B ]`
* **Nesting:** `[ A | B [ C | D ] ]` (Infinite depth supported)
* **Splats:** `[ *$list_a | *$list_b ]` (Flattens array variables into the current list).

### 2.3 Variables
* **Definition:** `variable_name = ...`
* **Usage:** `$variable_name`
* **Purpose:** Reusable patterns defined at the top level.


### 2.4 The `$` Logic Layer

#### A. Setting State (Flags)
* **Syntax:** `$$flagName`
* **Behavior:** When the engine selects the branch containing this flag, it sets `flagName = true` in the current execution context.
* **Example:** `[ Hello $$formal | Hi ]`

#### B. Interpolation (Execution)
* **Syntax:** `${ expression }`
* **Behavior:** Executes raw JavaScript. The result is injected into the string.
* **Scope:** Variables set by flags (like `formal`) are directly accessible inside the block.
* **Example:** `${ formal ? "Sir" : "Buddy" }`

#### C. Complex Metadata (Attachment)
* **Syntax:** `${ key: "value" }` (Object Literal)
* **Behavior:** If a block returns an Object instead of a String, it is **attached** to the preceding text node as metadata, rather than printed.
* **Example:** `Warning ${ severity: 5 }`

---

## 3. Architecture & Runtime


### 3.1 Context Propagation
The runtime must maintain a `Context` object that flows **Left-to-Right**.

* **Step 1:** `[ Start $$active | Begin ]`
    * If "Start" is picked, `context.active` becomes `true`.
* **Step 2:** `... middle text ...`
* **Step 3:** `${ active ? "!" : "." }`
    * The JS block reads `active` from the context.

### 3.2 Parsing Strategy
* **Lexer:** distinct tokens for `$` vs `${` vs `$$`.
* **Parser:** Needs to handle "Splat" (`*`) expansion during the resolution phase, not the parsing phase.

---

## 4. Reference Implementation (The Target Artifact)

The following script (`master_test.perm`) must parse and execute correctly.

```text
# =========================================================
# TEST SCRIPT: master_test.perm
# =========================================================

# 1. SETUP
# ---------------------------------------------------------
# JS Interpolation used for static variable definition
year = ${ new Date().getFullYear() }

# 2. DEFINITIONS
# ---------------------------------------------------------
greetings = [
    Hello |
    Hi
]

names = [
    World |
    Friend
]

# 3. COMPOSITION
# ---------------------------------------------------------
# A. Simple Permutation
line_1 = $greetings $names

# B. Logic Flow (The "Ternary" Requirement)
# - If "what" is picked, 'qu' becomes true.
# - The final interpolation checks 'qu' to decide punctuation.
line_2 = Excuse me, [ what $$qu | that ] is really neat ${ qu ? "?" : "." }

# C. Complex Logic (Short-circuiting)
# - If "steak" is picked, 'meat' is true.
# - The interpolation uses && to conditionally add text.
line_3 = I will have the [ steak $$meat | salad ] ${ meat && "(Medium Rare)" }

# D. Splatting & Deep Nesting
list_a = [ A | B ]
list_b = [ Y | Z ]

# Should result in flat list: A, B, Y, Z, or Others
line_4 = [ *$list_a | *$list_b | Others [ 1 | 2 ] ]

# 4. FINAL OUTPUT
# ---------------------------------------------------------
main = [
    $line_1 |
    $line_2 |
    $line_3 |
    $line_4
] -- Copyright $year