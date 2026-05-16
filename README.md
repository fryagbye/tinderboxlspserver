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
- **Go to Definition**: Jump to the definition of user-defined functions, variables, and arguments within the document, **as well as across the entire workspace via background scanning**.
- **Scope Awareness**: Context-sensitive jumping that correctly resolves variables even when multiple functions share the same identifier names.
- **Workspace Symbols**: Press `Cmd + T` (Mac) or `Ctrl + T` (Windows/Linux) to search for functions and variables across all open documents **and the background-scanned workspace**.

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

### 8. User-Defined Function Documentation
- **Automatic Extraction**: Automatically extracts preceding line comments (`//`) as function documentation.
- **Tag Support**: Supports JSDoc-style block tags (`@param`, `@return`, etc.) and inline tags (`{@link}`) within line comments.
- **Workspace-wide Scope**: Recognizes and documents user functions defined in any file across the entire workspace.

## Configuration

| Setting | Description | Default |
| :--- | :--- | :--- |
| `tinderboxActionCodeServer.maxNumberOfProblems` | Maximum number of problems reported. | `1000` |
| `tinderboxActionCodeServer.language` | Language for descriptions (`en` or `ja`). | `en` |

## Customizing Colors

While the extension provides default color mappings that adapt to your theme, you can manually override specific colors in your `settings.json` for even finer control. This is particularly useful if you want to distinguish between system and user attributes or built-in and user functions more clearly:

```json
"editor.semanticTokenColorCustomizations": {
    "enabled": true,
    "rules": {
      "method:tinderbox-action-code": "#004cff",
      "method:tinderbox-export-code": "#ff00ff",
      "function:tinderbox-action-code": "#4EC9B0",
      "function:tinderbox-export-code": "#4EC9B0",
      "property:tinderbox-action-code": "#7841e7",
      "property:tinderbox-export-code": "#7841e7",
      "enumMember:tinderbox-action-code": "#3e88d8ff",
      "enumMember:tinderbox-export-code": "#3e88d8ff",
      "parameter:tinderbox-action-code": "#c84444ff",
      "parameter:tinderbox-export-code": "#c84444ff",
      "variable:tinderbox-action-code": "#ffffffd0",
      "variable:tinderbox-export-code": "#ffffffd0",
      "macro:tinderbox-export-code": "#ff00ff"    // Export Tag caret (^)
    }
}
```

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

### 0.4.7
- **Feature**: **Intelligent Export Code Formatting**: Support for formatting Action Code inside `^...^` tags in `.tbxe` files while preserving the surrounding template structure.
- **Feature**: **Type Inference Inlay Hints**: Automatically displays inferred types for variables (e.g., `var vName:string`) when types are not explicitly declared.

### 0.4.6
- **Feature**: **Duplicate Function Detection**: Warns if a function name is already defined within the same file or elsewhere in the workspace.

### 0.4.5
- **Feature**: **Unused Symbol Detection**: Automatically highlights unused local variables, parameters, and global functions.

### 0.4.4
- **Feature**: **Workspace-wide Symbol Rename**: Rename functions and variables across all workspace files.
- **Feature**: **Workspace-wide Find All References**: Find all usages of a symbol across the entire workspace.
- **Feature**: **File Watcher**: Background monitoring for workspace file changes to keep caches up-to-date.

### 0.4.3
- **Feature**: **Automatic Theme Color Support**: Integrated default semantic token scopes into the package to automatically adjust colors for dark and light themes.
- **Improvement**: Refined token assignments for built-in functions (`method`), system attributes (`property`), and user functions (`function`) to maximize color variety.

### 0.4.2
- **Feature**: **Enhanced Semantic Highlighting**: refactored the highlighting engine to provide more accurate color-coding for built-in functions, numbers, parameters, and attributes.
- **Improvement**: Improved built-in function recognition (e.g., `collect_if`, `update`, `create`, `delete`).
- **Improvement**: Added numerical literal highlighting.
- **Improvement**: Added context-aware highlighting for type names vs. function calls (e.g., `date()` vs. `date`).
- **Improvement**: Distinct coloring for System vs. User attributes.
- **Improvement**: Function arguments are now distinctly colored from local variables.
- **Improvement**: Identifiers preceded by a dot (chained operators) are now consistently highlighted as functions.

### 0.4.1
- **Fix**: Removed block comment references in documentation and refined line-comment JSDoc tag support.

### 0.4.0
- **Feature**: **User-Defined Function Documentation**: Preceding line comments (`//`) and included JSDoc tags are now automatically extracted and displayed as documentation in hover and completion suggestions.
- **Feature**: **Workspace-wide User Function Support**: Completion and highlighting now recognize user functions defined in any file within the workspace.

### 0.3.9
- Fix: Finalized `completionItem/resolve` fix.
- Update: Synchronized internal resources (Operators, Attributes, **Designators**, etc) with the latest **aTbRef** (Thu, 30 Apr 2026).

### 0.3.8
- Fix: Resolved an issue where `completionItem/resolve` requests failed due to missing `data` property.

### 0.3.7
- Fix: Suppressed "Missing semicolon?" warnings for expressions within `^if()^`, `^not()^`, and `^do()^` tags in Export Code.

### 0.3.6
- Fix: Prevented automatic space insertion for all operator symbols (e.g., `+`, `-`, `*`, `=`, `&`, `|`) within string literals and in-line comments.
- Update: Added subtraction (`-`) and logical operators (`&`, `|`) to the formatting rules.

### 0.3.5
- Fix: Resolved an issue where slashes (`/`) within string literals or in-line comments were incorrectly identified as operators during formatting, ensuring path-like strings are preserved.

### 0.3.4
- Update: Automated the CSV extraction and translation process for improved metadata management.
- Update: Streamlined internal resource CSV filenames (e.g., `data_types_v2.csv` -> `data_types.csv`).

### 0.3.3
- Feature: **Go to Definition** now supports jumping to functions and variables defined in unopened files across the entire workspace via background scanning.
- Update: Implemented a robust workspace global cache that updates dynamically on file changes.

### 0.3.2
- Fix: Prevented unnecessary addition of double carets (`^^`) in Export Code hover headings.
- Fix: Preserved caret-enclosed phrases (e.g., `^action^`) from being translated during the `export_tags.csv` translation process.

### 0.3.1
- Fix: Normalized multiple carets (`^^` to `^`) in Export Tags auto-completion and hover documentation.
- Update: Updated internal data types in v2 definition files.

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
