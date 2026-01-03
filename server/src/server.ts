import {
    SemanticTokensBuilder,
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    SemanticTokensParams,
    InsertTextFormat,
    Hover,
    Definition,
    Location,
    Range,
    TextEdit,
    DocumentFormattingParams,
    DocumentSymbol,
    SymbolKind,
    DocumentSymbolParams,
    PrepareRenameResult,
    RenameParams,
    WorkspaceEdit
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Define token types globally for consistency
const tokenTypes = ['keyword', 'string', 'number', 'comment', 'variable', 'function', 'property', 'method', 'type', 'parameter', 'enumMember'];
const tokenModifiers: string[] = [];
const legend = { tokenTypes, tokenModifiers };

process.on('uncaughtException', (err: any) => {
    connection.console.error(`Uncaught Exception: ${err?.message || err}`);
});
process.on('unhandledRejection', (reason: any, p) => {
    connection.console.error(`Unhandled Rejection: ${reason?.message || reason}`);
});

try {

    // Create a simple text document manager.
    const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

    let hasConfigurationCapability = false;
    let hasWorkspaceFolderCapability = false;
    let hasDiagnosticRelatedInformationCapability = false;

    connection.onInitialize((params: InitializeParams) => {
        const capabilities = params.capabilities;

        // Does the client support the `workspace/configuration` request?
        // If not, we fall back using global settings.
        hasConfigurationCapability = !!(
            capabilities.workspace && !!capabilities.workspace.configuration
        );
        hasWorkspaceFolderCapability = !!(
            capabilities.workspace && !!capabilities.workspace.workspaceFolders
        );
        hasDiagnosticRelatedInformationCapability = !!(
            capabilities.textDocument &&
            capabilities.textDocument.publishDiagnostics &&
            capabilities.textDocument.publishDiagnostics.relatedInformation
        );

        const result: InitializeResult = {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                // Tell the client that this server supports code completion.
                completionProvider: {
                    resolveProvider: true,
                    triggerCharacters: ['.', ':'] // Trigger on dot for methods, colon for types
                },
                // Semantic Tokens capability
                semanticTokensProvider: {
                    legend: legend,
                    full: { delta: false },
                    range: false
                },
                // Hover Provider capability
                hoverProvider: true,
                // Signature Help capability
                signatureHelpProvider: {
                    triggerCharacters: ['(', ',']
                },
                // Definition Provider capability
                definitionProvider: true,
                // Document Formatting capability
                documentFormattingProvider: true,
                // Document Symbol capability
                documentSymbolProvider: true,
                // Rename capability
                renameProvider: {
                    prepareProvider: true
                }
            }
        };
        if (hasWorkspaceFolderCapability) {
            result.capabilities.workspace = {
                workspaceFolders: {
                    supported: true
                }
            };
        }
        return result;
    });

    connection.onInitialized(() => {
        if (hasConfigurationCapability) {
            // Register for all configuration changes.
            connection.client.register(DidChangeConfigurationNotification.type, undefined);
        }
        if (hasWorkspaceFolderCapability) {
            connection.workspace.onDidChangeWorkspaceFolders(_event => {
                connection.console.log('Workspace folder change event received.');
            });
        }
    });

    // The example settings
    interface TinderboxSettings {
        maxNumberOfProblems: number;
        language: string;
    }

    // The global settings, used when the `workspace/configuration` request is not supported by the client.
    const defaultSettings: TinderboxSettings = { maxNumberOfProblems: 1000, language: 'en' };
    let globalSettings: TinderboxSettings = defaultSettings;

    // Cache the settings of all open documents
    const documentSettings: Map<string, Thenable<TinderboxSettings>> = new Map();

    connection.onDidChangeConfiguration(change => {
        if (hasConfigurationCapability) {
            // Reset all cached document settings
            documentSettings.clear();
        } else {
            globalSettings = <TinderboxSettings>(
                (change.settings.tinderboxActionCodeServer || defaultSettings)
            );
        }

        // Revalidate all open text documents
        documents.all().forEach(validateTextDocument);
    });

    function getDocumentSettings(resource: string): Thenable<TinderboxSettings> {
        if (!hasConfigurationCapability) {
            return Promise.resolve(globalSettings);
        }
        let result = documentSettings.get(resource);
        if (!result) {
            result = connection.workspace.getConfiguration({
                scopeUri: resource,
                section: 'tinderboxActionCodeServer'
            });
            documentSettings.set(resource, result);
        }
        return result;
    }

    // Only keep settings for open documents
    documents.onDidClose(e => {
        documentSettings.delete(e.document.uri);
    });

    connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
        const { textDocument, options } = params;
        const doc = documents.get(textDocument.uri);
        if (!doc) {
            return [];
        }

        const text = doc.getText();
        const lines = text.split(/\r?\n/);
        const indentSize = options.tabSize || 4;
        const indentChar = options.insertSpaces ? ' '.repeat(indentSize) : '\t';

        let currentIndent = 0;
        const newLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let trimmed = line.trim();

            if (trimmed.length === 0) {
                continue;
            }

            // --- Spacing Rule: 2 blank lines before function ---
            if (trimmed.startsWith('function') && newLines.length > 0) {
                // Ensure exactly two blank lines before function
                while (newLines.length > 0 && newLines[newLines.length - 1] === '') {
                    newLines.pop();
                }
                newLines.push('', '');
            }

            // Decrease indent if line starts with closing brace
            // We check for '}' at the very beginning of the trimmed line
            if (trimmed.startsWith('}')) {
                currentIndent = Math.max(0, currentIndent - 1);
            }

            // Apply current indentation
            let newLine = indentChar.repeat(currentIndent) + trimmed;

            // Space optimization for operators (simple version)
            // Ensure space around =, +, -, *, /, ==, !=, <, >, <=, >=
            // We only apply this if it doesn't look like a comment or a string start
            if (!trimmed.startsWith('//') && !trimmed.startsWith('"') && !trimmed.startsWith("'")) {
                // This is a very simplified approach. A full tokenizer would be better.
                // For now, let's just do common ones that are safe.
                newLine = newLine
                    .replace(/\s*([=+*\/<>!]=|[=+*\/<>])\s*/g, ' $1 ') // Add spaces around operators
                    .replace(/\s*,\s*/g, ', ') // Space after comma
                    .replace(/\s*;\s*$/g, ';') // Remove space before trailing semicolon
                    .replace(/ {2,}/g, ' '); // Collapse multiple spaces (but keep indent)

                // Restore indentation which might have been affected by collapse
                const indent = indentChar.repeat(currentIndent);
                newLine = indent + newLine.trim();
                trimmed = newLine.trim(); // Update trimmed for subsequent checks
            }

            // --- Semicolon Completion (Heuristic) ---
            if (!trimmed.endsWith(';') &&
                !trimmed.endsWith('{') &&
                !trimmed.endsWith('}') &&
                !trimmed.endsWith(',') &&
                !trimmed.endsWith('(') &&
                !trimmed.match(/^function\s+/) &&
                !trimmed.match(/^(if|while|each|for)\b/) &&
                !/(^|\s)else$/.test(trimmed) &&
                !/[+\-*/|&=]$/.test(trimmed)
            ) {
                // Check if it ends with alphanumeric or closing paren/quote
                if (/[a-zA-Z0-9_"')]/.test(trimmed[trimmed.length - 1])) {
                    // Check next line (if any) doesn't start with operator or block
                    let nextIdx = i + 1;
                    let nextLine = '';
                    while (nextIdx < lines.length) {
                        nextLine = lines[nextIdx].trim();
                        if (nextLine.length > 0) break;
                        nextIdx++;
                    }
                    if (!/^[\+\-\*\/\.\|&=]/.test(nextLine) && !nextLine.startsWith('{')) {
                        newLine += ';';
                        trimmed += ';'; // Update trimmed for brace check
                    }
                }
            }

            newLines.push(newLine);

            // --- Spacing Rule: 1 blank line after var declaration block ---
            if (trimmed.startsWith('var:')) {
                let nextIdx = i + 1;
                let nextTrimmed = '';
                while (nextIdx < lines.length) {
                    nextTrimmed = lines[nextIdx].trim();
                    if (nextTrimmed.length > 0) break;
                    nextIdx++;
                }
                if (nextTrimmed.length > 0 && !nextTrimmed.startsWith('var:')) {
                    newLines.push('');
                }
            }

            // Increase indent if line ends with opening brace
            if (trimmed.endsWith('{')) {
                currentIndent++;
            }
        }

        return [
            TextEdit.replace(
                Range.create(doc.positionAt(0), doc.positionAt(text.length)),
                newLines.join('\n')
            )
        ];
    });

    connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) {
            return [];
        }

        const text = doc.getText();
        const symbols: DocumentSymbol[] = [];

        // 1. Function patterns: function Name(...)
        const functionPattern = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
        let match: RegExpExecArray | null;

        // Reset index for search
        functionPattern.lastIndex = 0;
        while ((match = functionPattern.exec(text)) !== null) {
            const name = match[1];
            const startPos = doc.positionAt(match.index);
            const endPos = doc.positionAt(match.index + match[0].length);
            const range = Range.create(startPos, endPos);

            // Selection range points to the name specifically
            const nameOffset = match[0].indexOf(name);
            const selectionRange = Range.create(
                doc.positionAt(match.index + nameOffset),
                doc.positionAt(match.index + nameOffset + name.length)
            );

            symbols.push(DocumentSymbol.create(
                name,
                undefined,
                SymbolKind.Function,
                range,
                selectionRange
            ));
        }

        // 2. Variable patterns: var:type Name
        const varPattern = /var(?::[a-zA-Z0-9]+)?\s+([a-zA-Z0-9_]+)/g;
        varPattern.lastIndex = 0;
        while ((match = varPattern.exec(text)) !== null) {
            const name = match[1];
            const startPos = doc.positionAt(match.index);
            const endPos = doc.positionAt(match.index + match[0].length);
            const range = Range.create(startPos, endPos);

            const nameOffset = match[0].indexOf(name);
            const selectionRange = Range.create(
                doc.positionAt(match.index + nameOffset),
                doc.positionAt(match.index + nameOffset + name.length)
            );

            symbols.push(DocumentSymbol.create(
                name,
                undefined,
                SymbolKind.Variable,
                range,
                selectionRange
            ));
        }

        return symbols;
    });

    connection.onPrepareRename((params: TextDocumentPositionParams): PrepareRenameResult | null => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;

        const text = doc.getText();
        const offset = doc.offsetAt(params.position);

        // Find the word at the position
        const before = text.slice(0, offset).split(/[\s,()=+\-*/|&{}]/).pop() || '';
        const after = text.slice(offset).split(/[\s,()=+\-*/|&{}]/)[0] || '';
        const word = before + after;

        if (!word || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word)) {
            return null;
        }

        // Find the range of the word
        const start = offset - before.length;
        return {
            range: Range.create(doc.positionAt(start), doc.positionAt(start + word.length)),
            placeholder: word
        };
    });

    connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
        const { textDocument, position, newName } = params;
        const doc = documents.get(textDocument.uri);
        if (!doc) return null;

        const text = doc.getText();
        const offset = doc.offsetAt(position);
        const before = text.slice(0, offset).split(/[\s,()=+\-*/|&{}]/).pop() || '';
        const after = text.slice(offset).split(/[\s,()=+\-*/|&{}]/)[0] || '';
        const oldName = before + after;

        if (!oldName) return null;

        const edits: TextEdit[] = [];

        // Determine scope: Global or current function
        // This is a simplified scope detection
        let functionScope: { start: number, end: number } | null = null;
        const functionPattern = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*\{/g;
        let match;
        while ((match = functionPattern.exec(text)) !== null) {
            let braceCount = 1;
            let endOffset = match.index + match[0].length;
            while (braceCount > 0 && endOffset < text.length) {
                if (text[endOffset] === '{') braceCount++;
                else if (text[endOffset] === '}') braceCount--;
                endOffset++;
            }
            if (offset >= match.index && offset <= endOffset) {
                functionScope = { start: match.index, end: endOffset };
                break;
            }
        }

        // Find all occurrences of oldName in the determined scope
        // We use a regex that ensures it's a whole word and not inside a string or comment
        const searchPattern = new RegExp(`\\b${oldName}\\b`, 'g');
        const searchRange = functionScope ? text.slice(functionScope.start, functionScope.end) : text;
        const searchOffset = functionScope ? functionScope.start : 0;

        let searchMatch;
        while ((searchMatch = searchPattern.exec(searchRange)) !== null) {
            const absoluteIndex = searchMatch.index + searchOffset;

            // Basic check to see if it's inside a string or comment (very simplified)
            const textToMatch = text.slice(0, absoluteIndex);
            const isInString = (textToMatch.split('"').length % 2 === 0) || (textToMatch.split("'").length % 2 === 0);
            const isInComment = textToMatch.split('\n').pop()?.includes('//');

            if (!isInString && !isInComment) {
                edits.push(TextEdit.replace(
                    Range.create(doc.positionAt(absoluteIndex), doc.positionAt(absoluteIndex + oldName.length)),
                    newName
                ));
            }
        }

        return {
            changes: {
                [textDocument.uri]: edits
            }
        };
    });

    // The content of a text document has changed. This event is emitted
    // when the text document first opened or when its content has changed.
    documents.onDidChangeContent(change => {
        validateTextDocument(change.document);
    });

    async function validateTextDocument(textDocument: TextDocument): Promise<void> {
        // In this simple example we get the settings for every validate run.
        const settings = await getDocumentSettings(textDocument.uri);

        const text = textDocument.getText();
        const diagnostics: Diagnostic[] = [];

        // --- MASKING Step ---
        // --- MASKING Step ---
        let maskedText = text;

        // 1. Mask Strings (Double AND Single Quotes) - to prevent comments/parens inside strings from confusing heuristics
        // Matches "..." or '...' handling escaped quotes
        maskedText = maskedText.replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, (match) => {
            const quote = match[0];
            return quote + ' '.repeat(Math.max(0, match.length - 2)) + quote;
        });

        // 2. Mask Comments
        maskedText = maskedText.replace(/\/\/.*$/gm, (match) => ' '.repeat(match.length));

        // 3. Mask Parens (Keep parens, mask content)
        maskedText = maskedText.replace(/\([^)]*\)/g, (match) => {
            return '(' + ' '.repeat(Math.max(0, match.length - 2)) + ')';
        });

        // --- 1. Smart Quote Check (on MASKED text) ---
        // Fix: Removed '|' from regex as it matched the literal pipe operator
        const smartQuotePattern = /([“”‘’])/g;
        let m: RegExpExecArray | null;
        while ((m = smartQuotePattern.exec(maskedText))) {
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: textDocument.positionAt(m.index),
                    end: textDocument.positionAt(m.index + m[0].length)
                },
                message: `Smart quote '${m[0]}' detected. Use straight quotes (" or ').`,
                source: 'Tinderbox Action Code'
            };
            diagnostics.push(diagnostic);
        }

        // --- Gather Valid Identifiers for Case Check ---
        const validIdentifiers = new Set<string>();
        const lowerToOriginal = new Map<string, string>();

        // 0. Base Keywords (Types, Control, Designators) - to avoid Case Mismatch for valid lowercase keywords
        const baseKeywords = [
            'var', 'if', 'else', 'while', 'do', 'return', 'each', 'to', 'in', 'end',
            'string', 'number', 'boolean', 'list', 'date', 'color', 'set', 'interval',
            'adornment', 'agent', 'cover', 'current', 'find', 'firstSibling', 'grandparent',
            'lastChild', 'lastSibling', 'library', 'next', 'nextItem', 'nextSibling',
            'nextSiblingItem', 'original', 'parent', 'previous', 'previousItem',
            'previousSiblingItem', 'prevSibling', 'randomChild', 'selection', 'that', 'this',
            'adorments', 'all', 'ancestors', 'children', 'descendants', 'siblings',
            'destination', 'source', 'child'
        ];
        baseKeywords.forEach(k => validIdentifiers.add(k));

        // 1. Built-in Operators
        for (const op of tinderboxOperators.values()) {
            validIdentifiers.add(op.name);
            lowerToOriginal.set(op.name.toLowerCase(), op.name);
        }
        // 2. System Attributes
        for (const attr of systemAttributes.values()) {
            validIdentifiers.add(attr.name);
            lowerToOriginal.set(attr.name.toLowerCase(), attr.name);
        }

        // 3. Local Variables (Scan with regex first)
        const varDeclPatternForScan = /var:([a-zA-Z0-9]+)\s+([a-zA-Z0-9_]+)(?:\s*=\s*([^;]+))?;?/g;
        while ((m = varDeclPatternForScan.exec(text))) {
            validIdentifiers.add(m[1]); // Type name (if user defines var:Type)
            validIdentifiers.add(m[2]); // Variable Name
            lowerToOriginal.set(m[2].toLowerCase(), m[2]);
        }

        // 4. User Functions
        const funcPatternForScan = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
        while ((m = funcPatternForScan.exec(text))) {
            validIdentifiers.add(m[1]);
            lowerToOriginal.set(m[1].toLowerCase(), m[1]);
        }

        // --- 2. Case Sensitivity Check (on MASKED text) ---
        const wordPattern = /\b([a-zA-Z0-9_$]+)\b/g;
        while ((m = wordPattern.exec(maskedText))) {
            const word = m[0];
            if (validIdentifiers.has(word)) continue;

            const lower = word.toLowerCase();
            if (lowerToOriginal.has(lower)) {
                const correctCase = lowerToOriginal.get(lower);
                if (correctCase && correctCase !== word) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Warning,
                        range: {
                            start: textDocument.positionAt(m.index),
                            end: textDocument.positionAt(m.index + word.length)
                        },
                        message: `Case Mismatch: '${word}' should be '${correctCase}'.`,
                        source: 'Tinderbox Action Code'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }

        // --- 3. Missing Semicolon Check (Heuristic on MASKED text) ---
        const lines = maskedText.split(/\r?\n/);
        let charOffset = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Allow empty lines, comments (masked to spaces), lines ending with { or } or , or (
            if (trimmed.length > 0 &&
                !trimmed.endsWith(';') &&
                !trimmed.endsWith('{') &&
                !trimmed.endsWith('}') &&
                !trimmed.endsWith(',') &&
                !trimmed.endsWith('(') &&
                !trimmed.match(/^function\s+/)
            ) {

                // If it looks like a statement (alphanumeric or closing paren/quote)
                // Check if the current line ends with an operator that suggests continuation
                const endsWithOperator = /[+\-*/|&=]$/.test(trimmed);

                // Check ahead for next line starting with operator OR block
                let nextLineStartsOperator = false;
                let nextLineStartsBlock = false;
                if (i < lines.length - 1) {
                    const nextLine = lines[i + 1].trim();
                    if (/^[\+\-\*\/\.\|&=]/.test(nextLine)) {
                        nextLineStartsOperator = true;
                    }
                    if (nextLine.startsWith('{')) {
                        nextLineStartsBlock = true;
                    }
                }

                // Skip if:
                // 1. Ends with operator
                // 2. Next line starts with operator
                // 3. Next line starts with { (Block start)
                // 4. Ends with 'else' (e.g. "} else")
                // 5. Starts with Control Keyword (if, while, each, for)
                const isControlStatement = /^(if|while|each|for|function)\b/.test(trimmed);
                const endsWithElse = /(^|\s)else$/.test(trimmed);

                if (!endsWithOperator &&
                    !nextLineStartsOperator &&
                    !nextLineStartsBlock &&
                    !isControlStatement &&
                    !endsWithElse &&
                    /[a-zA-Z0-9_"')]/.test(trimmed[trimmed.length - 1])) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Warning,
                        range: {
                            start: { line: i, character: line.length }, // Point to EOL (approx)
                            end: { line: i, character: line.length }
                        },
                        message: `Missing semicolon?`,
                        source: 'Tinderbox Action Code'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            charOffset += line.length + 1; // +1 for newline
        }


        // --- 4. Assignment Type Checking (Existing Logic) ---
        // Regex for System Attributes: $Name = Value
        const attrAssignmentPattern = /(\$[a-zA-Z0-9_]+)\s*=\s*([^;]+);?/g;

        // Regex for Local Var Declaration: var:type name (= value)?
        const varDeclPattern = /var:([a-zA-Z0-9]+)\s+([a-zA-Z0-9_]+)(?:\s*=\s*([^;]+))?;?/g;

        // Regex for Local Var Assignment: name = value
        // Note: This is broad, might catch non-vars. We verify against declaredLocalVars.
        const varAssignPattern = /([a-zA-Z0-9_]+)\s*=\s*([^;]+);?/g;

        // 4.1. Scan for System Attributes Assignments
        while ((m = attrAssignmentPattern.exec(text))) {
            const varName = m[1];
            const rhs = m[2].trim();
            const attr = systemAttributes.get(varName);

            if (attr) {
                const inferredType = evaluateExpressionType(rhs);
                if (inferredType && !isCompatible(attr.type, inferredType)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Warning,
                        range: {
                            start: textDocument.positionAt(m.index),
                            end: textDocument.positionAt(m.index + m[0].length)
                        },
                        message: `Type Mismatch: '${varName}' is ${attr.type}, but assigned ${inferredType}.`,
                        source: 'Tinderbox Action Code'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }

        // 4.2. Scan for Local Variable Declarations & Assignments
        // We need to parse line by line or generally to build scope? 
        // For simplicity in this regex-based approach, we scan the whole doc to find declarations 
        // and put them in a map. (Ignoring scope for now - treating as file-scope).
        const localVars = new Map<string, string>(); // Name -> Type

        // 4.2.1. Declaration pass
        // reservedWords is now a global Set populated at startup

        while ((m = varDeclPattern.exec(text))) {
            const typeDecl = m[1];
            const varName = m[2];

            // --- NEW: Reserved Word Check ---
            if (reservedWords.has(varName)) {
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(m.index + m[0].indexOf(varName)),
                        end: textDocument.positionAt(m.index + m[0].indexOf(varName) + varName.length)
                    },
                    message: `Reserved Word Error: '${varName}' cannot be used as a variable name.`,
                    source: 'Tinderbox Action Code'
                };
                diagnostics.push(diagnostic);
            }
            const rhs = m[3] ? m[3].trim() : null;

            localVars.set(varName, typeDecl);

            if (rhs) {
                const inferredType = evaluateExpressionType(rhs, localVars);
                // Declared type might be "num", "string". Normalize?
                // Action code uses "number", "string", "boolean", "color", "date", "set", "list" usually.
                // Or shorthand?

                if (inferredType && !isCompatible(typeDecl, inferredType)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Warning,
                        range: {
                            start: textDocument.positionAt(m.index),
                            end: textDocument.positionAt(m.index + m[0].length)
                        },
                        message: `Type Mismatch: Variable '${varName}' declared as ${typeDecl}, but initialized with ${inferredType}.`,
                        source: 'Tinderbox Action Code'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }

        // 4.2.2. Assignment pass (reuse regex or reset?)
        // We need to check assignments to these local vars.
        // Re-running regex on text might overlap. 
        // We should probably iterate tokens properly, but let's do a separate pass for assignments.

        while ((m = varAssignPattern.exec(text))) {
            const varName = m[1];
            const rhs = m[2].trim();

            // Is it a local var?
            if (localVars.has(varName)) {
                const declaredType = localVars.get(varName);
                if (declaredType) {
                    const inferredType = evaluateExpressionType(rhs, localVars);
                    if (inferredType && !isCompatible(declaredType, inferredType)) {
                        const diagnostic: Diagnostic = {
                            severity: DiagnosticSeverity.Warning,
                            range: {
                                start: textDocument.positionAt(m.index),
                                end: textDocument.positionAt(m.index + m[0].length)
                            },
                            message: `Type Mismatch: Variable '${varName}' is ${declaredType}, but assigned ${inferredType}.`,
                            source: 'Tinderbox Action Code'
                        };
                        diagnostics.push(diagnostic);
                    }
                }
            }
        }

        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
    }

    // --- Helper for Type Inference ---
    function recursiveInferType(text: string, document: TextDocument, offset: number): string | null {
        // Look backwards from offset
        const content = document.getText();
        const before = content.slice(0, offset).trimEnd();

        // 1. Check for method call at end: e.g. .reverse()
        // We match parentheses balanced? No, regex is hard.
        // Simple heuristic: ".methodName("
        const methodMatch = before.match(/\.([a-zA-Z0-9_]+)\s*\([^)]*\)$/);
        // Note: this regex is simplistic and won't handle nested parens well.
        // For accurate chaining, we might need a better parser or step backwards token by token.
        // Let's try a simpler approach: match the immediate preceding token.

        // Better Approach: extract the chain.
        // Find the start of the expression ending at offset.
        // e.g. "$MyList.sort.reverse" (cursor after reverse)
        // or "$MyList.sort().reverse"

        // Let's rely on valid identifier chars and dots and parens.
        // Traverse backwards until we hit a terminator (space, ;, {, etc)
        let i = offset - 1;
        let depth = 0;
        while (i >= 0) {
            const char = content[i];
            if (char === ')') depth++;
            else if (char === '(') depth--;
            else if (depth === 0 && /[;{}\s=]/.test(char)) {
                break;
            }
            i--;
        }
        const expr = content.slice(i + 1, offset).trim();

        if (!expr) return null;

        // Gather locals to help inference
        const locals = new Map<string, string>();
        const varRegex = /var(?::([a-zA-Z0-9_]+))?\s+([a-zA-Z0-9_]+)/g;
        let m;
        // Scan broad content for vars (simple file scope assumption)
        while ((m = varRegex.exec(content))) {
            if (m[1] && m[2]) {
                locals.set(m[2], m[1].toLowerCase());
            }
        }

        return evaluateExpressionType(expr, locals);
    }

    // --- Helper to evaluate expression type ---
    function evaluateExpressionType(expr: string, locals?: Map<string, string>): string | null {
        expr = expr.trim();
        // 1. Literal Strings
        if (/^".*"$/.test(expr) || /^'.*'$/.test(expr)) return 'string';
        // 2. Literal Numbers
        if (/^-?\d+(\.\d+)?$/.test(expr)) return 'number'; // Added -? for negative numbers
        // 3. Literal Booleans
        if (/^(true|false)$/i.test(expr)) return 'boolean'; // Added from original inferType
        // 4. Literal Colors
        if (/^#[0-9a-fA-F]{6}$/.test(expr)) return 'color'; // Added from original inferType
        // 5. Literal Lists
        if (/^\[.*\]$/.test(expr)) return 'list';
        // 6. Literal Sets (simple check)
        if (/^\{.*\}$/.test(expr)) return 'set'; // Added from original evaluateExpressionType

        // 7. Variables
        if (/^[a-zA-Z0-9_]+$/.test(expr)) {
            if (locals && locals.has(expr)) return locals.get(expr)!;
            // Try global attributes if it matches? No, variables are usually discrete.
        }

        // 8. System Attributes
        if (expr.startsWith('$')) {
            // Check for arguments e.g. $Name("Note") or $Name(/path/to)
            // Strip parens and args for type lookup
            const bareAttr = expr.replace(/\(.*\)$/, '');

            const parts = bareAttr.split('.');
            // Simple attribute reference
            if (parts.length === 1) {
                const attr = systemAttributes.get(bareAttr);
                return attr ? attr.type.toLowerCase() : null;
            }
        }

        // 9. Dot Chains: something.method() or $Attr.method
        // We find the last dot that is NOT inside parentheses
        let parenDepth = 0;
        let lastDotIndex = -1;
        for (let j = expr.length - 1; j >= 0; j--) {
            if (expr[j] === ')') parenDepth++;
            else if (expr[j] === '(') parenDepth--;
            else if (expr[j] === '.' && parenDepth === 0) {
                lastDotIndex = j;
                break;
            }
        }

        if (lastDotIndex > 0) {
            const left = expr.substring(0, lastDotIndex);
            const right = expr.substring(lastDotIndex + 1); // methodName or methodName(...)

            const leftType = evaluateExpressionType(left, locals);

            if (leftType) {
                const methodName = right.replace(/\(.*\)$/, '').trim();
                // Look up method on leftType
                const methods = typeMethods.get(leftType.toLowerCase());
                if (methods) {
                    const op = methods.find(m => {
                        // FIX: CSV names often have (), e.g. "String.lowercase()".
                        // User might type "$Name.lowercase".
                        // We must strip parens from the DEFINITION for comparison.
                        const suffix = m.name.split('.').pop()?.replace(/\(.*\)$/, '') || m.name;
                        return suffix === methodName;
                    });
                    // Return type from CSV is often capitalized "List", "String" -> convert to lowercase
                    if (op && op.returnType) {
                        return op.returnType.toLowerCase();
                    }
                }
            }
        }

        return null;
    }

    function isCompatible(targetType: string, valueType: string): boolean {
        const normTarget = targetType.toLowerCase();
        const normValue = valueType.toLowerCase();

        if (normTarget === 'string' && normValue === 'string') return true;
        if (normTarget === 'number' && normValue === 'number') return true;
        if (normTarget === 'boolean' && normValue === 'boolean') return true;
        if (normTarget === 'color' && (normValue === 'color' || normValue === 'string')) return true; // Colors are often strings?
        if (normTarget === 'list' && (normValue === 'list' || normValue === 'set')) return true;
        if (normTarget === 'set' && (normValue === 'list' || normValue === 'set')) return true;

        // Loose compatibility for others or unknown types
        return true;
    }

    function escapeRegExp(string: string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    connection.onDidChangeWatchedFiles(_change => {
        // Monitored files have change in VSCode
        connection.console.log('We received an file change event');
    });

    // Load keywords from file
    // --- Variables ---
    interface TinderboxOperator {
        name: string;
        type: string; // OpType
        returnType: string; // OpReturnType
        isDotOp: boolean;
        opScope: string;
        signature: string;
        description: string;
        descriptionJa?: string;
        kind: CompletionItemKind;
    }

    const tinderboxOperators = new Map<string, TinderboxOperator>();
    const typeMethods = new Map<string, TinderboxOperator[]>(); // Map<lowercasedType, operators[]>
    const dotOperatorsMap = new Map<string, TinderboxOperator[]>(); // Map<suffix, operator[]> for fallback
    const operatorFamilies = new Map<string, string[]>(); // Map<FamilyName, members[]>

    // Helper to add operator to typeMethods map
    function addOpToType(type: string, op: TinderboxOperator) {
        if (!typeMethods.has(type)) {
            typeMethods.set(type, []);
        }
        // Prevent duplicates
        const methods = typeMethods.get(type)!;
        if (!methods.includes(op)) {
            methods.push(op);
        }
    }

    interface SystemAttribute {
        name: string;
        type: string;
        group: string;
        defaultValue: string;
        readOnly: boolean;
        description: string;
        descriptionJa?: string;
    }

    interface DataType {
        name: string;
        description: string;
        descriptionJa?: string;
    }


    const lowerCaseOperators: Map<string, string> = new Map(); // Case-insensitive lookup

    const systemAttributes: Map<string, SystemAttribute> = new Map();
    const tinderboxDataTypes: Map<string, DataType> = new Map();
    // keywordNames is used for fast lookup in semantic tokens
    const keywordNames: Set<string> = new Set();
    // Reserved words for validation
    const reservedWords: Set<string> = new Set();
    // Reserved words strictly from file (for Completion)
    const textReservedWords: Set<string> = new Set();

    try {
        const fs = require('fs');
        const path = require('path');

        // --- Load Operators from CSV ---
        const operatorsPath = path.join(__dirname, '..', '..', 'extract_operators.csv');
        const devOperatorsPath = path.join(__dirname, '..', '..', 'server', 'extract_operators.csv');
        const rootOperatorsPath = path.join(__dirname, '..', '..', '..', 'extract_operators.csv');

        let opCsvContent = '';
        if (fs.existsSync(rootOperatorsPath)) opCsvContent = fs.readFileSync(rootOperatorsPath, 'utf-8');
        else if (fs.existsSync(operatorsPath)) opCsvContent = fs.readFileSync(operatorsPath, 'utf-8');
        else connection.console.warn('Could not find extract_operators.csv');

        // Reuse CSV parser
        const parseCSV = (text: string) => {
            const rows = [];
            let currentRow = [];
            let currentField = '';
            let insideQuotes = false;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                const nextChar = text[i + 1];
                if (char === '"') {
                    if (insideQuotes && nextChar === '"') {
                        currentField += '"';
                        i++;
                    } else {
                        insideQuotes = !insideQuotes;
                    }
                } else if (char === ',' && !insideQuotes) {
                    currentRow.push(currentField);
                    currentField = '';
                } else if ((char === '\r' || char === '\n') && !insideQuotes) {
                    if (char === '\r' && nextChar === '\n') i++;
                    currentRow.push(currentField);
                    rows.push(currentRow);
                    currentRow = [];
                    currentField = '';
                } else {
                    currentField += char;
                }
            }
            if (currentField || currentRow.length > 0) {
                currentRow.push(currentField);
                rows.push(currentRow);
            }
            return rows;
        };

        if (opCsvContent) {
            const rows = parseCSV(opCsvContent);
            // Migrated logic:

            let successCount = 0;
            rows.forEach((row, index) => {
                if (index === 0) return; // Skip header
                if (row.length >= 5) {
                    const label = row[0].trim();
                    // Fix: Skip empty labels or comments (if any)
                    if (!label || label.startsWith('#')) return;

                    const isDotOp = row[13]?.toLowerCase() === 'true';
                    const opScope = row[2]?.trim() || 'Item';

                    const op: TinderboxOperator = {
                        name: label,
                        type: row[3], // OpType
                        returnType: row[4], // OpReturnType
                        isDotOp: isDotOp,
                        opScope: opScope,
                        signature: label + (row[11] && parseInt(row[11]) > 0 ? '(...)' : ''), // Simple signature approximation
                        description: row[23] || '',
                        descriptionJa: row[24],
                        kind: CompletionItemKind.Function // Default
                    };

                    // Refine Kind
                    if (op.type.toLowerCase().includes('cond')) {
                        op.kind = CompletionItemKind.Keyword;
                    }

                    tinderboxOperators.set(label, op);

                    // Populate typeMethods based on OpScope matching
                    if (isDotOp) {
                        const scope = opScope.toLowerCase();

                        // Rules for Scope -> Types
                        // Rules for Scope -> Types
                        if (scope === 'item') {
                            // Heuristic Fix: The CSV often marks type-specific operators as "Item".
                            // If the name starts with "List.", "String.", etc., treat it as that type.
                            const lowerName = label.toLowerCase();
                            if (lowerName.startsWith('list.')) {
                                addOpToType('list', op);
                                addOpToType('set', op); // Assuming lists/sets share
                            } else if (lowerName.startsWith('set.')) {
                                addOpToType('set', op);
                                addOpToType('list', op);
                            } else if (lowerName.startsWith('string.')) {
                                addOpToType('string', op);
                            } else if (lowerName.startsWith('number.')) {
                                addOpToType('number', op);
                            } else if (lowerName.startsWith('date.')) {
                                addOpToType('date', op);
                            } else if (lowerName.startsWith('color.')) {
                                addOpToType('color', op);
                            } else if (lowerName.startsWith('boolean.')) {
                                addOpToType('boolean', op);
                            } else if (lowerName.startsWith('dictionary.')) {
                                addOpToType('dictionary', op);
                            } else if (lowerName.startsWith('interval.')) {
                                addOpToType('interval', op);
                            } else {
                                // Truly generic "Item" scope
                                ['string', 'list', 'set', 'number', 'color', 'boolean', 'dictionary', 'date', 'interval'].forEach(t => addOpToType(t, op));
                            }
                        } else if (scope === 'list') {
                            addOpToType('list', op);
                            addOpToType('set', op);
                        } else if (scope === 'set') {
                            addOpToType('set', op);
                            addOpToType('list', op); // Assuming Set methods often work on Lists too or vice versa? User said "List- or Set-type" usually implies both.
                        } else {
                            // Direct mapping: "String", "Number", "Color" etc.
                            addOpToType(scope, op);
                        }

                        // Also populate dotOperatorsMap (Suffix based) for hover fallback
                        // We extract suffix after LAST dot
                        const dotIdx = label.lastIndexOf('.');
                        const cleanLabel = label.replace(/\(.*\)$/, '').replace(/\{.*\}$/, '').replace(/\(.*\)/, '');
                        if (dotIdx > 0) {
                            const suffix = label.substring(dotIdx + 1);
                            const cleanSuffix = suffix.replace(/\(.*\)$/, '').replace(/\{.*\}$/, '').replace(/\(.*\)/, '');
                            if (cleanSuffix) {
                                if (!dotOperatorsMap.has(cleanSuffix)) {
                                    dotOperatorsMap.set(cleanSuffix, []);
                                }
                                dotOperatorsMap.get(cleanSuffix)?.push(op);
                            }
                        } else {
                            if (cleanLabel) {
                                if (!dotOperatorsMap.has(cleanLabel)) {
                                    dotOperatorsMap.set(cleanLabel, []);
                                }
                                dotOperatorsMap.get(cleanLabel)?.push(op);
                            }
                        }
                    }

                    // OpFamily logic (independent of IsDotOp, usually for static access like Color.blue)
                    const dotIdx = label.indexOf('.');
                    if (dotIdx > 0 && !label.includes(' ')) {
                        const familyName = label.substring(0, dotIdx);
                        if (!operatorFamilies.has(familyName)) {
                            operatorFamilies.set(familyName, []);
                        }
                        // Avoid duplicates
                        const member = label.substring(dotIdx + 1);
                        if (!operatorFamilies.get(familyName)?.includes(member)) {
                            operatorFamilies.get(familyName)?.push(member);
                        }
                    }

                    successCount++;
                }
            });
            connection.console.log(`Loaded ${successCount} operators.`);

            connection.console.log(`Loaded ${tinderboxOperators.size} operators from CSV.`);

            // Add operators to reserved words
            for (const opName of tinderboxOperators.keys()) {
                reservedWords.add(opName);
            }
        }

        // --- Load Reserved Words from File ---
        const reservedPathRoot = path.join(__dirname, '..', '..', '..', 'reserved_list.txt');
        const reservedPathDev = path.join(__dirname, '..', '..', 'reserved_list.txt');

        let reservedPath = '';
        if (fs.existsSync(reservedPathRoot)) reservedPath = reservedPathRoot;
        else if (fs.existsSync(reservedPathDev)) reservedPath = reservedPathDev;

        if (reservedPath) {
            const content = fs.readFileSync(reservedPath, 'utf-8');
            content.split(/\r?\n/).forEach((line: string) => {
                const word = line.trim();
                if (word) {
                    reservedWords.add(word);
                    textReservedWords.add(word);
                }
            });
            connection.console.log(`Loaded ${textReservedWords.size} keywords from file.`);
        } else {
            connection.console.warn(`Could not find reserved_list.txt at ${reservedPathRoot} or ${reservedPathDev}`);
        }

        // --- Load System Attributes ---
        const rootPath = path.join(__dirname, '..', '..', '..', 'system_attributes.csv');
        let csvContent = '';
        if (fs.existsSync(rootPath)) {
            csvContent = fs.readFileSync(rootPath, 'utf-8');
        } else if (fs.existsSync('/Users/tk4o2ka/github/tinderboxlspserver/system_attributes.csv')) {
            csvContent = fs.readFileSync('/Users/tk4o2ka/github/tinderboxlspserver/system_attributes.csv', 'utf-8');
        } else {
            connection.console.warn('Could not find system_attributes.csv');
        }

        if (csvContent) {
            // Simple CSV parser handling multiline quotes
            const parseCSV = (text: string) => {
                const rows = [];
                let currentRow = [];
                let currentField = '';
                let insideQuotes = false;

                for (let i = 0; i < text.length; i++) {
                    const char = text[i];

                    if (char === '"') {
                        if (insideQuotes && text[i + 1] === '"') {
                            currentField += '"';
                            i++;
                        } else {
                            insideQuotes = !insideQuotes;
                        }
                    } else if (char === ',' && !insideQuotes) {
                        currentRow.push(currentField);
                        currentField = '';
                    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
                        if (char === '\r' && text[i + 1] === '\n') i++;
                        currentRow.push(currentField);
                        rows.push(currentRow);
                        currentRow = [];
                        currentField = '';
                    } else {
                        currentField += char;
                    }
                }
                if (currentField || currentRow.length > 0) {
                    currentRow.push(currentField);
                    rows.push(currentRow);
                }
                return rows;
            };

            const parsedRows = parseCSV(csvContent);
            // Skip header (row 0)
            for (let i = 1; i < parsedRows.length; i++) {
                const row = parsedRows[i];
                if (row.length < 18) continue;
                const firstCol = row[0].trim().replace(/^"|"$/g, '');
                // Check if it's the header row (Name, AttributeDataType, ...)
                if (firstCol.toLowerCase() === 'name' && row[1].trim() === 'AttributeDataType') continue;
                if (firstCol.startsWith('#')) continue;

                // Name,AttributeDataType,AttributeDefault,AttributeGroup,AttributePurpose,AttributeInheritsPrefs,AttributeReadOnly,AttributeIntrinsic,OriginalVersion,CodeFirstAdded,CodeAltered,PlainLinkCount,TextLinkCount,WebLinkCount,ChangeRefSet,IsInternalOnly,HasUISetting,Text
                // Name,AttributeDataType,...
                const name = '$' + firstCol; // Add $ prefix
                // Check type and skip if excluded
                const rawType = row[1]?.trim().replace(/^"|"$/g, '') || 'string';
                const normType = rawType.toLowerCase().replace(/[^a-z]/g, '');
                if (normType === 'action' || normType === 'font' || normType === 'actiontype' || normType === 'fonttype') {
                    continue;
                }

                const attr: SystemAttribute = {
                    name: name,
                    type: rawType,
                    group: row[3],
                    defaultValue: row[2],
                    readOnly: row[6].toLowerCase() === 'true',
                    description: row[17] ? row[17].replace(/^"|"$/g, '').replace(/(\r\n|\n|\r)/g, '  \n') : '',
                    descriptionJa: row[18] ? row[18].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/(\r\n|\n|\r)/g, '  \n') : undefined
                };
                systemAttributes.set(name, attr);
                keywordNames.add(name); // Add to semantic tokens list
            }
            connection.console.log(`Loaded ${systemAttributes.size} system attributes.`);
        }

        // --- Load Data Types ---
        const typesPath = path.join(__dirname, '..', '..', '..', 'data_types_v2.csv');
        let typesContent = '';
        if (fs.existsSync(typesPath)) {
            typesContent = fs.readFileSync(typesPath, 'utf-8');
        } else if (fs.existsSync('/Users/tk4o2ka/github/tinderboxlspserver/data_types_v2.csv')) {
            typesContent = fs.readFileSync('/Users/tk4o2ka/github/tinderboxlspserver/data_types_v2.csv', 'utf-8');
        } else {
            connection.console.warn('Could not find data_types_v2.csv');
        }

        if (typesContent) {
            const rows = parseCSV(typesContent);
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < 3) continue;
                const rawName = row[0].trim().replace(/^"|"$/g, '');
                // Name format: "Action-Type Attributes" -> "action"
                // Name format: "Action-Type Attributes" -> "action"
                const typeKey = rawName.split('-')[0].toLowerCase();

                if (typeKey === 'action' || typeKey === 'font') continue;

                const dataType: DataType = {
                    name: rawName,
                    description: row[1].replace(/^"|"$/g, '').replace(/(\r\n|\n|\r)/g, '  \n'),
                    descriptionJa: row[2] ? row[2].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/(\r\n|\n|\r)/g, '  \n') : undefined
                };
                tinderboxDataTypes.set(typeKey, dataType);
                // Handle "boolean" explicit overlap if needed, but key is safe
            }
            connection.console.log(`Loaded ${tinderboxDataTypes.size} data types.`);
        }

    } catch (err: any) {
        connection.console.error(`Failed to load data: ${err.message}`);
    }



    // This handler provides the initial list of the completion items.
    connection.onCompletion(
        async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
            const document = documents.get(textDocumentPosition.textDocument.uri);
            const content = document?.getText();

            if (!document || !content) return [];

            const settings = await getDocumentSettings(textDocumentPosition.textDocument.uri);
            const lang = settings.language;
            let textBefore = '';
            let triggerPrefix = ''; // FIX: Restore missing declaration

            if (content && document) {
                const offset = document.offsetAt(textDocumentPosition.position);
                textBefore = content.slice(0, offset).trimEnd();
            }

            // FIX: Update regex to support arguments with quotes, slashes, spaces (e.g. $Name("target"). )
            const dotMatch = textBefore.match(/([$a-zA-Z0-9_.()\[\]"'/\- ]+)\.([a-zA-Z0-9_]*)$/);

            if (dotMatch) {
                const receiver = dotMatch[1]; // e.g. "vList", "Color", "$Name"
                const partial = dotMatch[2];  // e.g. "so", ""
                let type: string | null = null;

                // 1. System Attribute (Direct lookup with potential args)
                if (receiver.startsWith('$')) {
                    // Strip args ($Name("foo") -> $Name)
                    const bareReceiver = receiver.replace(/\(.*\)$/, '');
                    const attr = systemAttributes.get(bareReceiver);
                    if (attr) type = attr.type;
                }

                // 2. Class/Group (e.g. Color.blue)
                if (!type && operatorFamilies.has(receiver)) {
                    triggerPrefix = receiver; // Fallback to existing logic for families
                }

                // 3. Local Variable
                if (!type) {
                    const varRegex = new RegExp(`var:([a-zA-Z0-9_]+)\\s+${escapeRegExp(receiver)}\\b`, 'g');
                    let mVar;
                    varRegex.lastIndex = 0;
                    while ((mVar = varRegex.exec(content))) {
                        type = mVar[1];
                    }
                }

                // 4. Recursive Inference (Chaining)
                if (!type) {
                    // Pass position of the dot to infer what comes before it
                    const dotIndex = textBefore.lastIndexOf('.');
                    type = recursiveInferType(content, document, dotIndex);
                }

                if (type) {
                    const methods = typeMethods.get(type.toLowerCase());
                    if (methods) {
                        return methods
                            .filter(op => {
                                const suffix = op.name.split('.').pop() || op.name;
                                return suffix.toLowerCase().startsWith(partial.toLowerCase());
                            })
                            .map(op => {
                                const suffix = op.name.split('.').pop() || op.name;
                                const desc = (lang === 'ja' && op.descriptionJa) ? op.descriptionJa : op.description;
                                // Strip () AND (args) from suffix/name before appending our own snippet parens
                                // "lowercase()" -> "lowercase", "sort(attrs)" -> "sort"
                                const cleanSuffix = suffix.replace(/\(.*\)$/, '');
                                return {
                                    label: suffix,
                                    kind: CompletionItemKind.Method,
                                    detail: op.signature,
                                    documentation: { kind: 'markdown', value: `**${op.name}**\n\n${desc}` },
                                    insertText: `${cleanSuffix}($0)`, // Always empty parens with cursor inside
                                    insertTextFormat: InsertTextFormat.Snippet,
                                    data: { type: 'operator', key: op.name, language: lang }
                                };
                            });
                    }

                }

                // 5. Operator Families (e.g. Color.blue)
                if (triggerPrefix && operatorFamilies.has(triggerPrefix)) {
                    const members = operatorFamilies.get(triggerPrefix) || [];
                    return members.map((mem) => {
                        const fullName = triggerPrefix + '.' + mem;
                        const op = tinderboxOperators.get(fullName);
                        const isFunc = op && (op.kind === CompletionItemKind.Function || op.kind === CompletionItemKind.Method);
                        const desc = (lang === 'ja' && op?.descriptionJa) ? op.descriptionJa : op?.description;
                        return {
                            label: mem,
                            kind: op ? op.kind : CompletionItemKind.Method,
                            detail: op ? op.signature : fullName,
                            documentation: desc ? { kind: 'markdown', value: desc } : undefined,
                            insertText: isFunc ? `${mem}($0)` : mem,
                            insertTextFormat: isFunc ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
                            data: { type: 'operator', key: fullName, language: lang }
                        };
                    });
                }

                // STRICT RETURN for Dot Completion
                // If we found a dot, we MUST return something related to it (or nothing).
                // We must NOT fall through to the global list (which includes attributes).
                return [];
            }
            // Fallback for non-dot completion (Global)


            const completions: CompletionItem[] = Array.from(tinderboxOperators.values())
                .filter(op => !op.name.includes('.'))
                .map((op) => {
                    const isFunc = op.kind === CompletionItemKind.Function || op.kind === CompletionItemKind.Method;
                    // FIX: Strip parens from global functions too
                    const cleanName = op.name.replace(/\(.*\)$/, '');
                    return {
                        label: op.name, // Label keeps parens for clarity? Or clean? User wants clean insertion.
                        // Actually, if label has parens, VS Code validation might fail if insertText is different?
                        // Usually label is display.
                        kind: op.kind,
                        detail: op.signature,
                        insertText: isFunc ? `${cleanName}($0)` : cleanName,
                        insertTextFormat: isFunc ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
                        data: { type: 'operator', key: op.name, language: lang }
                    };
                });

            for (const family of operatorFamilies.keys()) {
                if (!tinderboxOperators.has(family)) {
                    completions.push({
                        label: family,
                        kind: CompletionItemKind.Class,
                        detail: `Class/Group: ${family}`,
                        data: { type: 'family', key: family, language: lang }
                    });
                }
            }

            // FIX: Robust backward scan for $ trigger
            // We scan backwards from offset-1 until we hit a non-identifier char.
            // If the char BEFORE the identifier is $, then hasDollarTrigger = true.
            const offset = (document && content) ? document.offsetAt(textDocumentPosition.position) : 0;
            let scanIdx = (content && offset > 0) ? offset - 1 : -1;

            // Skip current word part (e.g. "Na" in "$Na")
            while (scanIdx >= 0 && content && /[a-zA-Z0-9_]/.test(content[scanIdx])) {
                scanIdx--;
            }
            // Now scanIdx point to the char BEFORE the word, or -1.
            const charBefore = (scanIdx >= 0 && content) ? content[scanIdx] : '';
            const hasDollarTrigger = charBefore === '$';

            const attrCompletions: CompletionItem[] = Array.from(systemAttributes.values())
                .map((attr) => {
                    const item: CompletionItem = {
                        label: attr.name,
                        kind: CompletionItemKind.Variable,
                        detail: `${attr.type} (Default: ${attr.defaultValue})`,
                        // Simple check: if already have $, don't insert it again.
                        insertText: hasDollarTrigger ? attr.name.substring(1) : attr.name,
                        data: { type: 'attribute', key: attr.name, language: lang }
                    };
                    return item;
                });

            // --- NEW: Function Snippet ---
            completions.push({
                label: 'function',
                kind: CompletionItemKind.Snippet,
                insertText: 'function ${1:name}(${2:args}){\n\t$0\n}',
                insertTextFormat: InsertTextFormat.Snippet,
                detail: 'Define a function',
                data: { language: lang }
            });

            // --- NEW: Dynamic Function Detection ---
            if (content) {
                // 1. User Functions
                const funcPattern = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
                let m;
                // We need to reset regex lastIndex if we reuse or just loop
                while ((m = funcPattern.exec(content))) {
                    const funcName = m[1];
                    const args = m[2];
                    completions.push({
                        label: funcName,
                        kind: CompletionItemKind.Function,
                        detail: `User Function: (${args})`,
                        data: { type: 'user_func', key: funcName, language: lang }
                    });

                    // 2. Function Arguments (Global harvest for simplicity)
                    if (args) {
                        const argList = args.split(',');
                        for (const arg of argList) {
                            const trimmedArg = arg.trim();
                            if (!trimmedArg) continue;
                            const parts = trimmedArg.split(':');
                            const argName = parts[0].trim();
                            const argType = parts[1] ? parts[1].trim() : 'any';

                            // Avoid duplicates if possible (simple check)
                            if (!completions.some(c => c.label === argName)) {
                                completions.push({
                                    label: argName,
                                    kind: CompletionItemKind.Variable,
                                    detail: `Argument (${argType})`,
                                    data: { type: 'argument', key: argName, language: lang }
                                });
                            }
                        }
                    }
                }

                // 3. Local Variables
                const varRegex = /var(?::[a-zA-Z0-9_]+)?\s+([a-zA-Z0-9_]+)/g;
                let mVar;
                while ((mVar = varRegex.exec(content))) {
                    const varName = mVar[1];
                    if (!completions.some(c => c.label === varName)) {
                        completions.push({
                            label: varName,
                            kind: CompletionItemKind.Variable,
                            detail: 'Local Variable',
                            data: { type: 'local_var', key: varName, language: lang }
                        });
                    }
                }
            }

            // --- NEW: Reserved Words Completion ---
            for (const word of textReservedWords) {
                // Skip if it's already an attribute or family
                // We DO NOT skip operators, so that explicit keywords (like if/else) appear as Keywords even if they are also operators.
                if (systemAttributes.has(word)) continue;
                if (operatorFamilies.has(word)) continue;

                completions.push({
                    label: word,
                    kind: CompletionItemKind.Keyword,
                    detail: 'Keyword',
                    data: { type: 'keyword', key: word, language: lang }
                });
            }

            // --- NEW: Data Types (Lowercase) ---
            for (const [typeKey, dataType] of tinderboxDataTypes) {
                completions.push({
                    label: typeKey, // "string", "number", etc.
                    kind: CompletionItemKind.TypeParameter,
                    detail: dataType.name, // "String-Type Attributes"
                    data: { type: 'datatype', key: typeKey, language: lang }
                });
            }

            return completions.concat(attrCompletions);

        }
    );

    // --- Completion Resolve Handler ---
    connection.onCompletionResolve(
        (item: CompletionItem): CompletionItem => {
            const data = item.data;
            const lang = data?.language || 'en';

            if (data.type === 'operator') {
                const op = tinderboxOperators.get(data.key);
                if (op) {
                    const desc = (lang === 'ja' && op.descriptionJa) ? op.descriptionJa : op.description;
                    item.documentation = {
                        kind: 'markdown',
                        value: `**${op.name}**\n*${op.type}* -> ${op.returnType}\n\n\`\`\`tinderbox\n${op.signature}\n\`\`\`\n\n${desc}`
                    };
                }
            } else if (data.type === 'attribute') {
                const attr = systemAttributes.get(data.key);
                if (attr) {
                    const desc = (lang === 'ja' && attr.descriptionJa) ? attr.descriptionJa : attr.description;
                    item.documentation = {
                        kind: 'markdown',
                        value: `**${attr.name}**\n\n*Type*: ${attr.type}\n*Group*: ${attr.group}\n*Read Only*: ${attr.readOnly}\n\n${desc}`
                    };
                }
            } else if (data.type === 'datatype') {
                const dt = tinderboxDataTypes.get(data.key);
                if (dt) {
                    const desc = (lang === 'ja' && dt.descriptionJa) ? dt.descriptionJa : dt.description;
                    item.documentation = {
                        kind: 'markdown',
                        value: `**${dt.name}**\n\n${desc}`
                    };
                }
            }
            return item;
        }
    );

    // --- Semantic Tokens Handler ---
    // Moved tokenTypes and legend definition to top of file for consistency

    connection.languages.semanticTokens.on((params: SemanticTokensParams) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return { data: [] };
        const text = doc.getText();
        const builder = new SemanticTokensBuilder();

        // 1. Reserved Words (Control Flow)
        const controlKeywords = new Set([
            'var', 'if', 'else', 'while', 'do', 'return', 'each', 'to', 'in', 'end'
        ]);

        // 1b. Boolean Constants
        const booleanKeywords = new Set([
            'true', 'false'
        ]);

        // 2. Types (Blue)
        const typeKeywords = new Set([
            'string', 'number', 'boolean', 'list', 'date', 'color', 'set', 'interval'
        ]);

        // 3. Designators (Reserved Functionality)
        const designatorKeywords = new Set([
            'adornment', 'agent', 'cover', 'current', 'find', 'firstSibling', 'grandparent',
            'lastChild', 'lastSibling', 'library', 'next', 'nextItem', 'nextSibling',
            'nextSiblingItem', 'original', 'parent', 'previous', 'previousItem',
            'previousSiblingItem', 'prevSibling', 'randomChild', 'selection', 'that', 'this',
            'adorments', 'all', 'ancestors', 'children', 'descendants', 'siblings',
            'destination', 'source', 'child'
        ]);

        // 4. Scan for User Functions (to highlight calls)
        const userFunctionNames = new Set<string>();
        const funcDeclPattern = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
        let funcMatch;
        while ((funcMatch = funcDeclPattern.exec(text))) {
            userFunctionNames.add(funcMatch[1]);
        }

        // Regex: Group 1 = Comment, Group 2 = String, Group 3 = Identifier
        const pattern = /(\/\/.*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([$a-zA-Z0-9_.]+)/g;
        let match: RegExpExecArray | null;

        let prevTokenWasFunctionKeyword = false;

        while ((match = pattern.exec(text))) {
            const startPos = doc.positionAt(match.index);
            const length = match[0].length;

            if (match[1]) {
                // Comment
                builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('comment'), 0);
                prevTokenWasFunctionKeyword = false;
            } else if (match[2]) {
                // String
                builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('string'), 0);
                prevTokenWasFunctionKeyword = false;
            } else if (match[3]) {
                // Identifier
                const word = match[3];

                if (word === 'function') {
                    builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('keyword'), 0);
                    prevTokenWasFunctionKeyword = true;
                } else if (prevTokenWasFunctionKeyword) {
                    // Function definition name -> function
                    builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('function'), 0);
                    prevTokenWasFunctionKeyword = false;
                } else if (controlKeywords.has(word)) {
                    builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('keyword'), 0);
                    prevTokenWasFunctionKeyword = false;
                } else if (booleanKeywords.has(word)) {
                    builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('keyword'), 0);
                    prevTokenWasFunctionKeyword = false;
                } else if (typeKeywords.has(word)) {
                    builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('type'), 0);
                    prevTokenWasFunctionKeyword = false;
                } else if (designatorKeywords.has(word)) {
                    builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('keyword'), 0);
                    prevTokenWasFunctionKeyword = false;
                } else if (userFunctionNames.has(word)) {
                    // User Function Call -> function
                    builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('function'), 0);
                    prevTokenWasFunctionKeyword = false;
                } else if (word.startsWith('$')) {
                    // Attribute handling
                    if (systemAttributes.has(word)) {
                        // System Attribute -> variable
                        builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('variable'), 0);
                    } else {
                        // User Attribute -> enumMember (distinct color)
                        builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('enumMember'), 0);
                    }
                    prevTokenWasFunctionKeyword = false;
                } else if (keywordNames.has(word)) {
                    let typeIdx = tokenTypes.indexOf('function');

                    if (systemAttributes.has(word)) {
                        typeIdx = tokenTypes.indexOf('variable');
                    } else {
                        const op = tinderboxOperators.get(word);
                        if (op) {
                            if (op.kind === CompletionItemKind.Variable) typeIdx = tokenTypes.indexOf('variable');
                            else if (op.kind === CompletionItemKind.Property) typeIdx = tokenTypes.indexOf('property');
                            else if (op.kind === CompletionItemKind.Method) typeIdx = tokenTypes.indexOf('method');
                            else if (['if', 'else', 'while', 'return'].includes(op.name)) typeIdx = tokenTypes.indexOf('keyword');
                        } else if (operatorFamilies.has(word)) {
                            typeIdx = tokenTypes.indexOf('variable');
                        }
                    }
                    builder.push(startPos.line, startPos.character, length, typeIdx, 0);
                } else if (word.includes('.') && !word.startsWith('$')) {
                    // Check for Dot Operators (suffix match)
                    // e.g. vStr.show  -> "show"
                    const lastDot = word.lastIndexOf('.');
                    if (lastDot >= 0 && lastDot < word.length - 1) {
                        const suffix = word.substring(lastDot + 1);
                        if (dotOperatorsMap.has(suffix)) {
                            // Highlight the suffix as a function/method
                            // Suffix start relative to token start: lastDot + 1
                            builder.push(startPos.line, startPos.character + lastDot + 1, suffix.length, tokenTypes.indexOf('function'), 0);
                        }
                    }
                    prevTokenWasFunctionKeyword = false;
                } else {
                    prevTokenWasFunctionKeyword = false;
                }
            }
        }
        return builder.build();
    });

    // --- Hover Handler ---
    connection.onHover(
        async (textDocumentPosition: TextDocumentPositionParams): Promise<Hover | null> => {
            const document = documents.get(textDocumentPosition.textDocument.uri);
            if (!document) return null;
            const settings = await getDocumentSettings(textDocumentPosition.textDocument.uri);
            const lang = settings.language;


            const offset = document.offsetAt(textDocumentPosition.position);
            const content = document.getText();

            // Find the word/expression under the cursor
            // This regex captures identifiers, system attributes, and dot-chained expressions
            // FIX: Support optional parentheses in the first segment (e.g. $Text(aID). )
            const wordPattern = /([$a-zA-Z0-9_]+(?:\([^)]*\))?(?:\.[a-zA-Z0-9_]+(?:\([^)]*\))?)*)/g;
            let match;
            let hoveredWord = '';
            let hoveredRange: Range | undefined;

            while ((match = wordPattern.exec(content)) !== null) {
                const startOffset = match.index;
                const endOffset = match.index + match[0].length;

                if (offset >= startOffset && offset <= endOffset) {
                    // Check if we are hovering a specific part of a chain
                    // e.g. "vList.reverse()" -> hovering "reverse"
                    // The regex captures the whole chain "vList.reverse()"
                    // We need to narrow down to the clicked segment.

                    const chain = match[0];
                    // Find which segment offset falls into
                    let currentSegStart = startOffset;
                    const segments = chain.split('.'); // This splits identifiers. "vList.reverse()" -> "vList", "reverse()"

                    for (let i = 0; i < segments.length; i++) {
                        const seg = segments[i];
                        const segLen = seg.length;
                        const segEnd = currentSegStart + segLen;

                        if (offset >= currentSegStart && offset <= segEnd) {
                            hoveredWord = seg.replace(/\(.*\)$/, ''); // "reverse"

                            // FIX: Check for type declaration context (preceded by :)
                            // e.g. "var:string" or "var: list"
                            let isTypeDecl = false;
                            let scanIdx = currentSegStart - 1;
                            while (scanIdx >= 0 && /\s/.test(content[scanIdx])) {
                                scanIdx--;
                            }
                            if (scanIdx >= 0 && content[scanIdx] === ':') {
                                isTypeDecl = true;
                            }

                            if (isTypeDecl) {
                                // Look up in tinderboxDataTypes
                                const typeInfo = tinderboxDataTypes.get(hoveredWord.toLowerCase());
                                if (typeInfo) {
                                    const desc = (lang === 'ja' && typeInfo.descriptionJa) ? typeInfo.descriptionJa : typeInfo.description;
                                    return {
                                        contents: {
                                            kind: 'markdown',
                                            value: `**${typeInfo.name}**\n\n*Data Type*\n\n${desc}`
                                        },
                                        range: {
                                            start: document.positionAt(currentSegStart),
                                            end: document.positionAt(segEnd)
                                        }
                                    };
                                }
                            }

                            // If it's not the first segment (variable), we need the prefix chain to infer type
                            // e.g. prefix = "vList"
                            if (i > 0) {
                                const prefixExpr = segments.slice(0, i).join('.');
                                const inferredType = evaluateExpressionType(prefixExpr, (() => {
                                    const vars = new Map<string, string>();
                                    const varRegex = /var(?::([a-zA-Z0-9_]+))?\s+([a-zA-Z0-9_]+)/g;
                                    let m;
                                    while ((m = varRegex.exec(content))) {
                                        if (m[1] && m[2]) vars.set(m[2], m[1].toLowerCase());
                                    }
                                    return vars;
                                })());

                                if (inferredType) {
                                    const methods = typeMethods.get(inferredType.toLowerCase());
                                    if (methods) {
                                        const op = methods.find(m => {
                                            const suffix = m.name.split('.').pop();
                                            const cleanSuffix = suffix?.replace(/\(.*\)$/, '').replace(/\{.*\}$/, '').replace(/\(.*\)/, '');
                                            return cleanSuffix === hoveredWord;
                                        });
                                        if (op) {
                                            const desc = (lang === 'ja' && op.descriptionJa) ? op.descriptionJa : op.description;
                                            return {
                                                contents: {
                                                    kind: 'markdown',
                                                    value: `**${op.name}**\n*${op.type}* -> ${op.returnType}\n\n\`\`\`tinderbox\n${op.signature}\n\`\`\`\n\n${desc}`
                                                },
                                                range: {
                                                    start: document.positionAt(currentSegStart),
                                                    end: document.positionAt(segEnd)
                                                }
                                            };
                                        }
                                    }
                                }

                                // FALLBACK: Try dotOperatorsMap (Global Suffix match) if specific type inference failed or didn't yield result
                                const ops = dotOperatorsMap.get(hoveredWord);
                                if (ops && ops.length > 0) {
                                    const op = ops[0]; // Take first match for now
                                    const desc = (lang === 'ja' && op.descriptionJa) ? op.descriptionJa : op.description;
                                    return {
                                        contents: {
                                            kind: 'markdown',
                                            value: `**${op.name}**\n*${op.type}* -> ${op.returnType}\n\n\`\`\`tinderbox\n${op.signature}\n\`\`\`\n\n${desc}`
                                        },
                                        range: {
                                            start: document.positionAt(currentSegStart),
                                            end: document.positionAt(segEnd)
                                        }
                                    };
                                }
                            }

                            // If first segment or inference failed, use basic lookup below
                            hoveredRange = {
                                start: document.positionAt(currentSegStart),
                                end: document.positionAt(segEnd)
                            };
                            break;
                        }
                        currentSegStart = segEnd + 1; // +1 for dot
                    }
                    if (!hoveredWord) hoveredWord = match[0]; // Fallback to whole match if logic fails
                    break;
                }
            }

            if (!hoveredWord || !hoveredRange) {
                return null;
            }

            // 1. System Attributes
            if (hoveredWord.startsWith('$')) {
                const attr = systemAttributes.get(hoveredWord);
                if (attr) {
                    const desc = (lang === 'ja' && attr.descriptionJa) ? attr.descriptionJa : attr.description;
                    return {
                        contents: {
                            kind: 'markdown',
                            value: `**${attr.name}**\n\n*Type*: ${attr.type}\n*Group*: ${attr.group}\n*Read Only*: ${attr.readOnly}\n\n${desc}`
                        },
                        range: hoveredRange
                    };
                }
            }

            // 2. Operators / Functions (Standard Lookup for non-chained or simple names)
            // 2. Operators / Functions (Standard Lookup for non-chained or simple names)
            // Try robust lookup (strip parens, case-insensitive)
            const op = Array.from(tinderboxOperators.values()).find(op => {
                const cleanName = op.name.replace(/\(.*\)$/, '').replace(/\{.*\}$/, '').replace(/\(.*\)/, '').toLowerCase();
                return cleanName === hoveredWord.toLowerCase();
            });
            if (op) {
                const desc = (lang === 'ja' && op.descriptionJa) ? op.descriptionJa : op.description;
                return {
                    contents: {
                        kind: 'markdown',
                        value: `**${op.name}**\n*${op.type}* -> ${op.returnType}\n\n\`\`\`tinderbox\n${op.signature}\n\`\`\`\n\n${desc}`
                    },
                    range: hoveredRange
                };
            }
            // 3. Fallback: Local Variables
            // We need textBefore for context
            const textBefore = content.slice(0, offset);
            // FIX: More robust var regex (handle optional type and spaces)
            const varRegex = /var(?::[a-zA-Z0-9_]+)?\s+([a-zA-Z0-9_]+)\b/g;
            let mVar;
            while ((mVar = varRegex.exec(textBefore))) {
                if (mVar[1] === hoveredWord) {
                    // Find the full declaration for type if possible
                    const declLine = content.substring(0, mVar.index + mVar[0].length);
                    const specificVarMatch = declLine.match(/var(?::([a-zA-Z0-9_]+))?\s+([a-zA-Z0-9_]+)$/);
                    const foundVarType = specificVarMatch ? specificVarMatch[1] : undefined;

                    return {
                        contents: {
                            kind: 'markdown',
                            value: `**${hoveredWord}**\n\n*Variable*${foundVarType ? `\n*Type*: ${foundVarType}` : ''}`
                        },
                        range: hoveredRange
                    };
                }
            }

            // 4. Iterator Variables: .each(loopVar) or .eachLine(loopVar)
            const iteratorRegex = /\.each(?:Line)?\s*\(\s*([$a-zA-Z0-9_]+)(?::[a-zA-Z0-9_]+)?\s*(?:,[^)]*)?\)/g;
            let mIter;
            while ((mIter = iteratorRegex.exec(textBefore))) {
                if (mIter[1] === hoveredWord) {
                    return {
                        contents: {
                            kind: 'markdown',
                            value: `**${hoveredWord}**\n\n*Loop Variable*`
                        },
                        range: hoveredRange
                    };
                }
            }

            // 5. Function Arguments: function Name(arg:Type)
            // Find the last function definition before the cursor (Enclosing function heuristic)
            const funcRegex = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
            let lastFuncMatch = null;
            let mFunc;
            while ((mFunc = funcRegex.exec(textBefore))) {
                lastFuncMatch = mFunc;
            }

            if (lastFuncMatch) {
                const args = lastFuncMatch[2]; // e.g. "a:number, b"
                const argParts = args.split(',');
                for (const part of argParts) {
                    const trimmed = part.trim();
                    // Match "Name" or "Name:Type"
                    const argMatch = trimmed.match(/^([$a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?$/);
                    if (argMatch) {
                        const argName = argMatch[1];
                        const argType = argMatch[2];
                        if (argName === hoveredWord) {
                            return {
                                contents: {
                                    kind: 'markdown',
                                    value: `**${hoveredWord}**\n\n*Argument*${argType ? `\n*Type*: ${argType}` : ''}`
                                },
                                range: hoveredRange
                            };
                        }
                    }
                }
            }
            return null;
        }
    );


    // --- Signature Help Handler ---
    connection.onSignatureHelp(async (params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        const settings = await getDocumentSettings(params.textDocument.uri);
        const lang = settings.language;
        const offset = doc.offsetAt(params.position);
        const text = doc.getText();

        // Simple backward scan to find the function name before the open parenthesis
        // We look for Identifier followed by '(' and maybe some args

        let openParenCount = 0;
        let scanIdx = offset - 1;
        while (scanIdx >= 0) {
            const char = text[scanIdx];
            if (char === ')') {
                openParenCount++;
            } else if (char === '(') {
                if (openParenCount > 0) {
                    openParenCount--;
                } else {
                    // Found the opening paren of the current call
                    // slice text before this paren to find the word
                    const beforeParen = text.slice(0, scanIdx).trimEnd();
                    const match = beforeParen.match(/([a-zA-Z0-9_.]+)$/);
                    if (match) {
                        const word = match[1];
                        const op = tinderboxOperators.get(word);
                        if (op) {
                            const desc = (lang === 'ja' && op.descriptionJa) ? op.descriptionJa : op.description;
                            return {
                                signatures: [{
                                    label: op.signature,
                                    documentation: { kind: 'markdown', value: desc },
                                    parameters: [] // We could parse signature to separate params, but label is often enough
                                }],
                                activeSignature: 0,
                                activeParameter: 0
                            };
                        }
                    }
                    break;
                }
            }
            scanIdx--;
            // Limit scan back to avoid performance issues
            if (offset - scanIdx > 1000) break;
        }

        return null;
    });

    // --- Definition Handler ---
    connection.onDefinition(
        async (params: TextDocumentPositionParams): Promise<Definition | null> => {
            const document = documents.get(params.textDocument.uri);
            if (!document) return null;

            const content = document.getText();
            const offset = document.offsetAt(params.position);

            // 1. Identify word under cursor
            // Re-use logic similar to hover but simplified for just name
            const line = document.getText({
                start: { line: params.position.line, character: 0 },
                end: { line: params.position.line, character: 1000 }
            });

            // Extract word at the specific position
            const wordRegex = /[$a-zA-Z0-9_]+/g;
            let m;
            let targetWord = '';
            while ((m = wordRegex.exec(line))) {
                if (params.position.character >= m.index && params.position.character <= m.index + m[0].length) {
                    targetWord = m[0];
                    break;
                }
            }

            if (!targetWord) return null;

            // --- 1. Scoped Search (Function / Iterator block) ---
            // Find the start of the current block by scanning backwards for '{'
            let scopeContent = '';
            let scopeStartOffset = -1;
            let depth = 0;
            for (let i = offset - 1; i >= 0; i--) {
                if (content[i] === '}') depth++;
                else if (content[i] === '{') {
                    if (depth > 0) depth--;
                    else {
                        // Found the start of the current scope
                        scopeStartOffset = i;
                        scopeContent = content.substring(i, offset);
                        break;
                    }
                }
            }

            if (scopeStartOffset !== -1) {
                // a. Check for Loop Variable in the preceding iterator call: .each(Name)
                const textBeforeScope = content.substring(Math.max(0, scopeStartOffset - 100), scopeStartOffset);
                const iterMatch = textBeforeScope.match(/\.each(?:Line)?\s*\(\s*([$a-zA-Z0-9_]+)(?::[a-zA-Z0-9_]+)?\s*(?:,[^)]*)?\)\s*$/);
                if (iterMatch && iterMatch[1] === targetWord) {
                    const nameIdx = iterMatch[0].indexOf(targetWord);
                    return Location.create(params.textDocument.uri, {
                        start: document.positionAt(scopeStartOffset - (iterMatch[0].length - nameIdx)),
                        end: document.positionAt(scopeStartOffset - (iterMatch[0].length - nameIdx - targetWord.length))
                    });
                }

                // b. Check for Function Arguments of the enclosing function
                const funcMatch = textBeforeScope.match(/function\s+[a-zA-Z0-9_]+\s*\(([^)]*)\)\s*$/);
                if (funcMatch) {
                    const args = funcMatch[1];
                    const argRegex = new RegExp(`\\b${escapeRegExp(targetWord)}\\b`);
                    const mArg = args.match(argRegex);
                    if (mArg) {
                        const argNameOffset = scopeStartOffset - (funcMatch[0].length - funcMatch[0].indexOf(args)) + mArg.index!;
                        return Location.create(params.textDocument.uri, {
                            start: document.positionAt(argNameOffset),
                            end: document.positionAt(argNameOffset + targetWord.length)
                        });
                    }
                }

                // c. Check for Variable Declarations within this scope before the cursor
                const varPattern = new RegExp(`var(?::[a-zA-Z0-9_]+)?\\s+${escapeRegExp(targetWord)}\\b`, 'g');
                let mVar;
                while ((mVar = varPattern.exec(scopeContent))) {
                    return Location.create(params.textDocument.uri, {
                        start: document.positionAt(scopeStartOffset + mVar.index),
                        end: document.positionAt(scopeStartOffset + mVar.index + mVar[0].length)
                    });
                }
            }

            // --- 2. Global Search (Fallback or Global items like Functions) ---
            // a. Function Definitions: function Name
            const funcPattern = new RegExp(`function\\s+${escapeRegExp(targetWord)}\\b`, 'g');
            let mFunc;
            while ((mFunc = funcPattern.exec(content))) {
                return Location.create(params.textDocument.uri, {
                    start: document.positionAt(mFunc.index),
                    end: document.positionAt(mFunc.index + mFunc[0].length)
                });
            }

            // b. Variable Declarations (Global fallback)
            const globalVarPattern = new RegExp(`var(?::[a-zA-Z0-9_]+)?\\s+${escapeRegExp(targetWord)}\\b`, 'g');
            let mGlobalVar;
            while ((mGlobalVar = globalVarPattern.exec(content))) {
                return Location.create(params.textDocument.uri, {
                    start: document.positionAt(mGlobalVar.index),
                    end: document.positionAt(mGlobalVar.index + mGlobalVar[0].length)
                });
            }

            return null;
        }
    );

    // Make the text document manager listen on the connection
    // for open, change and close text document events
    documents.listen(connection);

    // Listen on the connection
    connection.listen();

} catch (e: any) {
    connection.console.error(`Top-level error: ${e.message}`);
}



