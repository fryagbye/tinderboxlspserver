# Tinderbox Action Code LSP

A Language Server Protocol (LSP) implementation for Tinderbox Action Code, providing rich editing features in VS Code.

## Features

### 1. Code Completion
- **Operators**: Autocomplete for all standard Tinderbox operators (e.g., `linkTo`, `collect`).
- **Attributes**: Suggestions for System Attributes (e.g., `$Name`, `$Text`) and User Attributes.
- **Keywords**: Completion for reserved words (`if`, `else`, `var`, `function`).
- **Variables & Functions**: Dynamic completion for locally declared variables (`var:string vStr`) and functions.
- **Snippets**: Function completion includes argument placeholders.
- **Colors**: Autocomplete for Tinderbox defined colors (e.g., `blue`, `poppy`).
![Completion](https://github.com/fryagbye/tinderboxlspserver/raw/main/images/completion.gif)

### 2. Hover Documentation
- **Operator Details**: Hover over an operator to see its syntax, return type, and description.
- **Attribute Info**: View descriptions and types for System Attributes.
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

## Configuration

| Setting | Description | Default |
| :--- | :--- | :--- |
| `tinderboxActionCodeServer.maxNumberOfProblems` | Maximum number of problems reported. | `1000` |
| `tinderboxActionCodeServer.language` | Language for descriptions (`en` or `ja`). | `en` |

## Usage
- Files with the `.tbxc` extension are automatically recognized as Tinderbox Action Code and will provide full IDE support.
- If you are working with other file types (like `.txt`), you can manually set the language mode to **Tinderbox Action Code** via the Language Mode selector in the VS Code status bar.

## Requirements
- VS Code 1.75.0 or higher.


## Known Issues
- The parser is regex-based, so complex nested structures may occasionally trick the validation logic.

## Release Notes

### 0.2.0
- Feature: **Color Support** (Completion and Hover for defined colors).
- Feature: Color hex code display in hover.
- Feature: **Go to Definition** for user-defined functions and variables (Scope-aware).
- Fix: Resolved server crash (`Invalid regular expression`) with unescaped characters.
- Fix: Enhanced Hover for chained expressions, arguments, and loops.
- Revert: "Go to Definition" for built-in items was reverted.

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

<details>
<summary>Earlier Releases</summary>

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
