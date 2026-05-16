# Change Log

All notable changes to the "tinderbox-action-code-lsp" extension will be documented in this file.

## [0.4.8] - 2026-05-16
### Added
- **Code Action**: Added "Extract to Function" refactoring.
- **Call Hierarchy**: Implemented support for "Show Call Hierarchy" (incoming and outgoing calls).

## [0.4.7] - 2026-05-16
### Added
- **Feature**: **Intelligent Export Code Formatting**: Support for formatting Action Code inside `^...^` tags in `.tbxe` files while preserving the surrounding template structure.
- **Feature**: **Type Inference Inlay Hints**: Automatically displays inferred types for variables (e.g., `var vName:string`) when types are not explicitly declared.

## [0.4.6] - 2026-05-16
### Added
- **Feature**: **Duplicate Function Detection**: Added detection for duplicate function definitions within the same file and across the entire workspace. Warns the user if a function name is already in use elsewhere.

## [0.4.5] - 2026-05-16
### Added
- **Feature**: **Unused Symbol Detection**: Automatically detects and highlights unused local variables, function parameters, and global functions. Unused symbols are grayed out in the editor.

## [0.4.4] - 2026-05-16
### Added
- **Feature**: **Workspace-wide Symbol Rename**: Support for renaming functions and variables across all files in the workspace.
- **Feature**: **Workspace-wide Find All References**: Find all usages of a symbol across the entire workspace.
- **Feature**: **File Watcher**: Added background monitoring for file changes (creation/deletion/modification) to keep the workspace cache and file list up-to-date.
### Fixed
- **Fix**: Resolved an issue where "Find All References" and "Rename" would skip files that did not contain any symbol declarations.
- **Fix**: Corrected a bug where function names in their definitions were incorrectly identified as local to their own scope, preventing workspace-wide search from triggering correctly.

## [0.4.3] - 2026-05-05
### Added
- Integrated default semantic token color scopes into the extension package for automatic dark/light theme support.
### Changed
- Refined semantic token assignments to provide better color differentiation:
    - Built-in operators are now mapped to `method` + `defaultLibrary`.
    - System attributes are now mapped to `property` + `defaultLibrary`.
    - User functions use `function`, while local variables use `variable`.
    - User attributes use `enumMember`.

## [0.4.2] - 2026-05-05
### Added
- **Feature**: **Enhanced Semantic Highlighting**: The syntax highlighting engine has been refactored to use a robust token-based parsing approach, providing much more accurate and detailed color-coding.
- **Feature**: **Numerical Literal Highlighting**: Added specific token types for numbers (e.g., `123`, `4.5`), ensuring they are colored distinctly from other identifiers.
- **Feature**: **Improved Built-in Function Recognition**: Operators like `collect_if`, `update`, `create`, and `delete` are now correctly identified and highlighted as functions.
- **Feature**: **Context-Aware Type vs. Function Highlighting**: Correctly distinguishes between type names and functions sharing the same name (e.g., `date()` as a function vs. `date` as a data type) based on surrounding syntax.

## [0.4.1] - 2026-05-05
### Fixed
- Corrected issues with hover descriptions for certain attributes.
- Fixed an error in the validation logic for export tags.

## [0.4.0] - 2026-05-04
### Added
- **Feature**: **User Function Documentation**: Implemented support for parsing and displaying documentation (via JSDoc-style comments) for user-defined functions.
- **Feature**: **User Function Completion**: Added user-defined functions to the completion list with signature help and documentation.
- **Feature**: **Semantic Highlighting for User Functions**: Workspace-wide color-coding for user-defined function calls and definitions.

## [0.3.4] - 2026-05-03
### Added
- Support for `v3.0` operators and attributes.
- Translation support for Japanese documentation.
