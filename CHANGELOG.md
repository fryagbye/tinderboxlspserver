# Change Log

All notable changes to the "tinderbox-action-code-lsp" extension will be documented in this file.

## [0.1.8] - 2025-12-29
### Fixed
- **Hover**: Fixed missing hover information for chained expressions starting with attributes and arguments (e.g., `$Text(aID).eachLine()`).
- **Hover**: Improved method matching by robustly cleaning iterator suffixes (e.g., `{actions}`) from operator names.
- **Hover**: Added fallback to global dot operator lookup when type inference fails.
- **Hover**: Enhanced hover information for untyped local variables, loop variables (`.each()`), and function arguments.
- **Definition**: Implemented "Go to Definition" for user functions, variables, arguments, and loop variables.
- **Definition**: Added scope-aware definition lookup to prioritize local block context.

## [0.1.7] - 2025-12-29
### Changed
- **Documentation**: Added details about `.tbxc` extension auto-detection in README.
- **Documentation**: Reorganized release notes in README with a collapsible section for older versions.

## [0.1.6] - 2025-12-29
### Fixed
- **Localization**: Fixed improper language loading (Japanese settings were ignored in 0.1.5).
- **Validation**: Refined "Missing Semicolon" check to avoid false positives on braces on new lines or control flow (if/else).

## [0.1.5] - 2025-12-29
### Fixed
- **Hover**: Correctly display Data Type description instead of function docs when hovering over type declarations (e.g., `var:string`).
- **Packaging**: Restored `activationEvents` to satisfy `vsce` packaging requirements.

## [0.1.4] - 2025-12-29
### Fixed
- **Dot Completion**: Fixed logic to correctly handle operator scopes and chained calls.
- **Double Insertion**: Fixed duplicate parentheses `()` and attribute prefixes `$` in completions.
- **Global Hover**: Fixed hover information not displaying for global functions due to matching issues.
- **Attributes**: Robustly handle attribute completions regardless of partial typing or cursor position.
- **Arguments**: Added support for attributes with arguments (e.g. `$Name("Note")`) in dot completion.
- **Filtering**: Excluded internal attribute types ("Font-Type", "Action-Type") from completion suggestions.

## [0.1.3] - 2025-12-29
### Added
- Feature: Type-aware dot completion suggestions based on inferred variable types.

### Fixed
- Dot Completion: Attributes are no longer incorrectly suggested after a dot operator.
- Server: Improved CSV parsing logic for `OpScope` and `IsDotOp`.
- Validation: Fixed issue with global variable scoping and syntax errors in server code.

## [0.1.2] - 2025-12-29
### Fixed
- CSV Parsing: Fixed issue where "TextJa" was displayed as description.
- CSV Parsing: Fixed issue where `$Name` attribute was incorrectly skipped.
- Data: Corrected malformed CSV rows (missing quotes).

### Changed
- Documentation: Updated license attribution for data sources.
- Data: Removed embedded license text from CSV files to prevent parsing errors.
## [0.1.1] - 2025-12-28
### Fixed
- Validation: Improved "Missing semicolon" logic to correctly handle single-quoted strings containing operators or brackets.
- Packaging: Added application icon.

## [0.1.0] - 2025-12-28
### Added
- Feature: Autocomplete for Tinderbox Operators and System Attributes.
- Feature: Hover documentation for Operators and Attributes.
- Feature: Reserved word validation and completion.
- Feature: Semicolon and Smart Quote validation.
- Feature: Code completion for local `var` variables and function arguments.
- Configuration: `tinderboxActionCodeServer.language` setting for English/Japanese descriptions.
