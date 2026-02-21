# Tinderbox Action Code LSP

A Language Server Protocol (LSP) implementation for Tinderbox Action Code, providing rich editing features in VS Code.

## Features

### 1. Code Completion
- **Operators**: Autocomplete for all standard Tinderbox operators (e.g., `linkTo`, `collect`).
- **Attributes**: Suggestions for System Attributes (e.g., `$Name`, `$Text`) and User Attributes.
- **Export Tags**: Autocomplete for Export Tags (e.g., `^value()^`, `^if()^`) in template files.
- **Keywords**: Completion for reserved words (`if`, `else`, `var`, `function`).
- **Variables & Functions**: Dynamic completion for locally declared variables (`var:string vStr`) and functions.
- **Snippets**: Function completion includes argument placeholders.
- **Colors**: Autocomplete for Tinderbox defined colors (e.g., `blue`, `poppy`).
![Completion](https://github.com/fryagbye/tinderboxlspserver/raw/main/images/completion.gif)

### 2. Hover Documentation
- **Operator Details**: Hover over an operator to see its syntax, return type, and description.
- **Attribute Info**: View descriptions and types for System Attributes.
- **Export Tag Info**: View official documentation and Japanese translations for Export Tags.
- **Color Info**: View hex codes and descriptions for named colors.
- **Bilingual Support**: Toggle between English and Japanese descriptions via `tinderboxActionCodeServer.language`.
![Hover](https://github.com/fryagbye/tinderboxlspserver/raw/main/images/hover.gif)

### 3. Validation / Diagnostics
- **Syntax Checking**: Detects unclosed strings and missing semicolons (heuristic-based).
- **Reserved Words**: Warns if a reserved word (e.g., `number`, `if`) is used as a variable name.
- **Smart Quotes**: Warns about smart quotes (`“`, `”`) which are invalid in Action Code.
- **Case Mismatch**: Warns if an identifier has incorrect casing (e.g., `$name` vs `$Name`).



### 4. Definition & References
- **Go to Definition**: Jump to the definition of user-defined functions, variables, and arguments within the document.
- **Scope Awareness**: Context-sensitive jumping that correctly resolves variables even when multiple functions share the same identifier names.
- **Workspace Symbols**: Press `Cmd + T` (Mac) or `Ctrl + T` (Windows/Linux) to search for functions and variables across all open documents.

### 5. Advanced Assistance
- **Signature Help**: Intelligent parameter tracking that correctly counts arguments even through nested parentheses and commas inside strings, highlighting the current parameter you are typing.
- **Semantic Tokens**: Dynamic modifier assignment. Read-only system attributes receive a `readonly` modifier, and built-in attributes receive `defaultLibrary`, allowing for more precise semantic highlighting in compatible themes.
- **Code Actions**: Select an expression within a line and use Quick Fix (`Cmd + .`) to "Extract to variable". It automatically inserts a `var:string` definition while preserving indentation.
- **Enhanced Snippets**: Included control flow snippets specifically for Tinderbox, such as `each`, `if` and `ifelse` blocks.

### 6. Export Code Support
- **Robust Parsing**: Handles nested tags (e.g., `^include(^value()...)^`) and balanced parentheses.
- **Path Protection**: Intelligently distinguishes between division operators and path separators in paths like `/Templates/Note`.
- **String & Regex Aware**: Accurately parses tags even when they contain complex regex or strings with parentheses.

### 7. Token-Based Parsing Engine
- **Robust State Tracking**: The core parser has been upgraded from simple regex scanning to a robust, token-based state machine. This change significantly improves the accuracy of context-aware features such as signature help, hover information, and variable scoping—especially when dealing with complex nested structures, parentheses, and method chains.

## Configuration

| Setting | Description | Default |
| :--- | :--- | :--- |
| `tinderboxActionCodeServer.maxNumberOfProblems` | Maximum number of problems reported. | `1000` |
| `tinderboxActionCodeServer.language` | Language for descriptions (`en` or `ja`). | `en` |

## Usage
The extension automatically recognizes the following file types:
- **`.tbxa`**: Tinderbox Action Code files.
- **`.tbxe`**: Tinderbox Export Code (Template) files.
- **`.tbxc`**: Legacy Tinderbox Action Code files (supported for backward compatibility).

If you are working with other file types (like `.txt`), you can manually set the language mode to **Tinderbox Action Code** or **Tinderbox Export Code** via the Language Mode selector in the VS Code status bar.

## Requirements
- VS Code 1.75.0 or higher.


## Known Issues
- While the parser now utilizes a robust token-based approach for high-level language features (such as hover and signature help), some structural validation checks may occasionally be tricked by extremely complex or irregular nested structures.

## Release Notes

### 0.3.0
- Feature: **Workspace Symbols** (`Cmd/Ctrl+T`) support for searching functions and variables across documents.
- Feature: **Code Action** for refactoring: "Extract to variable".
- Feature: **Enhanced Snippets** tailored for Tinderbox (`each`, `if`, etc).
- Feature: **Semantic Tokens Evolution**: Added `readonly` and `defaultLibrary` modifiers for System Attributes, allowing distinct coloring for unmodifiable values.
- Improved: **Signature Help** accuracy massively increased by replacing regex ahead-scanning with tokenizer-based state parsing (respects nested parens and string literals).
- Fix: Addressed an issue where Hover failed for expressions containing string literals with parentheses or operators (e.g., `vStr.deleteCharacters("()`").lowercase()`). Now uses robust token sequence matching.

### 0.2.2
- Feature: **Full Export Code Support** (`.tbxe`) with support for nested tags and balanced parentheses.
- Improved: Robust parsing logic for strings and regex within tags.
- Fix: Recursive validation masking to prevent false positive diagnostics in complex expressions.
- Fix: Caret preservation in Export Tag completion.
- Fix: Formatter improvements for paths and `.tbxe` files.

### 0.2.1
- Fix: Resolved hover information mismatch for `.each()` operators by refining type inference and context-aware matching (e.g., correctly distinguishing between `list.each`, `JSON.each`, and `XML.each`).

### 0.2.0
- Feature: **Color Support** (Completion and Hover for defined colors).
- Feature: Color hex code display in hover.
- Feature: **Go to Definition** for user-defined functions and variables (Scope-aware).
- Fix: Resolved server crash (`Invalid regular expression`) with unescaped characters.
- Fix: Enhanced Hover for chained expressions, arguments, and loops.
- Revert: "Go to Definition" for built-in items was reverted.

<details>
<summary>Earlier Releases</summary>

### 0.1.9
- Fix: Resolved a crash (`Invalid regular expression`) caused by unescaped special characters (like unclosed parentheses) during hover/completion.

### 0.1.8
- Feature: **Go to Definition** (Scope-aware jumping for functions/variables).
- Fix: Hover for chained expressions (e.g., `$Text(aID).eachLine()`).
- Fix: Enhanced hover for untyped variables, loop variables, and arguments.
- Fix: Robust operator name matching (cleaner identification of iterators).

### 0.1.7
- Doc: Added information about `.tbxc` extension support.
- Doc: Improved layout for release notes.



### 0.1.6
- Fix: Localization (Japanese setting now works).
- Fix: Validation (Smarter semicolon check).

### 0.1.5
- Fix: Data Type Hover (shows type info in `var:type`).
- Fix: Packaging configuration.

### 0.1.4
- Fix: Robust Dot Completion (Scope, Chains, Arguments).
- Fix: Double Insertion (Parens, $).
- Fix: Global Function Hover.

### 0.1.3
- Feature: Type-aware Dot Completion (filters based on scoped types).
- Fix: Attributes excluded from dot completion suggestions.
- Fix: Expanded Operator Scope logic (IsDotOp/OpScope).

### 0.1.2
- Fix: CSV parsing issues (TextJa display, $Name hover).
- Doc: Updated license attribution.

</details>

## Acknowledgments
The data used in this extension (reserved word, operators, functions and attributes) is adapted from [A Tinderbox Reference File ('aTbRef')](https://atbref.com/) by Mark Anderson, which is licensed under a [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/). Modifications were made to format the data for this LSP server.
