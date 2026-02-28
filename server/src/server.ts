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
    WorkspaceEdit,
    InlayHint,
    InlayHintParams,
    InlayHintKind,
    CodeAction,
    CodeActionKind,
    CodeActionParams,
    ReferenceParams,
    DocumentHighlight,
    DocumentHighlightKind,
    DocumentHighlightParams,
    WorkspaceSymbolParams,
    SymbolInformation,
    Position
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Define token types globally for consistency
const tokenTypes = ['keyword', 'string', 'number', 'comment', 'variable', 'function', 'property', 'method', 'type', 'parameter', 'enumMember'];
const tokenModifiers: string[] = ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'];
const legend = { tokenTypes, tokenModifiers };

// Workspace Symbol Cache
interface GlobalSymbol {
    name: string;
    kind: SymbolKind;
    location: Location;
}
const workspaceSymbolCache = new Map<string, GlobalSymbol[]>(); // Key: file URI


process.on('uncaughtException', (err: any) => {
    connection.console.error(`Uncaught Exception: ${err?.message || err}`);
});
process.on('unhandledRejection', (reason: any, p) => {
    connection.console.error(`Unhandled Rejection: ${reason?.message || reason}`);
});

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
    connection.console.log('Server onInitialize started.');
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
                triggerCharacters: ['.', ':', '^', '$'] // Trigger on dot, colon, caret (export), dollar (attr)
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
            // References Provider capability
            referencesProvider: true,
            // Document Highlight Provider capability
            documentHighlightProvider: true,
            // Document Formatting capability
            documentFormattingProvider: true,
            // Document Symbol capability
            documentSymbolProvider: true,
            // Rename capability
            renameProvider: {
                prepareProvider: true
            },
            // Inlay Hint capability
            inlayHintProvider: true,
            // Code Action capability
            codeActionProvider: true,
            // Workspace Symbol capability
            workspaceSymbolProvider: true
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
    connection.console.log('Server onInitialized started.');
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
    // Start loading resources in the background
    loadResources().then(() => {
        // After resources are loaded, trigger validation for all open documents with a small delay
        setTimeout(() => {
            documents.all().forEach(validateTextDocument);
        }, 500);
    });

    if (hasWorkspaceFolderCapability) {
        connection.workspace.getWorkspaceFolders().then(folders => {
            if (folders) {
                folders.forEach(folder => {
                    const folderPath = URI.parse(folder.uri).fsPath;
                    scanWorkspace(folderPath);
                });
            }
        });
    }
});

async function scanWorkspace(dirPath: string) {
    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            // Ignore hidden folders (like .git, .vscode)
            if (entry.isDirectory() && entry.name.startsWith('.')) continue;

            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                await scanWorkspace(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (['.tbxa', '.tbxc', '.tbxe'].includes(ext)) {
                    await indexFileForCache(fullPath);
                }
            }
        }
    } catch (err) {
        connection.console.warn(`Error scanning directory ${dirPath}: ${err}`);
    }
}

