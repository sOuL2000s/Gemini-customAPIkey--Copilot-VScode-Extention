// src/extension.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import { ConfigurationManager } from './ConfigurationManager';
import { GeminiInlineCompletionProvider } from './InlineCompletionProvider';
import { SecretStorageManager } from './SecretStorageManager';
import { FindReplaceStrategy } from './FindReplaceStrategy';

/**
 * Utility function to generate a nonce for CSP.
 */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}


/**
 * Handles the sidebar view, communication with the editor, and DIRECT Gemini API calls.
 */
class GeminiCoderProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'geminiCoderView';
    
    private _view?: vscode.WebviewView;
    private apiAgent: GoogleGenAI | null = null;
    private currentAbortController: AbortController | null = null;
    
    private chatModel: string;
    private contextFiles: Map<string, string> = new Map(); 
    private activeFileName: string | null = null; // 1. Track active file
    
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly secretManager: SecretStorageManager,
        private readonly globalState: vscode.Memento
    ) {
        this.chatModel = ConfigurationManager.getChatModel(); // Initialize model
        this.updateActiveFile(); // 1. Initial file check
        this.initializeApiAgent();

        // Listen for configuration changes (specifically activeApiKeyName, models, or debounce)
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('gemini.activeApiKeyName')) {
                this.initializeApiAgent();
            }
            if (e.affectsConfiguration('gemini.chatModel')) {
                this.chatModel = ConfigurationManager.getChatModel();
                console.log(`Chat model updated to: ${this.chatModel}`);
                this.postViewStatus(); // Update webview UI
            }
            if (e.affectsConfiguration('gemini.inlineModel') || e.affectsConfiguration('gemini.latency.debounceMs')) {
                this.postViewStatus(); // Update webview UI
            }
        });
        // 1. Listen for active editor changes
        vscode.window.onDidChangeActiveTextEditor(() => this.updateActiveFile());
    }
    
    // 1. New method to track and update the active file
    private updateActiveFile() {
        const editor = vscode.window.activeTextEditor;
        this.activeFileName = editor ? editor.document.fileName.split(/[\/\\]/).pop() || null : null;
        this.postViewStatus();
    }
    
    private async initializeApiAgent() { // Now async
        // Use the new manager to get the active key
        const apiKey = await this.secretManager.getActiveApiKey();
        if (apiKey) {
            this.apiAgent = new GoogleGenAI({ apiKey });
        } else {
            this.apiAgent = null;
        }
        this.postViewStatus();
    }

    private postViewStatus() {
        if (this._view) {
            const activeKeyName = this.secretManager.getActiveKeyName() || null;
            const chatHistory = this.globalState.get<string>('geminiLocalCoderChatHistory', '');
            
            this._view.webview.postMessage({ 
                command: 'updateStatus', 
                keyStatus: this.apiAgent !== null,
                contextFiles: Array.from(this.contextFiles.keys()),
                activeFile: this.activeFileName, // 1. Pass active file name
                activeKeyName: activeKeyName, // NEW: Pass active key name
                chatHistory: chatHistory, // Pass persisted history
                // NEW: Configuration Status
                config: {
                    chatModel: ConfigurationManager.getChatModel(),
                    inlineModel: ConfigurationManager.getInlineModel(),
                    debounceMs: ConfigurationManager.getDebounceDelay()
                }
            });
            // Also notify the webview immediately about key management details if panel is open
            this.sendKeyManagementDetails();
        }
    }
    
    // NEW: Handles fetching and sending all keys to the webview
    private async sendKeyManagementDetails() {
         const activeKeyName = this.secretManager.getActiveKeyName() || '';
         const keyNames = await this.secretManager.getAllKeyNames();
         
         if (this._view) {
             this._view.webview.postMessage({
                 command: 'keyManagementDetails',
                 keys: keyNames.map(name => ({ name, isActive: name === activeKeyName })),
                 activeName: activeKeyName
             });
         }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        this.postViewStatus();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'submitPrompt':
                    this.handlePromptSubmission(message.text);
                    return;
                case 'stopGeneration':
                    this.handleStopGeneration();
                    return;
                case 'insertCode':
                    this.insertCode(message.code);
                    return;
                case 'replaceSelection':
                    this.replaceSelection(message.code);
                    return;
                case 'requestNewChatConfirmation':
                    this.handleNewChatConfirmation();
                    return;
                case 'newChat':
                    this.handleNewChatSession();
                    return;
                case 'saveChatHistory':
                    await this.globalState.update('geminiLocalCoderChatHistory', message.history);
                    return;
                case 'requestSettingsDetails':
                    this.postViewStatus(); // Forces sending config data
                    return;
                case 'setChatModel':
                    this.handleSetChatModel(message.value);
                    return;
                case 'setInlineModel':
                    this.handleSetInlineModel(message.value);
                    return;
                case 'setDebounceDelay':
                    this.handleSetDebounceDelay(message.value);
                    return;
                // DEPRECATED SETTINGS COMMAND:
                case 'openSettings': 
                    // Direct users to configuration if they want to adjust debounce, 
                    // but key management is handled internally.
                    vscode.commands.executeCommand('workbench.action.openSettings', 'gemini.latency.debounceMs');
                    return;
                case 'saveKey':
                    // This command is now obsolete, kept for safety but unused.
                    this.handleSaveKey(message.key);
                    return;
                // --- NEW Key Management Commands ---
                case 'requestKeyManagementDetails':
                    this.sendKeyManagementDetails();
                    return;
                case 'saveNewApiKey':
                    this.handleSaveNewApiKey(message.name, message.key);
                    return;
                case 'requestDeleteConfirmation':
                    this.handleDeleteConfirmation(message.name);
                    return;
                case 'deleteApiKey':
                    this.handleDeleteApiKey(message.name);
                    return;
                case 'selectApiKey':
                    this.handleSelectApiKey(message.name);
                    return;
                // --- END Key Management Commands ---
                case 'addFileContext':
                    this.handleAddFileContext();
                    return;
                case 'autoAddContext':
                    this.autoDetectContext();
                    return;
                case 'removeFileContext':
                    this.handleRemoveFileContext(message.uri);
                    return;
                case 'sendToGlobalSearch':
                    // Step 1: Force the Search View to open
                    await vscode.commands.executeCommand('workbench.view.search');

                    // Step 2: Populate the fields for a Workspace-wide search
                    await vscode.commands.executeCommand('workbench.action.findInFiles', {
                        query: message.find,
                        replace: message.replace,
                        filesToInclude: '', // Empty string clears the filter and searches ALL files
                        triggerSearch: true,
                        preserveCase: true,
                        useRegularExpression: false
                    });
                    return;
                case 'applyFindReplace': // NEW: Handle direct find/replace in active file
                    this.handleApplyFindReplace(message.find, message.replace);
                    return;
            }
        });
    }
    
    private async handleNewChatConfirmation() {
        const response = await vscode.window.showWarningMessage(
            'Are you sure you want to start a new chat? This will clear the current chat history and context files.',
            { modal: true },
            'New Chat'
        );

        if (response === 'New Chat') {
            this.handleNewChatSession();
        }
    }

    private async handleNewChatSession() {
        this.contextFiles.clear();
        await this.globalState.update('geminiLocalCoderChatHistory', '');
        this.postViewStatus(); 
        this.sendMessageToWebview('newChatConfirm', 'Session reset.');
    }

    // Obsolete: Replaced by multi-key management commands below.
    private async handleSaveKey(key: string) { /* NOOP */ }
    
    // NEW: Handles displaying the native VS Code confirmation dialog
    private async handleDeleteConfirmation(name: string) {
        const response = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the API Key: '${name}'? This action cannot be undone.`,
            { modal: true }, 
            'Delete Key'
        );

        if (response === 'Delete Key') {
            // If confirmed by the user in the native dialog, proceed to delete the key
            this.handleDeleteApiKey(name); 
        }
    }

    // --- New Key Management Handlers ---
    private async handleSaveNewApiKey(name: string, key: string) {
        name = name.trim();
        key = key.trim();
        if (!name || !key) {
            this.sendMessageToWebview('error', 'API Key Name and Key value must not be empty.');
            return;
        }

        try {
            await this.secretManager.saveApiKey(name, key);
            
            // If saving a new key, make it active
            if (this.secretManager.getActiveKeyName() !== name) {
                 await this.secretManager.setActiveKeyName(name);
            }
             
            this.sendMessageToWebview('success', `API Key '${name}' saved and set as active.`);
            this.sendKeyManagementDetails(); // Update panel view
            this.initializeApiAgent();       // Refresh API agent connection
        } catch (e) {
            console.error("Failed to save API key:", e);
            this.sendMessageToWebview('error', `Failed to save API Key: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    
    private async handleDeleteApiKey(name: string) {
        name = name.trim();
        if (!name) return;
        
        try {
            const wasActive = this.secretManager.getActiveKeyName() === name;
            
            await this.secretManager.deleteApiKey(name);
            
            if (wasActive) {
                // If we deleted the active key, try to select the next available key
                const remainingKeys = await this.secretManager.getAllKeyNames();
                const newActive = remainingKeys.length > 0 ? remainingKeys[0] : '';
                await this.secretManager.setActiveKeyName(newActive);
            }
            
            this.sendMessageToWebview('success', `API Key '${name}' deleted.`);
            this.sendKeyManagementDetails();
            this.initializeApiAgent();
        } catch (e) {
             console.error("Failed to delete API key:", e);
            this.sendMessageToWebview('error', `Failed to delete API Key: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    
    private async handleSelectApiKey(name: string) {
        name = name.trim();
        if (!name) return;
        
        try {
            await this.secretManager.setActiveKeyName(name);
            this.sendMessageToWebview('success', `API Key set to '${name}'.`);
            this.sendKeyManagementDetails(); // Update UI list
            this.initializeApiAgent();      // Refresh API agent connection
        } catch (e) {
             console.error("Failed to select API key:", e);
            this.sendMessageToWebview('error', `Failed to select API Key: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    // --- End New Key Management Handlers ---
    
    // --- New Settings Handlers ---
    private async handleSetChatModel(model: string) {
        try {
            await ConfigurationManager.setChatModel(model);
            this.sendMessageToWebview('success', `Chat model set to ${model}.`);
            // Configuration change handler will update this.chatModel and postViewStatus
        } catch (e) {
            console.error("Failed to set chat model:", e);
            this.sendMessageToWebview('error', `Failed to set Chat Model.`);
        }
    }
    
    private async handleSetInlineModel(model: string) {
        try {
            await ConfigurationManager.setInlineModel(model);
            this.sendMessageToWebview('success', `Inline model set to ${model}.`);
            // Configuration change handler will automatically update the inline provider
        } catch (e) {
            console.error("Failed to set inline model:", e);
            this.sendMessageToWebview('error', `Failed to set Inline Model.`);
        }
    }
    
    private async handleSetDebounceDelay(delayStr: string) {
        const delay = parseInt(delayStr, 10);
        if (isNaN(delay) || delay < 100 || delay > 2000) {
            this.sendMessageToWebview('error', 'Invalid debounce delay. Must be between 100ms and 2000ms.');
            return;
        }
        try {
            await ConfigurationManager.setDebounceDelay(delay);
            this.sendMessageToWebview('success', `Debounce delay set to ${delay}ms.`);
            // Configuration change handler will automatically update the inline provider's debounce controller
        } catch (e) {
            console.error("Failed to set debounce delay:", e);
            this.sendMessageToWebview('error', `Failed to set debounce delay.`);
        }
    }


    private async handleAddFileContext() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            openLabel: 'Select files for context',
            filters: {
                'Code Files': ['ts', 'js', 'py', 'json', 'yaml', 'txt', 'md'],
                'All Files': ['*']
            }
        };

        const fileUris = await vscode.window.showOpenDialog(options);

        if (fileUris && fileUris.length > 0) {
            let filesAdded = 0;
            for (const uri of fileUris) {
                try {
                    const contentBytes = await vscode.workspace.fs.readFile(uri);
                    const content = Buffer.from(contentBytes).toString('utf8');
                    
                    // Context limit check
                    if (content.length > 100000) { 
                        // Skip large files but don't stop the process
                        this.sendMessageToWebview('error', `Skipped file ${uri.fsPath.split(/[\/\\]/).pop()} (too large: ${content.length} chars).`);
                        continue;
                    }

                    this.contextFiles.set(uri.fsPath, content);
                    filesAdded++;

                } catch (e) {
                    console.error("Failed to read context file:", e);
                    this.sendMessageToWebview('error', `Failed to read file: ${uri.fsPath.split(/[\/\\]/).pop()}`);
                }
            }
            if (filesAdded > 0) {
                this.postViewStatus();
                this.sendMessageToWebview('success', `Added ${filesAdded} file(s) to chat context.`);
            } else if (fileUris.length > 0) {
                this.sendMessageToWebview('error', `No files were added. Check size limits.`);
            }
        }
    }

    private handleRemoveFileContext(uriPath: string) {
        this.contextFiles.delete(uriPath);
        this.postViewStatus();
    }

    private async autoDetectContext() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.sendMessageToWebview('error', 'No active editor found.');
            return;
        }

        const document = editor.document;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const text = document.getText();
        const detectedTerms = new Set<string>();

        // ESM/TS imports and exports
        const jsRegex = /(?:import|export)\s+.*?\s+from\s+['"](.*?)['"]/g;
        // CommonJS require
        const cjsRegex = /require\(['"](.*?)['"]\)/g;
        // Python imports
        const pyFromRegex = /from\s+([\w.]+)\s+import/g;
        const pyImportRegex = /^import\s+([\w.]+)/gm;

        let match;
        while ((match = jsRegex.exec(text)) !== null) detectedTerms.add(match[1]);
        while ((match = cjsRegex.exec(text)) !== null) detectedTerms.add(match[1]);
        while ((match = pyFromRegex.exec(text)) !== null) detectedTerms.add(match[1]);
        while ((match = pyImportRegex.exec(text)) !== null) detectedTerms.add(match[1]);

        this.sendMessageToWebview('loading', 'Scanning for related files...');
        let filesAdded = 0;
        const currentDir = path.dirname(document.uri.fsPath);

        // 1. Add key config files if they exist in workspace root
        if (workspaceFolder) {
            const configFiles = ['tsconfig.json', 'package.json', 'requirements.txt', 'pyproject.toml', '.env.example'];
            for (const cfg of configFiles) {
                const cfgUri = vscode.Uri.joinPath(workspaceFolder.uri, cfg);
                try {
                    await vscode.workspace.fs.stat(cfgUri);
                    const contentBytes = await vscode.workspace.fs.readFile(cfgUri);
                    const content = Buffer.from(contentBytes).toString('utf8');
                    if (content.length <= 50000 && !this.contextFiles.has(cfgUri.fsPath)) {
                        this.contextFiles.set(cfgUri.fsPath, content);
                        filesAdded++;
                    }
                } catch { /* file doesn't exist */ }
            }
        }

        // 2. Resolve detected terms
        for (const term of detectedTerms) {
            let targetUris: vscode.Uri[] = [];

            if (term.startsWith('.')) {
                // Relative path resolution for JS/TS
                const resolvedPath = path.resolve(currentDir, term);
                const extensions = ['.ts', '.js', '.tsx', '.jsx', '.json'];
                const potentialPaths = [resolvedPath, ...extensions.map(ext => resolvedPath + ext)];
                
                // Check for index files in directories
                potentialPaths.push(path.join(resolvedPath, 'index.ts'), path.join(resolvedPath, 'index.js'));

                for (const p of potentialPaths) {
                    const uri = vscode.Uri.file(p);
                    try {
                        await vscode.workspace.fs.stat(uri);
                        targetUris.push(uri);
                        break; 
                    } catch {}
                }
            } else {
                // Named import or python dot notation
                const cleanTerm = term.replace(/\.[jt]sx?$/, '').replace(/\./g, '/');
                const fileName = cleanTerm.split('/').pop();
                if (!fileName || fileName.length < 3) continue;

                // Search for files matching the term across the workspace
                const searchPattern = `**/${fileName}.{ts,js,py,tsx,jsx,json}`;
                const found = await vscode.workspace.findFiles(searchPattern, '**/node_modules/**', 2);
                targetUris.push(...found);
            }

            for (const uri of targetUris) {
                if (this.contextFiles.has(uri.fsPath) || uri.fsPath === document.uri.fsPath) continue;
                
                try {
                    const contentBytes = await vscode.workspace.fs.readFile(uri);
                    const content = Buffer.from(contentBytes).toString('utf8');
                    
                    if (content.length <= 100000) {
                        this.contextFiles.set(uri.fsPath, content);
                        filesAdded++;
                    }
                } catch (e) {
                    console.error(`Failed to auto-add file ${uri.fsPath}:`, e);
                }
            }
        }

        if (filesAdded > 0) {
            this.postViewStatus();
            this.sendMessageToWebview('success', `Added ${filesAdded} related file(s) to context.`);
        } else if (detectedTerms.size === 0) {
             this.sendMessageToWebview('error', 'No obvious dependencies detected.');
        } else {
            this.sendMessageToWebview('error', 'Could not resolve detected dependencies to local files.');
        }
    }
    
    private handleStopGeneration() {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
            this.sendMessageToWebview('error', 'Generation stopped by user.');
        }
    }

    private async handlePromptSubmission(userPrompt: string) {
        if (!this._view) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.sendMessageToWebview('error', 'No active text editor found.');
            return;
        }

        const document = editor.document;
        const selectedText = document.getText(editor.selection);
        const languageId = document.languageId;
        const fullDocumentContent = document.getText();

        this.sendMessageToWebview('loading', 'Thinking...');
        
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;

        let attempts = 0;
        const maxAttempts = (await this.secretManager.getAllKeyNames()).length || 1;

        while (attempts < maxAttempts) {
            if (signal.aborted) break;

            if (!this.apiAgent) {
                await this.initializeApiAgent();
                if (!this.apiAgent) {
                    this.sendMessageToWebview('error', 'No active API Key found. Please add one in settings.');
                    this.currentAbortController = null;
                    return;
                }
            }

            try {
                let contextBlock = '';
                contextBlock += `\n--- ACTIVE FILE CONTEXT: ${document.fileName} ---\n${fullDocumentContent}\n--- END ACTIVE FILE CONTEXT ---\n`;

                if (this.contextFiles.size > 0) {
                    for (const [path, content] of this.contextFiles.entries()) {
                        if (path === document.uri.fsPath) continue; 
                        contextBlock += `\n--- EXTERNAL CONTEXT FILE: ${path} ---\n${content}\n--- END EXTERNAL CONTEXT ---\n`;
                    }
                }

                const systemInstruction = `
                    You are an expert Senior Software Engineer specializing in ${languageId}. Your function is strictly that of a code editor, not a tutor.
                    Your goal is to assist the user with code modification, generation, debugging, and refactoring.
                    ${contextBlock}
                    
                    CRITICAL CONSTRAINT: You MUST provide all code modifications and additions using one of the two strict formats below.
                    DO NOT use conversational filler, explanations, or commentary outside of these structures.
                    
                    1. For code modifications (deletion, replacement, or insertion within existing code):
                    
                    --- FIND ---
                    
                    \`\`\`${languageId}
                    
                    \`\`\`
                    
                    --- REPLACE ---
                    
                    \`\`\`${languageId}
                    
                    \`\`\`
                    
                    2. For entirely new code snippets, explanations, or general guidance, use a standard markdown code block (\`\`\`${languageId}\`).
                `;

                const userContent = `
                    --- Selected Code Context ---
                    ${selectedText ? selectedText : 'No code selected.'}
                    --- End Selected Code Context ---
                    
                    User's Request: ${userPrompt}
                `;

                const response = await this.apiAgent.models.generateContent({
                    model: this.chatModel,
                    contents: userContent,
                    config: { systemInstruction: systemInstruction }
                });
                
                if (signal.aborted) return;

                if (response && response.text) {
                    this.sendMessageToWebview('response', response.text);
                    this.currentAbortController = null;
                    return; // Success
                } else {
                    throw new Error('Empty response from API.');
                }
            } catch (error: any) {
                if (signal.aborted) {
                    this.currentAbortController = null;
                    return;
                }
                attempts++;
                const currentKey = this.secretManager.getActiveKeyName() || '';
                const nextKey = await this.secretManager.getNextKeyName(currentKey);

                if (nextKey && attempts < maxAttempts) {
                    console.warn(`API Key '${currentKey}' failed. Auto-switching to '${nextKey}'...`);
                    this.sendMessageToWebview('loading', `Key failed. Auto-switching to '${nextKey}' (Attempt ${attempts + 1}/${maxAttempts})...`);
                    await this.secretManager.setActiveKeyName(nextKey);
                    await this.initializeApiAgent();
                } else {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error('API Call Failed after all attempts:', errorMessage);
                    this.sendMessageToWebview('error', `Gemini API Error: ${errorMessage}`);
                    this.currentAbortController = null;
                    return;
                }
            }
        }
        this.currentAbortController = null;
    }
    
    private sendMessageToWebview(type: 'loading' | 'response' | 'error' | 'newChatConfirm' | 'openPalette' | 'success', content: string) {
        if (this._view) {
            this._view.webview.postMessage({ command: type, content: content });
        }
    }

    /**
     * Called by the VS Code command to open the integrated command palette.
     */
    public openCommandPalette() {
        this.sendMessageToWebview('openPalette', '');
    }

    private insertCode(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                const position = editor.selection.active;
                editBuilder.insert(position, code);
            });
        }
    }

    private replaceSelection(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
            editor.edit(editBuilder => {
                // This replaces the user's currently selected range with the accepted code.
                editBuilder.replace(editor.selection, code);
            });
        } else if (editor) {
             this.insertCode(code);
        }
    }

    /**
     * Handles searching for a string in the active editor and replacing it with another.
     */
    private async handleApplyFindReplace(findText: string, replaceText: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.sendMessageToWebview('error', 'No active text editor found to apply changes.');
            return;
        }

        const document = editor.document;
        // CRITICAL FIX: Normalize newlines in both document content and findText
        // to ensure consistent matching, regardless of OS or editor settings.
        // Retrieve the document content. VS Code's `document.getText()` is internally LF-normalized,
        // and `document.positionAt()` expects LF-based offsets.
        const documentContent = document.getText();

        // Normalize the AI's find/replace blocks to LF to ensure consistency with `documentContent`.
        const findTextLF = findText.replace(/\r\n/g, '\n');
        const replaceTextLF = replaceText.replace(/\r\n/g, '\n');
        
        // Add debug logs as requested by the user
        console.log("DEBUG: Attempting to apply Find/Replace...");
        console.log("FIND BLOCK (LF normalized):");
        console.log(JSON.stringify(findTextLF));
        console.log("REPLACE BLOCK (LF normalized):");
        console.log(JSON.stringify(replaceTextLF));
        console.log("DOCUMENT CONTENT SAMPLE (first 500 chars, LF normalized):");
        console.log(JSON.stringify(documentContent.slice(0, 500)));

        let editApplied = false;

        try {
            // New: Use the robust findMatchingRange helper which implements the 3-step strategy
            const matchResult = await this.findMatchingRange(document, findTextLF);

            if (matchResult) {
                await editor.edit(editBuilder => {
                    console.log(`DEBUG: Found match using strategy, replacing range: ${matchResult.range.start.line}:${matchResult.range.start.character} - ${matchResult.range.end.line}:${matchResult.range.end.character}`);
                    console.log("DEBUG: Found text in document to replace:");
                    console.log(JSON.stringify(matchResult.foundMatchText));

                    // Use the exact text found in the document for the replacement range
                    editBuilder.replace(matchResult.range, replaceTextLF);
                    editApplied = true;
                });
            }

            if (editApplied) {
                this.sendMessageToWebview('success', `Applied ${findText.split('\n').length > 1 ? 'block' : `'${findText}'`} replacement in active file.`);
            } else {
                // Improved error message to guide the user on exact matching
                this.sendMessageToWebview('error', `No occurrences of the 'FIND' block found in the active file. Ensure the text matches exactly, including indentation and newlines.`);
            }

        } catch (e) {
            console.error('Failed to apply find/replace:', e);
            this.sendMessageToWebview('error', `Failed to apply changes: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * Helper method to find a matching range in the document using a 3-step strategy:
     * 1. Exact Match
     * 2. Normalized Match (trimming leading/trailing whitespace from each line)
     * 3. First-line Anchor Search + simple bracket/parenthesis/brace matching
     */
    private async findMatchingRange(document: vscode.TextDocument, findTextLF: string): Promise<{ range: vscode.Range, foundMatchText: string } | null> {
        return FindReplaceStrategy.findMatchingRange(document, findTextLF);
    }


    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles.css'));
        
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Gemini Code Chat</title>
                <link href="${styleUri}" rel="stylesheet">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            </head>
            <body>
                <div id="chat-container">
                    <div id="chat-history">
                        <div class="message system">
                            <p>Hello! I am Gemini, your expert coding assistant.</p>
                            <p>Here are my key functionalities:</p>
                            <ul>
                                <li><b>Inline Code Completion:</b> Start typing in any editor to receive real-time suggestions. Model and latency can be tuned in Settings <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20V16"/><path d="M6 12L6.01 12"/><path d="M18 8L18.01 8"/><path d="M12 16L12.01 16"/></svg>.</li>
                                <li><b>Code Chat:</b> Ask questions or refactor code. Selected text in the editor is automatically included as context.</li>
                                <li><b>Context Management:</b> Use <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> to add files, or the wand icon to auto-detect workspace dependencies.</li>
                                <li><b>Command Palette:</b> Access structured commands (e.g., <code>/refactor</code>, <code>/test</code>) using <code>Ctrl+Alt+H</code> (<code>Cmd+Alt+H</code> on Mac).</li>
                                <li><b>Action Blocks:</b> Gemini uses <code>--- FIND --- / --- REPLACE ---</code> blocks for modifications.
                                    <ul>
                                        <li><b>Apply to Active File:</b> Uses a robust matching strategy to automatically update the code in your current editor.</li>
                                        <li><b>Send to Global Search:</b> Recommended for workspace-wide changes. Opens the VS Code Search sidebar with pre-filled fields for review.</li>
                                    </ul>
                                </li>
                            </ul>
                            <p>Ensure your API Key is active via the <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 7 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 7a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9v-.09A1.65 1.65 0 0 0 11 2h2a2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z"/></svg> API Key Management button before starting.</p>
                        </div>
                    </div>
                </div>
                
                <div id="bottom-controls">
                    
                    <!-- 4. Removed inline config panel -->

                    <div id="context-header">
                        <div id="context-file-controls">
                            
                            <button id="add-context-file-button" title="Add file context (File Icon)">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14 2 14 8 20 8"/>
                                </svg>
                            </button>

                            <button id="auto-context-button" title="Auto-detect related files (Imports/Exports)">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path>
                                    <line x1="16" y1="8" x2="2" y2="22"></line>
                                    <line x1="17.5" y1="15" x2="9" y2="15"></line>
                                </svg>
                            </button>
                            
                            <button id="new-chat-button" title="Start New Chat Session (Plus Icon)">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </button>
                            
                            <!-- API Key Management Toggle Button -->
                            <button id="key-management-toggle" title="Manage API Keys" aria-haspopup="true" aria-expanded="false" aria-controls="key-management-panel">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="3"></circle>
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 7 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 7a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9v-.09A1.65 1.65 0 0 0 11 2h2a2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z"></path>
                                </svg>
                            </button>
                            
                            <!-- Settings Toggle Button (New) -->
                            <button id="settings-toggle" title="Model and Latency Settings" aria-haspopup="true" aria-expanded="false" aria-controls="settings-panel">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 20V10"/>
                                    <path d="M18 20V4"/>
                                    <path d="M6 20V16"/>
                                    <path d="M6 12L6.01 12"/>
                                    <path d="M18 8L18.01 8"/>
                                    <path d="M12 16L12.01 16"/>
                                </svg>
                            </button>
                            
                            <div id="key-status-indicator" title="API Key Status: Missing"></div>
                        </div>
                        <div id="context-summary">
                            <ul id="context-file-list">
                                <!-- Files loaded here -->
                            </ul>
                            <span id="active-file-indicator"></span> <!-- 1. New indicator for active file -->
                        </div>
                    </div>
                    
                    <!-- NEW: Key Management Panel -->
                    <div id="key-management-panel" style="display: none;" role="dialog" aria-labelledby="key-mgmt-title">
                        <div class="panel-section">
                            <button class="panel-close-button" title="Close Panel" aria-label="Close API Key Management">&times;</button>
                            <h4 id="key-mgmt-title">Active Key Selection</h4>
                            <ul id="key-list" role="listbox" aria-label="Stored API Keys">
                                <!-- Key buttons loaded here -->
                            </ul>
                        </div>
                        <div class="panel-section">
                            <h4>Add/Update API Key</h4>
                            <input type="text" id="key-name-input" placeholder="Name (e.g., Personal, Work)" required aria-label="API Key Name">
                            <input type="password" id="key-value-input" placeholder="Gemini API Key (starts with AIza...)" required aria-label="API Key Value">
                            <button id="key-save-button">Save & Set Active</button>
                        </div>
                    </div>
                    
                    <!-- NEW: Settings Panel -->
                    <div id="settings-panel" style="display: none;" role="dialog" aria-labelledby="settings-title">
                        <div class="panel-section">
                            <button class="panel-close-button" title="Close Panel" aria-label="Close Settings">&times;</button>
                            <h4 id="settings-title">Chat Model Selection</h4>
                            <select id="chat-model-select" aria-label="Select Chat Model">
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                <option value="gemini-3-flash-preview">Gemini 3 Flash (Preview)</option>
                                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite</option>
                                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
                                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</option>
                                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                            </select>
                        </div>
                        <div class="panel-section">
                            <h4>Inline Completion Model</h4>
                            <select id="inline-model-select">
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                <option value="gemini-3-flash-preview">Gemini 3 Flash (Preview)</option>
                                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite</option>
                                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
                                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</option>
                                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                            </select>
                        </div>
                        <div class="panel-section">
                            <h4>Inline Latency (Debounce)</h4>
                            <div class="settings-input-group">
                                <input type="number" id="debounce-input" min="100" max="2000" step="100" placeholder="500">
                                <span>ms</span>
                            </div>
                            <p class="settings-hint">Delay after typing stops before completion request (100ms - 2000ms).</p>
                        </div>
                    </div>

                    <div id="action-bar">
                        <textarea id="prompt-input" placeholder="Describe what to build next" rows="1"></textarea> <!-- 2. Updated placeholder -->
                        <button id="send-button" title="Send Prompt (Arrow Icon)">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- R4: INLINE COMMAND PALETTE STRUCTURE (Hidden by default) -->
                <div id="command-palette">
                    <input type="text" id="palette-input" placeholder="Gemini Command Palette (Ctrl+Alt+H)">
                    <ul id="palette-results">
                        <li class="palette-item selected" data-command="/refactor">
                            <span>/refactor selection</span>
                            <span class="palette-shortcut">Ctrl+R</span>
                        </li>
                         <li class="palette-item" data-command="/test">
                            <span>/test: Generate unit tests</span>
                            <span class="palette-shortcut">Ctrl+T</span>
                        </li>
                        <li class="palette-item" data-command="/explain">
                            <span>/explain this block</span>
                            <span class="palette-shortcut">Ctrl+E</span>
                        </li>
                    </ul>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}


// --- Extension Activation ---
export function activate(context: vscode.ExtensionContext) {
    console.log('Gemini Local Coder extension is now active!');

    const api = { context };

    // Initialize Secret Storage Manager
    const secretManager = new SecretStorageManager(context.secrets);

    const provider = new GeminiCoderProvider(context.extensionUri, secretManager, context.globalState); // Pass manager and state
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GeminiCoderProvider.viewType, provider)
    );
    
    // R5: Register Command Palette Command
    context.subscriptions.push(
        vscode.commands.registerCommand('gemini-local-coder.openCommandPalette', () => {
            provider.openCommandPalette();
        })
    );
    
    // Pass manager to inline provider
    const inlineProvider = new GeminiInlineCompletionProvider(secretManager);
    const selector: vscode.DocumentSelector = { language: '*', scheme: 'file' };

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(selector, inlineProvider)
    );
    
    console.log('Gemini Inline Completion Provider registered.');
    return api;
}

export function deactivate() { }