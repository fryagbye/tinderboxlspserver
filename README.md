# Tinderbox Action Code LSP

A Language Server Protocol (LSP) implementation for Tinderbox Action Code, providing rich editing features in VS Code.

## Features

### 1. Code Completion
- **Operators**: Autocomplete for all standard Tinderbox operators (e.g., `linkTo`, `collect`).
- **Attributes**: Suggestions for System Attributes (e.g., `$Name`, `$Text`) and User Attributes.
- **Keywords**: Completion for reserved words (`if`, `else`, `var`, `function`).
- **Variables & Functions**: Dynamic completion for locally declared variables (`var:string vStr`) and functions.
- **Snippets**: Function completion includes argument placeholders.
![Completion](https://raw.githubusercontent.com/fryagbye/tinderboxlspserver/main/images/completion.gif)

### 2. Hover Documentation
- **Operator Details**: Hover over an operator to see its syntax, return type, and description.
- **Attribute Info**: View descriptions and types for System Attributes.
- **Bilingual Support**: Toggle between English and Japanese descriptions via `tinderboxActionCodeServer.language`.
![Hover](https://raw.githubusercontent.com/fryagbye/tinderboxlspserver/main/images/hover.gif)

### 3. Validation / Diagnostics
- **Syntax Checking**: Detects unclosed strings and missing semicolons (heuristic-based).
- **Reserved Words**: Warns if a reserved word (e.g., `number`, `if`) is used as a variable name.
- **Smart Quotes**: Warns about smart quotes (`“`, `”`) which are invalid in Action Code.
- **Case Mismatch**: Warns if an identifier has incorrect casing (e.g., `$name` vs `$Name`).



### 4. Definition & References (Stub)
- Basic support for jumping to definitions of local variables and functions (heuristics).

## Configuration

| Setting | Description | Default |
| :--- | :--- | :--- |
| `tinderboxActionCodeServer.maxNumberOfProblems` | Maximum number of problems reported. | `1000` |
| `tinderboxActionCodeServer.language` | Language for descriptions (`en` or `ja`). | `en` |

## Requirements
- VS Code 1.75.0 or higher.


## Known Issues
- The parser is regex-based, so complex nested structures may occasionally trick the validation logic.

## Release Notes

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

## Acknowledgments
The csv data used in this extension (operators and attributes) is adapted from [A Tinderbox Reference File ('aTbRef')](https://atbref.com/) by Mark Anderson, which is licensed under a [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/). Modifications were made to format the data for this LSP server.