async function indexFileForCache(filePath: string) {
    try {
        const text = await fs.promises.readFile(filePath, 'utf-8');
        const uri = URI.file(filePath).toString();
        const tokens = tokenize(text);

        const symbols: GlobalSymbol[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            // Look for functions and variables
            if (t.type === 'Identifier') {
                if (isDeclaration(tokens, i, 0)) {
                    // Create a dummy document just enough for positionAt
                    // Using TextDocument.create is safe for this as we only need it for offset conversion
                    const doc = TextDocument.create(uri, 'tinderbox-action-code', 1, text);
                    let kind: SymbolKind = SymbolKind.Variable;
                    // basic heuristic: if 'function' was behind it
                    let j = i - 1;
                    while (j >= 0 && tokens[j].type === 'Whitespace') j--;
                    if (j >= 0 && tokens[j].value === 'function') {
                        kind = SymbolKind.Function;
                    }

                    symbols.push({
                        name: t.value,
                        kind: kind,
                        location: Location.create(uri, {
                            start: doc.positionAt(t.start),
                            end: doc.positionAt(t.start + t.length)
                        })
                    });
                }
            }
        }

        if (symbols.length > 0) {
            workspaceSymbolCache.set(uri, symbols);
        } else {
            workspaceSymbolCache.delete(uri); // clear if it has none
        }
    } catch (err) {
        connection.console.warn(`Error indexing file ${filePath}: ${err}`);
    }
}

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
    if (!doc || doc.languageId === 'tinderbox-export-code') {
        // Disable whole-document formatting for Export Code to avoid messing up HTML/Template layout.
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
            // This is a very simplified approach.
            // 1. Handle common operators (except slash)
            newLine = newLine.replace(/\s*([=+*<>!]=|[=+*<>])\s*/g, ' $1 ');

            // 2. Handle slash (/) carefully to avoid reformatting paths like /Templates/Note
            // We treat it as an operator ONLY if it's surrounded by spaces OR between alphanumeric chars
            // but NOT if it looks like a path start or is part of a path.
            // Simple heuristic: if it has a space before OR after, or is between numbers/vars, it's likely an operator.
            // For now, let's ONLY space it if it ALREADY has a space on at least one side,
            // or if it's between a closing paren/quote and a word.
            newLine = newLine.replace(/([a-zA-Z0-9_$)"'])\s*\/\s*([a-zA-Z0-9_$"(])/g, '$1 / $2');

            newLine = newLine
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

connection.onDocumentSymbol(async (params: DocumentSymbolParams): Promise<DocumentSymbol[]> => {
    await resourcesPromise;
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

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
    const query = params.query.toLowerCase();
    const symbols: SymbolInformation[] = [];

    // currently we only scan open documents
    // Note: A true workspace scan requires fs-based walking
    const processedUris = new Set<string>();

    documents.all().forEach(doc => {
        processedUris.add(doc.uri);
        const text = doc.getText();

        // 1. Functions
        const functionPattern = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
        let match;
        while ((match = functionPattern.exec(text)) !== null) {
            const name = match[1];
            if (name.toLowerCase().includes(query)) {
                const startPos = doc.positionAt(match.index);
                const endPos = doc.positionAt(match.index + match[0].length);
                symbols.push({
                    name: name,
                    kind: SymbolKind.Function,
                    location: Location.create(doc.uri, Range.create(startPos, endPos)),
                    containerName: 'tinderbox function'
                });
            }
        }

        // 2. Variables
        const varPattern = /var(?::[a-zA-Z0-9]+)?\s+([a-zA-Z0-9_]+)/g;
        while ((match = varPattern.exec(text)) !== null) {
            const name = match[1];
            // Skip variables that look like typical arguments (often very short or inside lists)
            if (name.toLowerCase().includes(query) && name.length > 1) {
                const startPos = doc.positionAt(match.index);
                const endPos = doc.positionAt(match.index + match[0].length);
                symbols.push({
                    name: name,
                    kind: SymbolKind.Variable,
                    location: Location.create(doc.uri, Range.create(startPos, endPos))
                });
            }
        }
    });

    // 3. Add from global cache for unopened files
    for (const [uri, globalSymbols] of workspaceSymbolCache.entries()) {
        if (!processedUris.has(uri)) {
            for (const sym of globalSymbols) {
                if (sym.name.toLowerCase().includes(query)) {
                    symbols.push({
                        name: sym.name,
                        kind: sym.kind,
                        location: sym.location,
                        containerName: sym.kind === SymbolKind.Function ? 'tinderbox function' : undefined
                    });
                }
            }
        }
    }

    return symbols;
});

connection.onPrepareRename(async (params: TextDocumentPositionParams): Promise<PrepareRenameResult | null> => {
    await resourcesPromise;
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const text = doc.getText();
    const offset = doc.offsetAt(params.position);

    const tokens = tokenize(text);
    const targetToken = tokens.find(t =>
        (t.type === 'Identifier' || t.type === 'Keyword') &&
        offset >= t.start && offset <= t.start + t.length
    );
    if (!targetToken) return null;

    return {
        range: Range.create(doc.positionAt(targetToken.start), doc.positionAt(targetToken.start + targetToken.length)),
        placeholder: targetToken.value
    };
});

connection.onRenameRequest(async (params: RenameParams): Promise<WorkspaceEdit | null> => {
    await resourcesPromise;
    const { textDocument, position, newName } = params;
    const doc = documents.get(textDocument.uri);
    if (!doc) return null;

    const offset = doc.offsetAt(position);
    const locations = getReferenceLocations(doc, offset);

    if (!locations || locations.length === 0) return null;

    const edits: TextEdit[] = locations.map(loc => TextEdit.replace(loc.range, newName));

    return {
        changes: {
            [textDocument.uri]: edits
        }
    };
});

connection.languages.inlayHint.on(async (params: InlayHintParams): Promise<InlayHint[]> => {
    await resourcesPromise;
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const text = doc.getText();
    const hints: InlayHint[] = [];

    // 1. Gather all local function definitions to get parameter names
    const functions = new Map<string, string[]>();
    const funcDefPattern = /\bfunction\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
    let match;
    while ((match = funcDefPattern.exec(text)) !== null) {
        const funcName = match[1];
        const paramsStr = match[2];
        // Parameter can be "type Name" or just "Name"
        const paramNames = paramsStr.split(',').map(p => {
            const parts = p.trim().split(/\s+/);
            return parts[parts.length - 1];
        }).filter(p => p && /^[a-zA-Z0-9_]+$/.test(p));
        functions.set(funcName, paramNames);
    }

    // 2. Find function calls and provide hints
    const callPattern = /\b([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
    callPattern.lastIndex = 0;
    while ((match = callPattern.exec(text)) !== null) {
        const funcName = match[1];

        // Skip keywords that look like function calls
        if (['function', 'if', 'while', 'each', 'for', 'return', 'var'].includes(funcName)) {
            continue;
        }

        const argsStr = match[2];
        const argsStartOffset = match.index + match[0].indexOf('(') + 1;

        if (functions.has(funcName)) {
            const paramNames = functions.get(funcName)!;

            // Parse arguments to find their positions
            let argIndex = 0;
            let currentArgStart = 0;
            let parenDepth = 0;
            let inString: string | null = null;

            for (let i = 0; i <= argsStr.length; i++) {
                const char = argsStr[i];

                // Handle strings to avoid breaking on commas inside them
                if ((char === '"' || char === "'") && (i === 0 || argsStr[i - 1] !== '\\')) {
                    if (inString === char) inString = null;
                    else if (!inString) inString = char;
                }

                if (!inString) {
                    if (i === argsStr.length || (char === ',' && parenDepth === 0)) {
                        if (argIndex < paramNames.length) {
                            // Find the start of the argument text (skipping leading whitespace)
                            let effectiveArgStart = currentArgStart;
                            while (effectiveArgStart < i && /\s/.test(argsStr[effectiveArgStart])) {
                                effectiveArgStart++;
                            }

                            if (effectiveArgStart < i) {
                                hints.push({
                                    position: doc.positionAt(argsStartOffset + effectiveArgStart),
                                    label: `${paramNames[argIndex]}:`,
                                    kind: InlayHintKind.Parameter,
                                    paddingRight: true
                                });
                            }
                        }
                        argIndex++;
                        currentArgStart = i + 1;
                    } else if (char === '(') {
                        parenDepth++;
                    } else if (char === ')') {
                        parenDepth--;
                    }
                }
            }
        }
    }

    return hints;
});

const validationDelay = 200; // ms
const pendingValidationRequests = new Map<string, NodeJS.Timeout>();

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    const uri = change.document.uri;
    if (pendingValidationRequests.has(uri)) {
        clearTimeout(pendingValidationRequests.get(uri)!);
    }
    const timeout = setTimeout(() => {
        validateTextDocument(change.document);
        updateDocumentCache(change.document);
        pendingValidationRequests.delete(uri);
    }, validationDelay);
    pendingValidationRequests.set(uri, timeout);
});

async function updateDocumentCache(doc: TextDocument) {
    const text = doc.getText();
    const uri = doc.uri;
    const tokens = tokenize(text);

    const symbols: GlobalSymbol[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'Identifier') {
            if (isDeclaration(tokens, i, 0)) {
                let kind: SymbolKind = SymbolKind.Variable;
                let j = i - 1;
                while (j >= 0 && tokens[j].type === 'Whitespace') j--;
                if (j >= 0 && tokens[j].value === 'function') {
                    kind = SymbolKind.Function;
                }

                symbols.push({
                    name: t.value,
                    kind: kind,
                    location: Location.create(uri, {
                        start: doc.positionAt(t.start),
                        end: doc.positionAt(t.start + t.length)
                    })
                });
            }
        }
    }

    if (symbols.length > 0) {
        workspaceSymbolCache.set(uri, symbols);
    } else {
        workspaceSymbolCache.delete(uri);
    }
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    await resourcesPromise;
    const settings = await getDocumentSettings(textDocument.uri);
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];

    if (textDocument.languageId === 'tinderbox-export-code') {
        // --- 1. Export Code Parsing ---
        // We use a robust scanner to handle nested tags and balanced parentheses
        interface ExportTagMatch {
            tagName: string;
            tagContent: string;
            tagStart: number;
            tagEnd: number;
            contentStart: number;
        }

        const findExportTags = (input: string, baseOffset: number): ExportTagMatch[] => {
            const results: ExportTagMatch[] = [];
            let i = 0;
            while (i < input.length) {
                if (input[i] === '^') {
                    const start = i;
                    i++;
                    // Find tag name
                    let tagName = '';
                    while (i < input.length && /[a-zA-Z0-9$]/.test(input[i])) {
                        tagName += input[i];
                        i++;
                    }

                    if (tagName === '') {
                        // Just a caret, skip
                        continue;
                    }

                    if (i < input.length && input[i] === '(') {
                        // Potential tag with arguments: ^name(args)^
                        const contentStartIdx = i + 1;
                        let depth = 1;
                        i++;
                        let inString: string | null = null;
                        let isEscaped = false;

                        while (i < input.length) {
                            const char = input[i];
                            if (isEscaped) {
                                isEscaped = false;
                            } else if (char === '\\') {
                                isEscaped = true;
                            } else if (inString) {
                                if (char === inString) {
                                    inString = null;
                                }
                            } else if (char === '"' || char === "'") {
                                inString = char;
                            } else if (char === '(') {
                                depth++;
                            } else if (char === ')') {
                                depth--;
                            }

                            if (depth === 0 && !inString) {
                                if (i + 1 < input.length && input[i + 1] === '^') {
                                    results.push({
                                        tagName,
                                        tagContent: input.substring(contentStartIdx, i),
                                        tagStart: baseOffset + start,
                                        tagEnd: baseOffset + i + 2,
                                        contentStart: baseOffset + contentStartIdx
                                    });
                                    i += 2;
                                    break;
                                } else {
                                    // Found closing paren but no trailing caret, strictly no match in TBX
                                    break;
                                }
                            }
                            i++;
                        }
                    } else if (i < input.length && input[i] === '^') {
                        // Argument-less tag: ^name^
                        results.push({
                            tagName,
                            tagContent: '',
                            tagStart: baseOffset + start,
                            tagEnd: baseOffset + i + 1,
                            contentStart: -1
                        });
                        i++;
                    }
                } else {
                    i++;
                }
            }
            return results;
        };

        const allTags: ExportTagMatch[] = [];
        const processInputRecursively = (input: string, baseOffset: number) => {
            const tags = findExportTags(input, baseOffset);
            for (const tag of tags) {
                allTags.push(tag);
                if (tag.tagContent) {
                    processInputRecursively(tag.tagContent, tag.contentStart);
                }
            }
        };

        processInputRecursively(text, 0);

        const processedTagStarts = new Set<number>();
        for (const tag of allTags) {
            processedTagStarts.add(tag.tagStart);
            const lowerTagName = tag.tagName.toLowerCase();

            // Basic tag validation (existence)
            if (!tinderboxExportTags.has(lowerTagName)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: textDocument.positionAt(tag.tagStart),
                        end: textDocument.positionAt(tag.tagStart + tag.tagName.length + 1)
                    },
                    message: `Unknown Export Tag: '^${tag.tagName}'`,
                    source: 'Tinderbox Export Code'
                });
            }

            // Inner Action Code validation for specific tags
            // Note: 'include' and others often take paths, which are NOT Action Code.
            // We only validate Action Code for 'value', 'if', 'action', 'do', 'not'.
            // 'include' arguments are handled by recursive tag extraction but not as a full expression.
            if (['value', 'if', 'action', 'do', 'not'].includes(lowerTagName)) {
                if (tag.contentStart !== -1) {
                    const suppressSemicolon = lowerTagName === 'value';

                    // --- MASK NESTED TAGS for parent validation ---
                    // If we are validating ^if(...)^, we should mask any ^value()^ inside it
                    // so the inner carets and content don't interfere with parent's action code validation.
                    let contentToValidate = tag.tagContent;
                    for (const otherTag of allTags) {
                        if (otherTag !== tag &&
                            otherTag.tagStart >= tag.contentStart &&
                            otherTag.tagEnd <= (tag.tagStart + tag.tagName.length + 2 + tag.tagContent.length)) {
                            // This tag is inside the current tag. Mask it.
                            const relativeStart = otherTag.tagStart - tag.contentStart;
                            const relativeEnd = otherTag.tagEnd - tag.contentStart;
                            if (relativeStart >= 0 && relativeEnd <= contentToValidate.length) {
                                contentToValidate = contentToValidate.substring(0, relativeStart) +
                                    ' '.repeat(relativeEnd - relativeStart) +
                                    contentToValidate.substring(relativeEnd);
                            }
                        }
                    }

                    const innerDiagnostics = performActionCodeValidation(contentToValidate, textDocument, tag.contentStart, { suppressSemicolon });
                    diagnostics.push(...innerDiagnostics);
                }
            }
        }

        // --- 2. Unclosed Caret Check ---
        // Carets not belonging to any extracted tag
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '^') {
                let isMatched = false;
                for (const tag of allTags) {
                    if (i >= tag.tagStart && i < tag.tagEnd) {
                        isMatched = true;
                        break;
                    }
                }
                if (!isMatched) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: {
                            start: textDocument.positionAt(i),
                            end: textDocument.positionAt(i + 1)
                        },
                        message: `Unclosed or unexpected caret '^'. Export tags must be '^name^' or '^name(args)^'.`,
                        source: 'Tinderbox Export Code'
                    });
                }
            }
        }
    } else {
        // --- .tbxa (Action Code only) ---
        const actionDiagnostics = performActionCodeValidation(text, textDocument, 0);
        diagnostics.push(...actionDiagnostics);
    }

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

