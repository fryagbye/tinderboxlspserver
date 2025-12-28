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
    InsertTextFormat
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
                    resolveProvider: true
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
    interface ExampleSettings {
        maxNumberOfProblems: number;
        language: string;
    }

    // The global settings, used when the `workspace/configuration` request is not supported by the client.
    // Please note that this is not the case when using this server with the client provided in this example
    // but could happen with other clients.
    const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000, language: 'en' };
    let globalSettings: ExampleSettings = defaultSettings;

    // Cache the settings of all open documents
    const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

    connection.onDidChangeConfiguration(change => {
        if (hasConfigurationCapability) {
            // Reset all cached document settings
            documentSettings.clear();
        } else {
            globalSettings = <ExampleSettings>(
                (change.settings.languageServerExample || defaultSettings)
            );
        }

        // Revalidate all open text documents
        documents.all().forEach(validateTextDocument);
    });

    function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
        if (!hasConfigurationCapability) {
            return Promise.resolve(globalSettings);
        }
        let result = documentSettings.get(resource);
        if (!result) {
            result = connection.workspace.getConfiguration({
                scopeUri: resource,
                section: 'tinderboxActionCodeServer' // Section name must match package.json
            }) || defaultSettings;
            documentSettings.set(resource, result);
        }
        return result;
    }

    // Only keep settings for open documents
    documents.onDidClose(e => {
        documentSettings.delete(e.document.uri);
    });

    // The content of a text document has changed. This event is emitted
    // when the text document first opened or when its content has changed.
    documents.onDidChangeContent(change => {
        validateTextDocument(change.document);
    });

    async function validateTextDocument(textDocument: TextDocument): Promise<void> {
        // connection.console.log(`Validating document: ${textDocument.uri}`);
        let settings = await getDocumentSettings(textDocument.uri);
        if (!settings) {
            settings = defaultSettings; // Fallback
        }

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

                // Check ahead for next line starting with operator
                let nextLineStartsOperator = false;
                if (i < lines.length - 1) {
                    const nextLine = lines[i + 1].trim();
                    if (/^[\+\-\*\/\.\|&=]/.test(nextLine)) {
                        nextLineStartsOperator = true;
                    }
                }

                if (!endsWithOperator && !nextLineStartsOperator && /[a-zA-Z0-9_"')]/.test(trimmed[trimmed.length - 1])) {
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
                const inferredType = inferType(rhs);
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
                const inferredType = inferType(rhs);
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
                    const inferredType = inferType(rhs);
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

    function inferType(value: string): string | null {
        if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return 'string';
        if (/^(true|false)$/i.test(value)) return 'boolean';
        if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
        // Simple Color detection? #000000
        if (/^#[0-9a-fA-F]{6}$/.test(value)) return 'color';
        return null; // Unknown/Expression
    }

    function isCompatible(targetType: string, valueType: string): boolean {
        const normTarget = targetType.toLowerCase();
        const normValue = valueType.toLowerCase();

        if (normTarget === 'string') return normValue === 'string'; // String accepts mostly string, maybe numbers convert automatically in TB? Enforce strict? User said "Proposal OK" which implied strict warning.
        if (normTarget === 'number' || normTarget === 'num') return normValue === 'number';
        if (normTarget === 'boolean' || normTarget === 'bool') return normValue === 'boolean';
        if (normTarget === 'color') return normValue === 'color' || normValue === 'string'; // Colors are often strings?

        // Loose compatibility for others or unknown types
        return true;
    }

    connection.onDidChangeWatchedFiles(_change => {
        // Monitored files have change in VSCode
        connection.console.log('We received an file change event');
    });

    // Load keywords from file
    // --- Variables ---
    interface TinderboxOperator {
        name: string;
        signature: string;
        type: string;
        returnType: string;
        description: string;
        descriptionJa?: string;
        isDotOp: boolean;
        kind: CompletionItemKind;
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

    const tinderboxOperators: Map<string, TinderboxOperator> = new Map();
    const lowerCaseOperators: Map<string, string> = new Map(); // Case-insensitive lookup
    const operatorFamilies: Map<string, string[]> = new Map();
    const systemAttributes: Map<string, SystemAttribute> = new Map();
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
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < 24) continue;
                const firstCol = row[0].trim().replace(/^"|"$/g, '');
                // Check if it's the header row (Name, OpClass, ...)
                if (firstCol.toLowerCase() === 'name' && row[1].trim() === 'OpClass') continue;
                if (firstCol.startsWith('#')) continue;

                let name = firstCol;
                let label = name;
                const parenIndex = name.indexOf('(');
                if (parenIndex > 0) label = name.substring(0, parenIndex).trim();

                const dotIndex = label.indexOf('.');
                if (dotIndex > 0) {
                    const family = label.substring(0, dotIndex);
                    const member = label.substring(dotIndex + 1);
                    if (!operatorFamilies.has(family)) operatorFamilies.set(family, []);
                    if (!operatorFamilies.get(family)?.includes(member)) operatorFamilies.get(family)?.push(member);
                    // Add family to keywords so it highlights
                    keywordNames.add(family);
                }

                let kind: CompletionItemKind = CompletionItemKind.Function;
                if (label.startsWith('$')) kind = CompletionItemKind.Variable;
                else if (row[3] === 'Property') kind = CompletionItemKind.Property;
                // TS might think explicit number assignment is invalid for enum depending on settings, 
                // but CompletionItemKind.Method should be fine.
                else if (dotIndex > 0) kind = CompletionItemKind.Method;

                const op: TinderboxOperator = {
                    name: label,
                    signature: name,
                    type: row[3],
                    returnType: row[4],
                    description: row[23].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/(\r\n|\n|\r)/g, '  \n'),
                    descriptionJa: row[24] ? row[24].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/(\r\n|\n|\r)/g, '  \n') : undefined,
                    isDotOp: row[13].toLowerCase() === 'true',
                    kind: kind
                };

                tinderboxOperators.set(label, op);
                lowerCaseOperators.set(label.toLowerCase(), label); // For case checking
                keywordNames.add(label);
            }
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
                const name = '$' + firstCol; // Add $ prefix
                const attr: SystemAttribute = {
                    name: name,
                    type: row[1],
                    group: row[3],
                    defaultValue: row[2],
                    readOnly: row[6].toLowerCase() === 'true',
                    description: row[17] ? row[17].replace(/^"|"$/g, '').replace(/(\r\n|\n|\r)/g, '  \n') : '',
                    descriptionJa: row[18] ? row[18].replace(/^"|"$/g, '').replace(/(\r\n|\n|\r)/g, '  \n') : undefined
                };
                systemAttributes.set(name, attr);
                keywordNames.add(name); // Add to semantic tokens list
            }
            connection.console.log(`Loaded ${systemAttributes.size} system attributes.`);
        }

    } catch (err: any) {
        connection.console.error(`Failed to load data: ${err.message}`);
    }

    // --- Completion Handler ---
    connection.onCompletion(
        async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
            const document = documents.get(textDocumentPosition.textDocument.uri);
            const settings = await getDocumentSettings(textDocumentPosition.textDocument.uri);
            const lang = settings.language;
            const content = document?.getText();
            let triggerPrefix = '';

            if (content && document) {
                const offset = document.offsetAt(textDocumentPosition.position);
                const textBefore = content.slice(0, offset);
                // Check if we are potentially after a dot: e.g. "Color."
                const dotMatch = textBefore.match(/([a-zA-Z0-9_$]+)\.$/);
                if (dotMatch) {
                    triggerPrefix = dotMatch[1];
                }
            }

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

            const completions: CompletionItem[] = Array.from(tinderboxOperators.values())
                .filter(op => !op.name.includes('.'))
                .map((op) => {
                    const isFunc = op.kind === CompletionItemKind.Function || op.kind === CompletionItemKind.Method;
                    return {
                        label: op.name,
                        kind: op.kind,
                        detail: op.signature,
                        insertText: isFunc ? `${op.name}($0)` : op.name,
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

            const attrCompletions: CompletionItem[] = Array.from(systemAttributes.values()).map((attr) => {
                return {
                    label: attr.name,
                    kind: CompletionItemKind.Variable,
                    detail: `${attr.type} (Default: ${attr.defaultValue})`,
                    data: { type: 'attribute', key: attr.name, language: lang }
                };
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
                } else {
                    prevTokenWasFunctionKeyword = false;
                }
            }
        }
        return builder.build();
    });

    // --- Hover Handler ---
    connection.onHover(async (params) => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        const settings = await getDocumentSettings(params.textDocument.uri);
        const lang = settings.language;
        const offset = doc.offsetAt(params.position);
        const text = doc.getText();

        const left = text.slice(0, offset).search(/[$a-zA-Z0-9_.]+$/);
        const right = text.slice(offset).search(/[^$a-zA-Z0-9_.]/);

        const start = left >= 0 ? left : offset;
        const end = right >= 0 ? offset + right : text.length;

        const word = text.substring(start, end);

        const op = tinderboxOperators.get(word);
        const attr = systemAttributes.get(word);

        if (op) {
            const desc = (lang === 'ja' && op.descriptionJa) ? op.descriptionJa : op.description;
            return {
                contents: {
                    kind: 'markdown',
                    value: `**${op.name}**\n*${op.type}* -> ${op.returnType}\n\n\`\`\`tinderbox\n${op.signature}\n\`\`\`\n\n${desc}`
                }
            };
        } else if (attr) {
            const desc = (lang === 'ja' && attr.descriptionJa) ? attr.descriptionJa : attr.description;
            return {
                contents: {
                    kind: 'markdown',
                    value: `**${attr.name}**\n\n*Type*: ${attr.type}\n*Group*: ${attr.group}\n*Read Only*: ${attr.readOnly}\n\n${desc}`
                }
            };
        }

        // --- Fallback: Local Variables & Arguments ---
        const textBefore = text.slice(0, offset);

        // 1. Local Variables: var:Type Name
        // Regex to find "var:Type Name" (Last occurrence wins)
        // Matches: var:String myStr
        const varRegex = new RegExp(`var:([a-zA-Z0-9_]+)\\s+${word}\\b`, 'g');
        let mVar;
        let foundVarType = null;
        while ((mVar = varRegex.exec(textBefore))) {
            foundVarType = mVar[1];
        }

        if (foundVarType) {
            return {
                contents: {
                    kind: 'markdown',
                    value: `**${word}**\n\n*Variable*\n*Type*: ${foundVarType}`
                }
            };
        }

        // 2. Function Arguments: function Name(arg:Type)
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
                const argMatch = trimmed.match(/^([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?$/);
                if (argMatch) {
                    const argName = argMatch[1];
                    const argType = argMatch[2];
                    if (argName === word && argType) {
                        return {
                            contents: {
                                kind: 'markdown',
                                value: `**${word}**\n\n*Argument*\n*Type*: ${argType}`
                            }
                        };
                    }
                }
            }
        }
    });


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

    // Make the text document manager listen on the connection
    // for open, change and close text document events
    documents.listen(connection);

    // Listen on the connection
    connection.listen();

} catch (e: any) {
    connection.console.error(`Top-level error: ${e.message}`);
}