function performActionCodeValidation(text: string, textDocument: TextDocument, baseOffset: number, options: { suppressSemicolon?: boolean } = {}): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // --- MASKING Step ---
    let maskedText = text;

    // 1 & 2. Mask Strings and Comments
    // We use a robust character-by-character masker to handle escapes and nested parens correctly
    const buffer = text.split('');
    let i = 0;
    while (i < buffer.length) {
        if (buffer[i] === '/' && buffer[i + 1] === '/') {
            // Comment
            while (i < buffer.length && buffer[i] !== '\n') {
                buffer[i] = ' ';
                i++;
            }
        } else if (buffer[i] === '"' || buffer[i] === "'") {
            // String
            const quote = buffer[i];
            i++;
            while (i < buffer.length) {
                if (buffer[i] === '\\') {
                    buffer[i] = ' ';
                    i++;
                    if (i < buffer.length) {
                        buffer[i] = ' ';
                        i++;
                    }
                } else if (buffer[i] === quote) {
                    i++;
                    break;
                } else {
                    buffer[i] = ' ';
                    i++;
                }
            }
        } else {
            i++;
        }
    }
    maskedText = buffer.join('');

    // 3. Mask Parens (Keep parens, mask content)
    // Now safe because strings and tags are already masked to spaces.
    // We do this RECURSIVELY (innermost first) to handle nested parens like collect_if(children(), ...)
    let prevMasked;
    do {
        prevMasked = maskedText;
        maskedText = maskedText.replace(/\(([^()]*)\)/g, (match, inner) => {
            return '(' + ' '.repeat(inner.length) + ')';
        });
    } while (maskedText !== prevMasked);

    // --- 1. Smart Quote Check ---
    const smartQuotePattern = /([“”‘’])/g;
    let m: RegExpExecArray | null;
    while ((m = smartQuotePattern.exec(maskedText))) {
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: textDocument.positionAt(baseOffset + m.index),
                end: textDocument.positionAt(baseOffset + m.index + m[0].length)
            },
            message: `Smart quote '${m[0]}' detected. Use straight quotes (" or ').`,
            source: 'Tinderbox Action Code'
        });
    }

    // --- Gather Valid Identifiers ---
    const validIdentifiers = new Set<string>();
    const lowerToOriginal = new Map<string, string>();

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

    for (const op of tinderboxOperators.values()) {
        validIdentifiers.add(op.name);
        lowerToOriginal.set(op.name.toLowerCase(), op.name);
    }
    for (const attr of systemAttributes.values()) {
        validIdentifiers.add(attr.name);
        lowerToOriginal.set(attr.name.toLowerCase(), attr.name);
    }

    const varDeclPatternForScan = /var:([a-zA-Z0-9]+)\s+([a-zA-Z0-9_]+)(?:\s*=\s*([^;]+))?;?/g;
    while ((m = varDeclPatternForScan.exec(text))) {
        validIdentifiers.add(m[1]);
        validIdentifiers.add(m[2]);
        lowerToOriginal.set(m[2].toLowerCase(), m[2]);
    }

    const funcPatternForScan = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
    while ((m = funcPatternForScan.exec(text))) {
        validIdentifiers.add(m[1]);
        lowerToOriginal.set(m[1].toLowerCase(), m[1]);
    }

    // --- 2. Case Sensitivity Check ---
    const wordPattern = /\b([a-zA-Z0-9_$]+)\b/g;
    while ((m = wordPattern.exec(maskedText))) {
        const word = m[0];
        if (validIdentifiers.has(word)) continue;

        const lower = word.toLowerCase();
        if (lowerToOriginal.has(lower)) {
            const correctCase = lowerToOriginal.get(lower);
            if (correctCase && correctCase !== word) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: textDocument.positionAt(baseOffset + m.index),
                        end: textDocument.positionAt(baseOffset + m.index + word.length)
                    },
                    message: `Case Mismatch: '${word}' should be '${correctCase}'.`,
                    source: 'Tinderbox Action Code'
                });
            }
        }
    }

    // --- 3. Missing Semicolon Check ---
    const lines = maskedText.split(/\r?\n/);
    let charOffset = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.length > 0 &&
            !trimmed.endsWith(';') &&
            !trimmed.endsWith('{') &&
            !trimmed.endsWith('}') &&
            !trimmed.endsWith(',') &&
            !trimmed.endsWith('(') &&
            !trimmed.match(/^function\s+/)
        ) {
            const endsWithOperator = /[+\-*/|&=]$/.test(trimmed);
            let nextLineStartsOperator = false;
            let nextLineStartsBlock = false;
            if (i < lines.length - 1) {
                const nextLine = lines[i + 1].trim();
                if (/^[\+\-\*\/\.\|&=]/.test(nextLine)) nextLineStartsOperator = true;
                if (nextLine.startsWith('{')) nextLineStartsBlock = true;
            }

            const isControlStatement = /^(if|while|each|for|function)\b/.test(trimmed);
            const endsWithElse = /(^|\s)else$/.test(trimmed);

            if (!options.suppressSemicolon &&
                !endsWithOperator &&
                !nextLineStartsOperator &&
                !nextLineStartsBlock &&
                !isControlStatement &&
                !endsWithOperator &&
                !endsWithElse &&
                /[a-zA-Z0-9_"')]/.test(trimmed[trimmed.length - 1])) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: textDocument.positionAt(baseOffset + charOffset + line.length),
                        end: textDocument.positionAt(baseOffset + charOffset + line.length)
                    },
                    message: `Missing semicolon?`,
                    source: 'Tinderbox Action Code'
                });
            }
        }
        charOffset += line.length + 1;
    }

    // --- 4. Assignment Type Checking ---
    const attrAssignmentPattern = /(\$[a-zA-Z0-9_]+)\s*=\s*([^;]+);?/g;
    while ((m = attrAssignmentPattern.exec(text))) {
        const varName = m[1];
        const rhs = m[2].trim();
        const attr = systemAttributes.get(varName);

        if (attr) {
            const inferredType = evaluateExpressionType(rhs);
            if (inferredType && !isCompatible(attr.type, inferredType)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: textDocument.positionAt(baseOffset + m.index),
                        end: textDocument.positionAt(baseOffset + m.index + m[0].length)
                    },
                    message: `Type Mismatch: '${varName}' is ${attr.type}, but assigned ${inferredType}.`,
                    source: 'Tinderbox Action Code'
                });
            }
        }
    }

    const localVars = new Map<string, string>();
    const varDeclPattern = /var:([a-zA-Z0-9]+)\s+([a-zA-Z0-9_]+)(?:\s*=\s*([^;]+))?;?/g;
    while ((m = varDeclPattern.exec(text))) {
        const typeDecl = m[1];
        const varName = m[2];

        if (reservedWords.has(varName)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(baseOffset + m.index + m[0].indexOf(varName)),
                    end: textDocument.positionAt(baseOffset + m.index + m[0].indexOf(varName) + varName.length)
                },
                message: `Reserved Word Error: '${varName}' cannot be used as a variable name.`,
                source: 'Tinderbox Action Code'
            });
        }
        const rhs = m[3] ? m[3].trim() : null;
        localVars.set(varName, typeDecl);

        if (rhs) {
            const inferredType = evaluateExpressionType(rhs, localVars);
            if (inferredType && !isCompatible(typeDecl, inferredType)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: textDocument.positionAt(baseOffset + m.index),
                        end: textDocument.positionAt(baseOffset + m.index + m[0].length)
                    },
                    message: `Type Mismatch: Variable '${varName}' declared as ${typeDecl}, but initialized with ${inferredType}.`,
                    source: 'Tinderbox Action Code'
                });
            }
        }
    }

    const varAssignPattern = /([a-zA-Z0-9_]+)\s*=\s*([^;]+);?/g;
    while ((m = varAssignPattern.exec(text))) {
        const varName = m[1];
        const rhs = m[2].trim();

        if (localVars.has(varName)) {
            const declaredType = localVars.get(varName);
            if (declaredType) {
                const inferredType = evaluateExpressionType(rhs, localVars);
                if (inferredType && !isCompatible(declaredType, inferredType)) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: {
                            start: textDocument.positionAt(baseOffset + m.index),
                            end: textDocument.positionAt(baseOffset + m.index + m[0].length)
                        },
                        message: `Type Mismatch: Variable '${varName}' is ${declaredType}, but assigned ${inferredType}.`,
                        source: 'Tinderbox Action Code'
                    });
                }
            }
        }
    }

    return diagnostics;
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
            const methodName = right.replace(/\(.*\)$/, '').replace(/\[.*\]$/, '').trim();
            // Look up method on leftType
            const methods = typeMethods.get(leftType.toLowerCase());
            if (methods) {
                const op = methods.find(m => {
                    // FIX: CSV names often have (), e.g. "String.lowercase()".
                    // User might type "$Name.lowercase".
                    // We must strip parens/brackets from the DEFINITION for comparison.
                    const suffix = m.name.split('.').pop()?.replace(/\(.*\)$/, '').replace(/\[.*\]$/, '') || m.name;
                    return suffix === methodName;
                });

                // Return type logic
                if (op && op.returnType) {
                    return op.returnType.toLowerCase();
                }
            }

            // Fallback for context-switching methods on strings
            if (leftType.toLowerCase() === 'string') {
                if (methodName === 'json') return 'json';
                if (methodName === 'xml') return 'xml';
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

interface TinderboxDesignator {
    name: string;
    description: string;
    descriptionJa?: string;
}

interface TinderboxColor {
    name: string;
    description: string;
    descriptionJa?: string;
    colorValue?: string;
}


const lowerCaseOperators: Map<string, string> = new Map(); // Case-insensitive lookup

const systemAttributes: Map<string, SystemAttribute> = new Map();
const tinderboxDataTypes: Map<string, DataType> = new Map();
const tinderboxDesignators: Map<string, TinderboxDesignator> = new Map();
const tinderboxColors: Map<string, TinderboxColor> = new Map();
// keywordNames is used for fast lookup in semantic tokens
const keywordNames: Set<string> = new Set();
// Reserved words for validation
const reservedWords: Set<string> = new Set();
// Reserved words strictly from file (for Completion)
interface TinderboxExportTag {
    name: string;
    description: string;
    descriptionJa?: string;
}

const tinderboxExportTags: Map<string, TinderboxExportTag> = new Map();

const textReservedWords: Set<string> = new Set();

let resolveResources: () => void;
const resourcesPromise = new Promise<void>((resolve) => {
    resolveResources = resolve;
});

async function loadResources() {
    try {
        const resourcePath = path.join(__dirname, '..', '..', '..', 'resource');
        connection.console.log(`Starting asynchronous resource loading from ${resourcePath}`);

        // Helper to parse CSV (handles multiline fields and escapes)
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

        // --- Load Operators from CSV ---
        const operatorsPath = path.join(resourcePath, 'extract_operators.csv');

        let opCsvContent = '';
        if (fs.existsSync(operatorsPath)) opCsvContent = await fs.promises.readFile(operatorsPath, 'utf-8');
        else connection.console.warn(`Could not find extract_operators.csv at ${operatorsPath}`);

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

                    let returnType = row[4] || '';
                    if (returnType === 'source context dependent') {
                        if (label.toLowerCase().startsWith('json.')) returnType = 'json';
                        else if (label.toLowerCase().startsWith('xml.')) returnType = 'xml';
                    }

                    const op: TinderboxOperator = {
                        name: label,
                        type: row[3], // OpType
                        returnType: returnType, // OpReturnType
                        isDotOp: isDotOp,
                        opScope: opScope,
                        signature: label + (row[11] && parseInt(row[11]) > 0 ? '(...)' : ''), // Simple signature approximation
                        description: row[23] ? row[23].replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n') : '',
                        descriptionJa: row[24] ? row[24].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n') : undefined,
                        kind: CompletionItemKind.Function // Default
                    };

                    // Refine Kind
                    if (op.type.toLowerCase().includes('cond')) {
                        op.kind = CompletionItemKind.Keyword;
                    }

                    tinderboxOperators.set(label, op);

                    const lowerName = label.toLowerCase();
                    // Populate typeMethods based on Prefix or OpScope
                    if (isDotOp || lowerName.startsWith('json.') || lowerName.startsWith('xml.')) {
                        const scope = opScope.toLowerCase();

                        // Priority 1: Prefix-based association (e.g. "List.each" -> list)
                        const prefixMatch = label.match(/^([a-zA-Z0-9]+)\./);
                        if (prefixMatch) {
                            const prefixType = prefixMatch[1].toLowerCase();
                            addOpToType(prefixType, op);

                            // Special case: JSON and XML operators are often used as dot-operators on strings (e.g. $Text.json.each)
                            if (prefixType === 'json' || prefixType === 'xml') {
                                addOpToType('string', op);
                            } else if (prefixType === 'list' || prefixType === 'set') {
                                addOpToType('list', op);
                                addOpToType('set', op);
                            } else {
                                addOpToType(prefixType, op);
                            }
                        } else if (lowerName.startsWith('list.')) {
                            addOpToType('list', op);
                            addOpToType('set', op);
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
                        } else if (isDotOp) {
                            // Priority 2: Fallback to Scope-based association
                            if (scope === 'item') {
                                // Truly generic "Item" scope
                                ['string', 'list', 'set', 'number', 'color', 'boolean', 'dictionary', 'date', 'interval'].forEach(t => addOpToType(t, op));
                            } else if (scope === 'list') {
                                addOpToType('list', op);
                                addOpToType('set', op);
                            } else if (scope === 'set') {
                                addOpToType('set', op);
                                addOpToType('list', op);
                            } else {
                                // Direct mapping: "String", "Number", "Color" etc.
                                addOpToType(scope, op);
                            }
                        }
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
                    // OpFamily logic (independent of IsDotOp, usually for static access like Color.blue)
                    const dotIdx2 = label.indexOf('.');
                    if (dotIdx2 > 0 && !label.includes(' ')) {
                        const familyName = label.substring(0, dotIdx2);
                        if (!operatorFamilies.has(familyName)) {
                            operatorFamilies.set(familyName, []);
                        }
                        // Avoid duplicates
                        const member = label.substring(dotIdx2 + 1);
                        if (!operatorFamilies.get(familyName)?.includes(member)) {
                            operatorFamilies.get(familyName)?.push(member);
                        }
                    }

                    successCount++;
                }
            });
            connection.console.log(`Loaded ${successCount} operators (async).`);

            connection.console.log(`Loaded ${tinderboxOperators.size} operators from CSV (async).`);

            // Add operators to reserved words
            for (const opName of tinderboxOperators.keys()) {
                reservedWords.add(opName);
            }
        }

        // --- Load Reserved Words from File ---
        const reservedPath = path.join(resourcePath, 'reserved_list.txt');

        if (fs.existsSync(reservedPath)) {
            const content = await fs.promises.readFile(reservedPath, 'utf-8');
            content.split(/\r?\n/).forEach((line: string) => {
                const word = line.trim();
                if (word) {
                    reservedWords.add(word);
                    textReservedWords.add(word);
                }
            });
            connection.console.log(`Loaded ${textReservedWords.size} keywords from file (async).`);
        } else {
            connection.console.warn(`Could not find reserved_list.txt at ${reservedPath}`);
        }

        // --- Load System Attributes ---
        const attributesPath = path.join(resourcePath, 'system_attributes.csv');
        let csvContent = '';
        if (fs.existsSync(attributesPath)) {
            csvContent = await fs.promises.readFile(attributesPath, 'utf-8');
        } else {
            connection.console.warn(`Could not find system_attributes.csv at ${attributesPath}`);
        }

        if (csvContent) {
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
                    description: row[17] ? row[17].replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n') : '',
                    descriptionJa: row[18] ? row[18].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n') : undefined
                };
                systemAttributes.set(name, attr);
                keywordNames.add(name); // Add to semantic tokens list
            }
            connection.console.log(`Loaded ${systemAttributes.size} system attributes (async).`);
        }

        // --- Load Data Types ---
        const typesPath = path.join(resourcePath, 'data_types_v2.csv');
        let typesContent = '';
        if (fs.existsSync(typesPath)) {
            typesContent = await fs.promises.readFile(typesPath, 'utf-8');
        } else {
            connection.console.warn(`Could not find data_types_v2.csv at ${typesPath}`);
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
                    description: row[1].replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n'),
                    descriptionJa: row[2] ? row[2].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n') : undefined
                };
                tinderboxDataTypes.set(typeKey, dataType);
                // Handle "boolean" explicit overlap if needed, but key is safe
            }
            connection.console.log(`Loaded ${tinderboxDataTypes.size} data types (async).`);
        }

        // --- Load Designators ---
        const designatorsPath = path.join(resourcePath, 'designator.csv');
        let designatorsContent = '';
        if (fs.existsSync(designatorsPath)) {
            designatorsContent = await fs.promises.readFile(designatorsPath, 'utf-8');
        } else {
            connection.console.warn(`Could not find designator.csv at ${designatorsPath}`);
        }

        if (designatorsContent) {
            const rows = parseCSV(designatorsContent);
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < 2) continue;
                const name = row[0].trim().replace(/^"|"$/g, '');
                const designator: TinderboxDesignator = {
                    name: name,
                    description: row[1].replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n'),
                    descriptionJa: row[2] ? row[2].replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n') : undefined
                };
                tinderboxDesignators.set(name.toLowerCase(), designator);
            }
            connection.console.log(`Loaded ${tinderboxDesignators.size} designators (async).`);
        }

        // --- Load Colors ---
        const colorsPath = path.join(resourcePath, 'colors.csv');
        let colorsContent = '';
        if (fs.existsSync(colorsPath)) {
            colorsContent = await fs.promises.readFile(colorsPath, 'utf-8');
        } else {
            connection.console.warn(`Could not find colors.csv at ${colorsPath}`);
        }

        if (colorsContent) {
            const rows = parseCSV(colorsContent);
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < 2) continue;
                const name = row[0].trim().replace(/^"|"$/g, '');
                const color: TinderboxColor = {
                    name: name,
                    description: row[1].replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n'),
                    descriptionJa: row[2] ? row[2].replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n') : undefined,
                    colorValue: row[3] ? row[3].trim() : undefined
                };
                tinderboxColors.set(name.toLowerCase(), color);
            }
            connection.console.log(`Loaded ${tinderboxColors.size} colors (async).`);
        }

        // --- Load Export Tags ---
        const exportTagsPath = path.join(resourcePath, 'export_tags.csv');
        let exportTagsContent = '';
        if (fs.existsSync(exportTagsPath)) {
            exportTagsContent = await fs.promises.readFile(exportTagsPath, 'utf-8');
        } else {
            connection.console.warn(`Could not find export_tags.csv at ${exportTagsPath}`);
        }

        if (exportTagsContent) {
            const rows = parseCSV(exportTagsContent);
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < 2) continue;
                const rawName = row[0].trim().replace(/^"|"$/g, '');
                const baseName = rawName.replace(/\^/g, '').replace(/\(.*\)/, '').trim().toLowerCase();
                const tag: TinderboxExportTag = {
                    name: rawName,
                    description: row[1] ? row[1].replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n') : '',
                    descriptionJa: row[2] ? row[2].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/\\n/g, '\n').replace(/(\r\n|\n|\r)/g, '  \n') : undefined
                };
                tinderboxExportTags.set(baseName, tag);
            }
            connection.console.log(`Loaded ${tinderboxExportTags.size} export tags (async).`);
        }
        connection.console.log("All resources loaded successfully (async).");
    } catch (err: any) {
        connection.console.error(`Failed to load data asynchronously: ${err.message}`);
    } finally {
        resolveResources();
    }
}




// This handler provides the initial list of the completion items.
connection.onCompletion(
    async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
        await resourcesPromise;
        const document = documents.get(textDocumentPosition.textDocument.uri);
        const content = document?.getText();

        if (!document || !content) return [];

        const settings = await getDocumentSettings(textDocumentPosition.textDocument.uri);
        const lang = settings.language;
        let textBefore = '';
        let offset = 0;
        let triggerPrefix = ''; // FIX: Restore missing declaration

        if (document && content) {
            offset = document.offsetAt(textDocumentPosition.position);
            textBefore = content.slice(0, offset); // keep original for caret context
        }

        const isExportCode = document.languageId === 'tinderbox-export-code';

        if (isExportCode) {
            // Check if we are inside a ^...^ block
            const caretRegex = /\^/g;
            let m;
            let lastCaret = -1;
            while ((m = caretRegex.exec(textBefore))) {
                lastCaret = m.index;
            }

            if (lastCaret !== -1) {
                // Potential inside tag
                const tagText = textBefore.substring(lastCaret + 1);
                // If it contains another ^, we are OUTSIDE a tag (or in a new one)
                // But we already checked for ALL carets.

                // If we just typed ^ (tagText is empty), suggest tags
                if (tagText === '' || /^[a-zA-Z0-9]+$/.test(tagText)) {
                    const range = {
                        start: document.positionAt(offset - tagText.length - 1),
                        end: textDocumentPosition.position
                    };

                    return Array.from(tinderboxExportTags.values()).map(tag => {
                        const cleanName = tag.name.replace(/\^/g, '');
                        const isFunc = cleanName.includes('(');
                        const insertText = isFunc ? `^${cleanName.replace(/\(.*\)/, '($0)^')}` : `^${cleanName}^`;
                        const desc = (lang === 'ja' && tag.descriptionJa) ? tag.descriptionJa : tag.description;
                        return {
                            label: tag.name,
                            kind: CompletionItemKind.Keyword,
                            detail: 'Export Tag',
                            documentation: { kind: 'markdown', value: desc },
                            textEdit: {
                                range: range,
                                newText: insertText
                            },
                            insertTextFormat: InsertTextFormat.Snippet
                        };
                    });
                }

                // If inside a tag that takes action code: ^value(...)
                const actionTagMatch = textBefore.match(/\^([a-zA-Z0-9$]+)\(([^)]*)$/);
                if (actionTagMatch) {
                    const tagName = actionTagMatch[1].toLowerCase();
                    if (['value', 'if', 'action', 'include', 'do', 'not'].includes(tagName)) {
                        // FALL THROUGH to normal action code completion logic
                        // but we need to adjust textBefore so normal matchers work
                        textBefore = actionTagMatch[2]; // Simulate action code context
                    }
                } else {
                    // Inside a tag but not in args? maybe just after name e.g. ^value
                    // Don't show global action code here.
                    return [];
                }
            } else if (textBefore.endsWith('^')) {
                // Handled above usually but just in case
            }
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
        // offset is already defined above
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

        // --- NEW: Control flow Snippets (each, if, ifelse) ---
        completions.push({
            label: 'each',
            kind: CompletionItemKind.Snippet,
            insertText: '\\$${1:MyList}.each(${2:loopVar}){\n\t$0\n}',
            insertTextFormat: InsertTextFormat.Snippet,
            detail: 'Iterate over a list (each loop)',
            data: { language: lang }
        });

        completions.push({
            label: 'if',
            kind: CompletionItemKind.Snippet,
            insertText: 'if(${1:condition}){\n\t$0\n}',
            insertTextFormat: InsertTextFormat.Snippet,
            detail: 'if block',
            data: { language: lang }
        });

        completions.push({
            label: 'ifelse',
            kind: CompletionItemKind.Snippet,
            insertText: 'if(${1:condition}){\n\t$2\n} else {\n\t$0\n}',
            insertTextFormat: InsertTextFormat.Snippet,
            detail: 'if/else block',
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

        // --- NEW: Designators (指定子) ---
        const designatorCompletions: CompletionItem[] = Array.from(tinderboxDesignators.values())
            .map((designator) => {
                const name = designator.name;
                // Check if it's a function-like designator (e.g. find, collect, etc. often have arguments)
                // In Tinderbox, some designators can take arguments.
                // For now, let's check if the description suggests usage with parentheses.
                const isFunc = /\(.*\)/.test(designator.description) || ['find', 'collect', 'each'].some(d => name.toLowerCase().includes(d));

                return {
                    label: name,
                    kind: CompletionItemKind.Constant,
                    detail: 'Designator (指定子)',
                    insertText: isFunc ? `${name}($0)` : name,
                    insertTextFormat: isFunc ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
                    data: { type: 'designator', key: name.toLowerCase(), language: lang }
                };
            });

        const colorCompletions: CompletionItem[] = Array.from(tinderboxColors.values())
            .map((color) => {
                return {
                    label: color.name,
                    kind: CompletionItemKind.Color,
                    detail: color.colorValue ? `Color (${color.colorValue})` : 'Color',
                    data: { type: 'color', key: color.name.toLowerCase(), language: lang }
                };
            });

        return completions.concat(attrCompletions).concat(designatorCompletions).concat(colorCompletions);

    }
);

// --- Completion Resolve Handler ---
connection.onCompletionResolve(
    async (item: CompletionItem): Promise<CompletionItem> => {
        await resourcesPromise;
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
        } else if (data.type === 'designator') {
            const d = tinderboxDesignators.get(data.key);
            if (d) {
                const desc = (lang === 'ja' && d.descriptionJa) ? d.descriptionJa : d.description;
                item.documentation = {
                    kind: 'markdown',
                    value: `**${d.name}**\n\n*Designator (指定子)*\n\n${desc}`
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
        } else if (data.type === 'color') {
            const color = tinderboxColors.get(data.key);
            if (color) {
                const desc = (lang === 'ja' && color.descriptionJa) ? color.descriptionJa : color.description;
                const hexInfo = color.colorValue ? `**${color.colorValue}**\n\n` : '';
                item.documentation = {
                    kind: 'markdown',
                    value: `**${color.name}**\n\n${hexInfo}*Color*\n\n${desc}`
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
            } else if (tinderboxDataTypes.has(word.toLowerCase())) {
                builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('type'), 0);
                prevTokenWasFunctionKeyword = false;
            } else if (tinderboxDesignators.has(word.toLowerCase())) {
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
                    const attr = systemAttributes.get(word);
                    let modifierMask = 0;
                    if (attr && attr.readOnly === true) {
                        modifierMask |= (1 << tokenModifiers.indexOf('readonly'));
                    }
                    modifierMask |= (1 << tokenModifiers.indexOf('defaultLibrary'));
                    builder.push(startPos.line, startPos.character, length, tokenTypes.indexOf('variable'), modifierMask);
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
        await resourcesPromise;
        const document = documents.get(textDocumentPosition.textDocument.uri);
        if (!document) return null;
        const settings = await getDocumentSettings(textDocumentPosition.textDocument.uri);
        const lang = settings.language;


        const offset = document.offsetAt(textDocumentPosition.position);
        const content = document.getText();

        const isExportCode = document.languageId === 'tinderbox-export-code';

        if (isExportCode) {
            // Priority: Check if we are over an Export Tag (^...^)
            // We use the same recursive logic as validation to find the exact tag at the cursor
            interface ExportTagMatch {
                tagName: string;
                tagContent: string;
                tagStart: number;
                tagEnd: number;
                contentStart: number;
            }

            const findExportTags = (input: string, baseOffset: number): ExportTagMatch[] => {
                const results: ExportTagMatch[] = [];
                let i = 0;
                while (i < input.length) {
                    if (input[i] === '^') {
                        const start = i;
                        i++;
                        let tagName = '';
                        while (i < input.length && /[a-zA-Z0-9$]/.test(input[i])) {
                            tagName += input[i];
                            i++;
                        }
                        if (tagName === '') continue;

                        if (i < input.length && input[i] === '(') {
                            const contentStartIdx = i + 1;
                            let depth = 1;
                            i++;
                            let inString: string | null = null;
                            let isEscaped = false;

                            while (i < input.length) {
                                const char = input[i];
                                if (isEscaped) {
                                    isEscaped = false;
                                } else if (char === '\\') {
                                    isEscaped = true;
                                } else if (inString) {
                                    if (char === inString) {
                                        inString = null;
                                    }
                                } else if (char === '"' || char === "'") {
                                    inString = char;
                                } else if (char === '(') {
                                    depth++;
                                } else if (char === ')') {
                                    depth--;
                                }

                                if (depth === 0 && !inString) {
                                    if (i + 1 < input.length && input[i + 1] === '^') {
                                        results.push({
                                            tagName,
                                            tagContent: input.substring(contentStartIdx, i),
                                            tagStart: baseOffset + start,
                                            tagEnd: baseOffset + i + 2,
                                            contentStart: baseOffset + contentStartIdx
                                        });
                                        i += 2;
                                        break;
                                    }
                                    break;
                                }
                                i++;
                            }
                        } else if (i < input.length && input[i] === '^') {
                            results.push({
                                tagName,
                                tagContent: '',
                                tagStart: baseOffset + start,
                                tagEnd: baseOffset + i + 1,
                                contentStart: -1
                            });
                            i++;
                        }
                    } else {
                        i++;
                    }
                }
                return results;
            };

            const allTags: ExportTagMatch[] = [];
            const collectRecursively = (input: string, baseOffset: number) => {
                const tags = findExportTags(input, baseOffset);
                for (const tag of tags) {
                    allTags.push(tag);
                    if (tag.tagContent) collectRecursively(tag.tagContent, tag.contentStart);
                }
            };

            collectRecursively(content, 0);

            // Find the most specific (inner-most) tag that contains the cursor
            const containingTags = allTags
                .filter(t => offset >= t.tagStart && offset < t.tagEnd)
                .sort((a, b) => (a.tagEnd - a.tagStart) - (b.tagEnd - b.tagStart));

            if (containingTags.length > 0) {
                const tag = containingTags[0];
                const tagNameLower = tag.tagName.toLowerCase();
                const tagStartPos = document.positionAt(tag.tagStart);
                const tagEndPos = document.positionAt(tag.tagEnd);

                // If inside content of action-bearing tag, we might want to let Action Code hover handle it
                if (['value', 'if', 'action', 'do', 'not'].includes(tagNameLower) &&
                    tag.contentStart !== -1 && offset >= tag.contentStart && offset < (tag.tagEnd - 1)) {
                    // FALL THROUGH to normal action code hover logic
                } else {
                    const tagInfo = tinderboxExportTags.get(tagNameLower);
                    if (tagInfo) {
                        const desc = (lang === 'ja' && tagInfo.descriptionJa) ? tagInfo.descriptionJa : tagInfo.description;
                        return {
                            contents: { kind: 'markdown', value: `**${tagInfo.name}**\n\n*Export Tag*\n\n${desc}` },
                            range: { start: tagStartPos, end: tagEndPos }
                        };
                    }
                }
            }
        }

        // Find the word/expression under the cursor using Tokenizer
        const tokens = tokenize(content);
        const targetIndex = tokens.findIndex((t: Token) => offset >= t.start && offset <= t.start + t.length);

        let hoveredWord = '';
        let hoveredRange: Range | undefined;

        if (targetIndex !== -1) {
            const targetToken = tokens[targetIndex];

            if (targetToken.type === 'Identifier' || targetToken.type === 'Keyword') {
                hoveredWord = targetToken.value;
                hoveredRange = {
                    start: document.positionAt(targetToken.start),
                    end: document.positionAt(targetToken.start + targetToken.length)
                };

                // Priority 1: Check for Designator
                const designator = tinderboxDesignators.get(hoveredWord.toLowerCase());
                if (designator) {
                    const desc = (lang === 'ja' && designator.descriptionJa) ? designator.descriptionJa : designator.description;
                    return {
                        contents: { kind: 'markdown', value: `**${designator.name}**\n\n*Designator*\n\n${desc}` },
                        range: hoveredRange
                    };
                }

                // Priority 2: System Attribute
                if (hoveredWord.startsWith('$')) {
                    const attr = systemAttributes.get(hoveredWord);
                    if (attr) {
                        const desc = (lang === 'ja' && attr.descriptionJa) ? attr.descriptionJa : attr.description;
                        return {
                            contents: { kind: 'markdown', value: `**${attr.name}**\n\n*Type*: ${attr.type}\n*Group*: ${attr.group}\n\n${desc}` },
                            range: hoveredRange
                        };
                    }
                }

                // Priority 3: Data Type (Type declaration context)
                let isTypeDecl = false;
                let scanIdx = targetIndex - 1;
                while (scanIdx >= 0 && tokens[scanIdx].type === 'Whitespace') scanIdx--;
                if (scanIdx >= 0 && tokens[scanIdx].type === 'Punctuation' && tokens[scanIdx].value === ':') {
                    isTypeDecl = true;
                }

                if (isTypeDecl) {
                    const typeInfo = tinderboxDataTypes.get(hoveredWord.toLowerCase());
                    if (typeInfo) {
                        const desc = (lang === 'ja' && typeInfo.descriptionJa) ? typeInfo.descriptionJa : typeInfo.description;
                        return {
                            contents: { kind: 'markdown', value: `**${typeInfo.name}**\n\n*Data Type*\n\n${desc}` },
                            range: hoveredRange
                        };
                    }
                }

                // Determine if we are part of a dot-chain to get prefixExpr
                let prefixExpr = '';
                let prevIdx = targetIndex - 1;
                while (prevIdx >= 0 && tokens[prevIdx].type === 'Whitespace') prevIdx--;

                if (prevIdx >= 0 && tokens[prevIdx].type === 'Punctuation' && tokens[prevIdx].value === '.') {
                    // We have a prefix! Backtrack to find the start of the expression
                    let exprStartTokenIdx = prevIdx - 1;
                    let parenDepth = 0;
                    while (exprStartTokenIdx >= 0) {
                        const t = tokens[exprStartTokenIdx];
                        if (t.type === 'Punctuation' && t.value === ')') {
                            parenDepth++;
                        } else if (t.type === 'Punctuation' && t.value === '(') {
                            parenDepth--;
                            if (parenDepth < 0) {
                                exprStartTokenIdx++; // exclude this '('
                                break;
                            }
                        } else if (parenDepth === 0) {
                            // Any operator or specific punctuation breaks the expression
                            if (t.type === 'Operator' || (t.type === 'Punctuation' && t.value !== '.')) {
                                exprStartTokenIdx++;
                                break;
                            }
                        }
                        exprStartTokenIdx--;
                    }
                    if (exprStartTokenIdx < 0) exprStartTokenIdx = 0;

                    prefixExpr = content.substring(tokens[exprStartTokenIdx].start, tokens[prevIdx].start).trim();
                }

                if (prefixExpr) {
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
                            const op = methods.find((m: any) => {
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
                                    range: hoveredRange
                                };
                            }
                        }
                    }
                }

                // FALLBACK: Try dotOperatorsMap (Global Suffix match)
                const ops = dotOperatorsMap.get(hoveredWord);
                if (ops && ops.length > 0) {
                    // Prefer standard operators over JSON/XML in global fallback
                    const op = ops.find((o: any) => !o.name.toLowerCase().startsWith('json.') && !o.name.toLowerCase().startsWith('xml.')) || ops[0];
                    const desc = (lang === 'ja' && op.descriptionJa) ? op.descriptionJa : op.description;
                    return {
                        contents: {
                            kind: 'markdown',
                            value: `**${op.name}**\n*${op.type}* -> ${op.returnType}\n\n\`\`\`tinderbox\n${op.signature}\n\`\`\`\n\n${desc}`
                        },
                        range: hoveredRange
                    };
                }
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
            } else {
                // FALLBACK: User Attribute
                return {
                    contents: {
                        kind: 'markdown',
                        value: `**${hoveredWord}**\n\n*User Attribute (ユーザー定義属性)*`
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

        // 2.5 Designators (Fallback lookup for bare designators)
        const designator = tinderboxDesignators.get(hoveredWord.toLowerCase());
        if (designator) {
            const desc = (lang === 'ja' && designator.descriptionJa) ? designator.descriptionJa : designator.description;
            return {
                contents: {
                    kind: 'markdown',
                    value: `**${designator.name}**\n\n*Designator*\n\n${desc}`
                },
                range: hoveredRange
            };
        }

        // 3. Colors (Newly Added Priority)
        const color = tinderboxColors.get(hoveredWord.toLowerCase());
        if (color) {
            const desc = (lang === 'ja' && color.descriptionJa) ? color.descriptionJa : color.description;
            const hexInfo = color.colorValue ? `**${color.colorValue}**\n\n` : '';
            return {
                contents: {
                    kind: 'markdown',
                    value: `**${color.name}**\n\n${hexInfo}*Color*\n\n${desc}`
                },
                range: hoveredRange
            };
        }

        // 4. Fallback: Local Variables
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
    await resourcesPromise;
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const settings = await getDocumentSettings(params.textDocument.uri);
    const lang = settings.language;
    const offset = doc.offsetAt(params.position);
    const text = doc.getText();

    // Use tokenizer to reliably find the opening parenthesis and count commas
    const textBeforeCursor = text.substring(0, offset);
    // Limit to last 2000 chars for performance
    const scanText = textBeforeCursor.length > 2000 ? textBeforeCursor.substring(textBeforeCursor.length - 2000) : textBeforeCursor;
    const tokens = tokenize(scanText);

    // Filter out whitespaces and comments
    const activeTokens = tokens.filter(t => t.type !== 'Whitespace' && t.type !== 'Comment');

    let nestedParens = 0;
    let activeParameter = 0;
    let foundOpenParenIndex = -1;

    for (let i = activeTokens.length - 1; i >= 0; i--) {
        const token = activeTokens[i];
        if (token.type === 'Punctuation' && token.value === ')') {
            nestedParens++;
        } else if (token.type === 'Punctuation' && token.value === '(') {
            if (nestedParens > 0) {
                nestedParens--;
            } else {
                foundOpenParenIndex = i;
                break;
            }
        } else if (token.type === 'Punctuation' && token.value === ',' && nestedParens === 0) {
            activeParameter++;
        }
    }

    if (foundOpenParenIndex > 0) {
        // Find the function name. Could be a dot chain.
        let i = foundOpenParenIndex - 1;
        let funcNameParts = [];

        while (i >= 0) {
            const t = activeTokens[i];
            // Include Keyword because functions like "each" might be tokenized as Keyword
            if (t.type === 'Identifier' || t.type === 'Keyword') {
                funcNameParts.unshift(t.value);
            } else if (t.type === 'Punctuation' && t.value === '.') {
                funcNameParts.unshift('.');
            } else {
                break;
            }
            i--;
        }

        const fullFuncName = funcNameParts.join('');
        if (fullFuncName) {
            let op = tinderboxOperators.get(fullFuncName);
            if (!op) {
                // Try last part
                const match = fullFuncName.match(/([a-zA-Z0-9_.]+)$/);
                if (match) {
                    const word = match[1];
                    op = tinderboxOperators.get(word);
                    if (!op && funcNameParts.length > 0) {
                        const lastWord = funcNameParts[funcNameParts.length - 1];
                        op = Array.from(tinderboxOperators.values()).find(o => o.name.toLowerCase() === lastWord.toLowerCase() || o.name.endsWith('.' + lastWord));
                    }
                }
            }

            if (op) {
                const desc = (lang === 'ja' && op.descriptionJa) ? op.descriptionJa : op.description;
                return {
                    signatures: [{
                        label: op.signature,
                        documentation: { kind: 'markdown', value: desc },
                        parameters: []
                    }],
                    activeSignature: 0,
                    activeParameter: activeParameter
                };
            }

            const lastPart = funcNameParts[funcNameParts.length - 1];
            if (lastPart) {
                const d = tinderboxDesignators.get(lastPart.toLowerCase());
                if (d) {
                    const desc = (lang === 'ja' && d.descriptionJa) ? d.descriptionJa : d.description;
                    return {
                        signatures: [{
                            label: `${d.name}(...)`,
                            documentation: { kind: 'markdown', value: desc },
                            parameters: []
                        }],
                        activeSignature: 0,
                        activeParameter: activeParameter
                    };
                }
            }
        }
    }

    return null;
});

function isDeclaration(tokens: Token[], identifierIndex: number, functionStartOffset: number = 0): boolean {
    let j = identifierIndex - 1;
    while (j >= 0 && tokens[j].type === 'Whitespace') j--;
    if (j < 0) return false;

    // 1. var decl (var x or var:Type x)
    if (tokens[j].value === 'var') return true;
    if (tokens[j].type === 'Identifier') {
        let k = j - 1;
        while (k >= 0 && tokens[k].type === 'Whitespace') k--;
        if (k >= 0 && tokens[k].value === ':') {
            k--;
            while (k >= 0 && tokens[k].type === 'Whitespace') k--;
            if (k >= 0 && tokens[k].value === 'var') return true;
        }
    }

    // 2. function decl (function x)
    if (tokens[j].value === 'function') return true;

    // 3. loop var (.each(x))
    if (tokens[j].value === '(') {
        let k = j - 1;
        while (k >= 0 && tokens[k].type === 'Whitespace') k--;
        if (k >= 0 && (tokens[k].value === 'each' || tokens[k].value === 'eachLine')) return true;
    }

    // 4. function argument
    let depthCounter = 0;
    let foundFunction = false;
    for (let k = identifierIndex - 1; k >= 0; k--) {
        if (tokens[k].start < functionStartOffset) break;
        if (tokens[k].value === ')') depthCounter++;
        else if (tokens[k].value === '(') {
            depthCounter--;
            if (depthCounter < 0) {
                let m = k - 1;
                while (m >= 0 && tokens[m].type === 'Whitespace') m--;
                if (m >= 0 && tokens[m].type === 'Identifier') {
                    m--;
                    while (m >= 0 && tokens[m].type === 'Whitespace') m--;
                    if (m >= 0 && tokens[m].value === 'function') {
                        foundFunction = true;
                    }
                }
                break;
            }
        }
    }
    if (foundFunction && depthCounter < 0) return true;

    return false;
}

connection.onDefinition(
    async (params: TextDocumentPositionParams): Promise<Definition | null> => {
        await resourcesPromise;
        const document = documents.get(params.textDocument.uri);
        if (!document) return null;

        const text = document.getText();
        const offset = document.offsetAt(params.position);

        const tokens = tokenize(text);
        const targetToken = tokens.find(t =>
            (t.type === 'Identifier' || t.type === 'Keyword') &&
            offset >= t.start && offset <= t.start + t.length
        );
        if (!targetToken) return null;
        const targetName = targetToken.value;

        // Determine scope
        let functionScope: { start: number, end: number } | null = null;
        let braceDepth = 0;
        let functionStart = -1;
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.type === 'Keyword' && t.value === 'function') functionStart = t.start;
            if (t.type === 'Punctuation' && t.value === '{') braceDepth++;
            if (t.type === 'Punctuation' && t.value === '}') {
                braceDepth--;
                if (braceDepth === 0 && functionStart !== -1) {
                    if (offset >= functionStart && offset <= t.start + t.length) {
                        functionScope = { start: functionStart, end: t.start + t.length };
                        break;
                    }
                    functionStart = -1;
                }
            }
        }

        // 1. Check local scope first
        if (functionScope) {
            for (let i = 0; i < tokens.length; i++) {
                const t = tokens[i];
                if (t.start >= functionScope.start && t.start + t.length <= functionScope.end) {
                    if (t.type === 'Identifier' && t.value === targetName) {
                        if (isDeclaration(tokens, i, functionScope.start)) {
                            return Location.create(document.uri, {
                                start: document.positionAt(t.start),
                                end: document.positionAt(t.start + t.length)
                            });
                        }
                    }
                }
            }
        }

        // 2. Fallback to global search
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.type === 'Identifier' && t.value === targetName) {
                if (isDeclaration(tokens, i, 0)) {
                    return Location.create(document.uri, {
                        start: document.positionAt(t.start),
                        end: document.positionAt(t.start + t.length)
                    });
                }
            }
        }

        // 3. Fallback to other open documents
        const processedUris = new Set<string>();
        processedUris.add(document.uri);

        for (const doc of documents.all()) {
            if (doc.uri === document.uri) continue;
            processedUris.add(doc.uri);

            const docText = doc.getText();
            const docTokens = tokenize(docText);

            for (let i = 0; i < docTokens.length; i++) {
                const t = docTokens[i];
                if (t.type === 'Identifier' && t.value === targetName) {
                    if (isDeclaration(docTokens, i, 0)) {
                        return Location.create(doc.uri, {
                            start: doc.positionAt(t.start),
                            end: doc.positionAt(t.start + t.length)
                        });
                    }
                }
            }
        }

        // 4. Fallback to global workspace cache
        for (const [uri, symbols] of workspaceSymbolCache.entries()) {
            if (processedUris.has(uri)) continue; // Already checked open documents
            const symbol = symbols.find(s => s.name === targetName);
            if (symbol) {
                return symbol.location;
            }
        }

        return null;
    }
);

interface Token {
    type: 'Comment' | 'String' | 'Number' | 'Keyword' | 'Identifier' | 'Operator' | 'Punctuation' | 'Whitespace' | 'ExportTag';
    value: string;
    start: number;
    length: number;
}

function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < text.length) {
        const char = text[i];

        // Whitespace
        if (/\s/.test(char)) {
            let start = i;
            while (i < text.length && /\s/.test(text[i])) i++;
            tokens.push({ type: 'Whitespace', value: text.substring(start, i), start, length: i - start });
            continue;
        }

        // Comment
        if (char === '/' && text[i + 1] === '/') {
            let start = i;
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
            tokens.push({ type: 'Comment', value: text.substring(start, i), start, length: i - start });
            continue;
        }

        // String
        if (char === '"' || char === "'") {
            let start = i;
            let inString = char;
            let isEscaped = false;
            i++;
            while (i < text.length) {
                if (isEscaped) {
                    isEscaped = false;
                } else if (text[i] === '\\') {
                    isEscaped = true;
                } else if (text[i] === inString) {
                    i++;
                    break;
                }
                i++;
            }
            tokens.push({ type: 'String', value: text.substring(start, i), start, length: i - start });
            continue;
        }

        // Identifier (Variables, Attributes starting with $, functions, keywords)
        if (/[a-zA-Z_$]/.test(char)) {
            let start = i;
            while (i < text.length && /[a-zA-Z0-9_$]/.test(text[i])) i++;
            const val = text.substring(start, i);
            let type: Token['type'] = 'Identifier';
            if (['var', 'function', 'if', 'else', 'while', 'do', 'return', 'each', 'true', 'false'].includes(val)) {
                type = 'Keyword';
            }
            tokens.push({ type, value: val, start, length: i - start });
            continue;
        }

        // Number
        if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(text[i + 1]))) {
            let start = i;
            if (char === '-') i++;
            while (i < text.length && /[0-9.]/.test(text[i])) i++;
            tokens.push({ type: 'Number', value: text.substring(start, i), start, length: i - start });
            continue;
        }

        // Operators
        const ops2 = ['==', '!=', '<=', '>=', '+=', '-=', '*=', '/='];
        if (i + 1 < text.length && ops2.includes(text.substring(i, i + 2))) {
            tokens.push({ type: 'Operator', value: text.substring(i, i + 2), start: i, length: 2 });
            i += 2;
            continue;
        }
        const ops1 = ['+', '-', '*', '/', '=', '<', '>', '&', '|', '!'];
        if (ops1.includes(char)) {
            tokens.push({ type: 'Operator', value: char, start: i, length: 1 });
            i++;
            continue;
        }

        // Punctuation
        const punct = ['(', ')', '{', '}', '[', ']', ',', ';', ':', '.', '^'];
        if (punct.includes(char)) {
            tokens.push({ type: 'Punctuation', value: char, start: i, length: 1 });
            i++;
            continue;
        }

        // Unknown
        tokens.push({ type: 'Identifier', value: char, start: i, length: 1 });
        i++;
    }
    return tokens;
}

function getReferenceLocations(doc: TextDocument, offset: number): Location[] {
    const text = doc.getText();
    const tokens = tokenize(text);

    const targetToken = tokens.find(t =>
        (t.type === 'Identifier' || t.type === 'Keyword') &&
        offset >= t.start && offset <= t.start + t.length
    );
    if (!targetToken) return [];
    const targetName = targetToken.value;

    let functionScope: { start: number, end: number } | null = null;
    let braceDepth = 0;
    let functionStart = -1;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'Keyword' && t.value === 'function') functionStart = t.start;
        if (t.type === 'Punctuation' && t.value === '{') braceDepth++;
        if (t.type === 'Punctuation' && t.value === '}') {
            braceDepth--;
            if (braceDepth === 0 && functionStart !== -1) {
                if (offset >= functionStart && offset <= t.start + t.length) {
                    functionScope = { start: functionStart, end: t.start + t.length };
                    break;
                }
                functionStart = -1;
            }
        }
    }

    let isLocal = false;
    if (functionScope) {
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.start >= functionScope.start && t.start + t.length <= functionScope.end) {
                if (t.type === 'Identifier' && t.value === targetName) {
                    if (isDeclaration(tokens, i, functionScope.start)) {
                        isLocal = true;
                        break;
                    }
                }
            }
        }
    }

    const searchStart = isLocal && functionScope ? functionScope.start : 0;
    const searchEnd = isLocal && functionScope ? functionScope.end : text.length;

    const references: Location[] = [];
    for (const t of tokens) {
        if (t.type === 'Identifier' && t.value === targetName) {
            if (t.start >= searchStart && t.start + t.length <= searchEnd) {
                references.push(
                    Location.create(doc.uri, {
                        start: doc.positionAt(t.start),
                        end: doc.positionAt(t.start + t.length)
                    })
                );
            }
        }
    }
    return references;
}

connection.onReferences(async (params: ReferenceParams): Promise<Location[] | null> => {
    await resourcesPromise;
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    return getReferenceLocations(doc, doc.offsetAt(params.position));
});

connection.onDocumentHighlight(async (params: DocumentHighlightParams): Promise<DocumentHighlight[] | null> => {
    await resourcesPromise;
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const locations = getReferenceLocations(doc, doc.offsetAt(params.position));
    if (!locations) return null;

    return locations.map(loc => ({
        range: loc.range,
        kind: DocumentHighlightKind.Text
    }));
});

connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
    const codeActions: CodeAction[] = [];
    params.context.diagnostics.forEach(diagnostic => {
        // 1. Smart Quote Quick Fix
        if (diagnostic.message.includes('Smart quote') && diagnostic.message.includes('detected')) {
            const match = diagnostic.message.match(/Smart quote '(.*)' detected/);
            if (match) {
                const smartQuote = match[1];
                let replacement = '"';
                if (['‘', '’'].includes(smartQuote)) {
                    replacement = "'";
                }

                codeActions.push({
                    title: `Replace with straight quote (${replacement})`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit: {
                        changes: {
                            [params.textDocument.uri]: [
                                {
                                    range: diagnostic.range,
                                    newText: replacement
                                }
                            ]
                        }
                    }
                });
            }
        }

        // 2. Case Mismatch Quick Fix
        if (diagnostic.message.includes('Case Mismatch:')) {
            const match = diagnostic.message.match(/should be '(.*)'/);
            if (match) {
                const correctCase = match[1];
                codeActions.push({
                    title: `Change to '${correctCase}'`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit: {
                        changes: {
                            [params.textDocument.uri]: [
                                {
                                    range: diagnostic.range,
                                    newText: correctCase
                                }
                            ]
                        }
                    }
                });
            }
        }
    });

    // 3. Extract to variable (Refactoring Code Action)
    // Available when there is a selection on a single line
    const range = params.range;
    if (range.start.line === range.end.line && (range.start.character !== range.end.character)) {
        const doc = documents.get(params.textDocument.uri);
        if (doc) {
            const text = doc.getText();
            // Get the selected text accurately
            const selectedText = text.substring(doc.offsetAt(range.start), doc.offsetAt(range.end));

            // Basic heuristic: avoid extracting pure whitespace or extremely short generic tokens if not a clear expression
            // But let's allow it generally if the user selected it.
            if (selectedText.trim().length > 0) {
                const varName = 'extractedVar';

                // Get the current line text to find leading whitespace for indentation
                const lineStartOffset = doc.offsetAt(Position.create(range.start.line, 0));
                const lineEndOffset = doc.offsetAt(Position.create(range.start.line + 1, 0)) || text.length;
                const lineText = text.substring(lineStartOffset, lineEndOffset);
                const leadingWhitespaceMatch = lineText.match(/^(\s*)/);
                const leadingWhitespace = leadingWhitespaceMatch ? leadingWhitespaceMatch[1] : '';

                const insertionText = `${leadingWhitespace}var:string ${varName} = ${selectedText};\n`;

                codeActions.push({
                    title: `Extract to variable ('${varName}')`,
                    kind: CodeActionKind.RefactorExtract,
                    edit: {
                        changes: {
                            [params.textDocument.uri]: [
                                {
                                    range: Range.create(Position.create(range.start.line, 0), Position.create(range.start.line, 0)),
                                    newText: insertionText
                                },
                                {
                                    range: range,
                                    newText: varName
                                }
                            ]
                        }
                    }
                });
            }
        }
    }

    return codeActions;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();



