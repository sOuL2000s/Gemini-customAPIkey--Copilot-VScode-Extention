import * as vscode from 'vscode';
import { GoogleGenAI } from '@google/genai';
import { ConfigurationManager } from './ConfigurationManager';
import { GeminiInlineCompletionProvider } from './InlineCompletionProvider';
import { SecretStorageManager } from './SecretStorageManager'; // NEW IMPORT

// --- Configuration ---
// Removed GEMINI_CHAT_MODEL constant, now read from config

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
    
    private chatModel: string;
    private contextFiles: Map<string, string> = new Map(); 
    private activeFileName: string | null = null; // 1. Track active file
    
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly secretManager: SecretStorageManager // NEW DEPENDENCY
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
            
            this._view.webview.postMessage({ 
                command: 'updateStatus', 
                keyStatus: this.apiAgent !== null,
                contextFiles: Array.from(this.contextFiles.keys()),
                activeFile: this.activeFileName, // 1. Pass active file name
                activeKeyName: activeKeyName, // NEW: Pass active key name
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
                case 'insertCode':
                    this.insertCode(message.code);
                    return;
                case 'replaceSelection':
                    this.replaceSelection(message.code);
                    return;
                case 'newChat':
                    this.handleNewChatSession();
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
                case 'removeFileContext':
                    this.handleRemoveFileContext(message.uri);
                    return;
            }
        });
    }
    
    private handleNewChatSession() {
        this.contextFiles.clear();
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
    
    private async handlePromptSubmission(userPrompt: string) {
        if (!this._view || !this.apiAgent) { return; }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.sendMessageToWebview('error', 'No active text editor found.');
            return;
        }

        const document = editor.document;
        const selectedText = document.getText(editor.selection);
        const languageId = document.languageId;
        const fullDocumentContent = document.getText(); // Get full content of the active file

        this.sendMessageToWebview('loading', 'Thinking...');

        try {
            let contextBlock = '';
            
            // 1. Inject the currently open file content as primary context
            contextBlock += `\n--- ACTIVE FILE CONTEXT: ${document.fileName} ---\n${fullDocumentContent}\n--- END ACTIVE FILE CONTEXT ---\n`;

            // 2. Inject manually added files (external context)
            if (this.contextFiles.size > 0) {
                for (const [path, content] of this.contextFiles.entries()) {
                    // Skip if the context file is the active file (to avoid duplication)
                    if (path === document.uri.fsPath) continue; 
                    
                    contextBlock += `\n--- EXTERNAL CONTEXT FILE: ${path} ---\n${content}\n--- END EXTERNAL CONTEXT ---\n`;
                }
            }

            // System instruction enforces the requested chat output format (Find/Replace blocks)
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
                config: {
                    systemInstruction: systemInstruction
                }
            });
            
            if (response && response.text) {
                // Since we removed in-editor editing, send the response directly to the chat view
                this.sendMessageToWebview('response', response.text);
            } else {
                this.sendMessageToWebview('error', 'Received an empty or malformed response from the Gemini API.');
            }
        } catch (error) {
            // Refactoring Change #5: Improved Error Handling
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message ?? 'Unknown API Error occurred.';
            } else {
                errorMessage = String(error);
            }
            
            console.error('API Call Failed:', errorMessage);
            this.sendMessageToWebview('error', `Gemini API Error: Check your API key or network connection. Error: ${errorMessage}`);
        }
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
                                <li><b>Inline Code Completion:</b> Start typing in any editor to receive real-time, context-aware suggestions (Configurable via <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20V16"/><path d="M6 12L6.01 12"/><path d="M18 8L18.01 8"/><path d="M12 16L12.01 16"/></svg> Settings).</li>
                                <li><b>Code Chat:</b> Ask questions, generate, or refactor code here. Select code in the editor to provide context.</li>
                                <li><b>Context Files:</b> Use the <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> icon to add external files to the chat context.</li>
                                <li><b>Command Palette:</b> Quickly access structured commands (e.g., <code>/refactor</code>, <code>/test</code>) using the shortcut: <code>Ctrl+Alt+H</code> (<code>Cmd+Alt+H</code> on Mac).</li>
                                <li><b>Action Blocks:</b> Responses include <code>--- FIND --- / --- REPLACE ---</code> blocks or standard code blocks with buttons for one-click application to the editor.</li>
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
                            
                            <button id="new-chat-button" title="Start New Chat Session (Plus Icon)">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </button>
                            
                            <!-- API Key Management Toggle Button -->
                            <button id="key-management-toggle" title="Manage API Keys">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="3"></circle>
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 7 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 7a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9v-.09A1.65 1.65 0 0 0 11 2h2a2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z"></path>
                                </svg>
                            </button>
                            
                            <!-- Settings Toggle Button (New) -->
                            <button id="settings-toggle" title="Model and Latency Settings">
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
                    <div id="key-management-panel" style="display: none;">
                        <div class="panel-section">
                            <h4>Active Key Selection</h4>
                            <ul id="key-list">
                                <!-- Key buttons loaded here -->
                            </ul>
                        </div>
                        <div class="panel-section">
                            <h4>Add/Update API Key</h4>
                            <input type="text" id="key-name-input" placeholder="Name (e.g., Personal, Work)" required>
                            <input type="password" id="key-value-input" placeholder="Gemini API Key (starts with AIza...)" required>
                            <button id="key-save-button">Save & Set Active</button>
                        </div>
                    </div>
                    
                    <!-- NEW: Settings Panel -->
                    <div id="settings-panel" style="display: none;">
                        <div class="panel-section">
                            <h4>Chat Model Selection</h4>
                            <select id="chat-model-select">
                                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                                <option value="gemini-2.0-flash-001">gemini-2.0-flash-001</option>
                                <option value="gemini-2.0-flash-exp-image-generation">gemini-2.0-flash-exp-image-generation</option>
                                <option value="gemini-2.0-flash-lite-001">gemini-2.0-flash-lite-001</option>
                                <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite</option>
                                <option value="gemini-exp-1206">gemini-exp-1206</option>
                                <option value="gemini-flash-latest">gemini-flash-latest</option>
                                <option value="gemini-flash-lite-latest">gemini-flash-lite-latest</option>
                                <option value="gemini-pro-latest">gemini-pro-latest</option>
                                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                                <option value="gemini-2.5-flash-image">gemini-2.5-flash-image</option>
                                <option value="gemini-2.5-flash-preview-09-2025">gemini-2.5-flash-preview-09-2025</option>
                                <option value="gemini-2.5-flash-lite-preview-09-2025">gemini-2.5-flash-lite-preview-09-2025</option>
                                <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
                                <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                                <option value="gemini-3-pro-image-preview">gemini-3-pro-image-preview</option>
                                <option value="gemini-robotics-er-1.5-preview">gemini-robotics-er-1.5-preview</option>
                                <option value="gemini-2.5-computer-use-preview-10-2025">gemini-2.5-computer-use-preview-10-2025</option>
                                <option value="gemini-embedding-001">gemini-embedding-001</option>
                                <option value="imagen-4.0-generate-preview-06-06">imagen-4.0-generate-preview-06-06</option>
                                <option value="imagen-4.0-ultra-generate-preview-06-06">imagen-4.0-ultra-generate-preview-06-06</option>
                                <option value="imagen-4.0-generate-001">imagen-4.0-generate-001</option>
                                <option value="imagen-4.0-ultra-generate-001">imagen-4.0-ultra-generate-001</option>
                                <option value="imagen-4.0-fast-generate-001">imagen-4.0-fast-generate-001</option>
                                <option value="gemini-2.5-flash-preview-tts">gemini-2.5-flash-preview-tts</option>
                                <option value="gemini-2.5-pro-preview-tts">gemini-2.5-pro-preview-tts</option>
                                <option value="gemini-2.5-flash-native-audio-latest">gemini-2.5-flash-native-audio-latest</option>
                                <option value="gemini-2.5-flash-native-audio-preview-09-2025">gemini-2.5-flash-native-audio-preview-09-2025</option>
                                <option value="gemini-2.5-flash-native-audio-preview-12-2025">gemini-2.5-flash-native-audio-preview-12-2025</option>
                                <option value="gemma-3-1b-it">gemma-3-1b-it</option>
                                <option value="gemma-3-4b-it">gemma-3-4b-it</option>
                                <option value="gemma-3-12b-it">gemma-3-12b-it</option>
                                <option value="gemma-3-27b-it">gemma-3-27b-it</option>
                                <option value="gemma-3n-e4b-it">gemma-3n-e4b-it</option>
                                <option value="gemma-3n-e2b-it">gemma-3n-e2b-it</option>
                                <option value="nano-banana-pro-preview">nano-banana-pro-preview</option>
                                <option value="deep-research-pro-preview-12-2025">deep-research-pro-preview-12-2025</option>
                                <option value="aqa">aqa</option>
                                <option value="veo-2.0-generate-001">veo-2.0-generate-001</option>
                                <option value="veo-3.0-generate-001">veo-3.0-generate-001</option>
                                <option value="veo-3.0-fast-generate-001">veo-3.0-fast-generate-001</option>
                                <option value="veo-3.1-generate-preview">veo-3.1-generate-preview</option>
                                <option value="veo-3.1-fast-generate-preview">veo-3.1-fast-generate-preview</option>
                            </select>
                        </div>
                        <div class="panel-section">
                            <h4>Inline Completion Model</h4>
                            <select id="inline-model-select">
                                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                                <option value="gemini-2.0-flash-001">gemini-2.0-flash-001</option>
                                <option value="gemini-2.0-flash-exp-image-generation">gemini-2.0-flash-exp-image-generation</option>
                                <option value="gemini-2.0-flash-lite-001">gemini-2.0-flash-lite-001</option>
                                <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite</option>
                                <option value="gemini-exp-1206">gemini-exp-1206</option>
                                <option value="gemini-flash-latest">gemini-flash-latest</option>
                                <option value="gemini-flash-lite-latest">gemini-flash-lite-latest</option>
                                <option value="gemini-pro-latest">gemini-pro-latest</option>
                                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                                <option value="gemini-2.5-flash-image">gemini-2.5-flash-image</option>
                                <option value="gemini-2.5-flash-preview-09-2025">gemini-2.5-flash-preview-09-2025</option>
                                <option value="gemini-2.5-flash-lite-preview-09-2025">gemini-2.5-flash-lite-preview-09-2025</option>
                                <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
                                <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                                <option value="gemini-3-pro-image-preview">gemini-3-pro-image-preview</option>
                                <option value="gemini-robotics-er-1.5-preview">gemini-robotics-er-1.5-preview</option>
                                <option value="gemini-2.5-computer-use-preview-10-2025">gemini-2.5-computer-use-preview-10-2025</option>
                                <option value="gemini-embedding-001">gemini-embedding-001</option>
                                <option value="imagen-4.0-generate-preview-06-06">imagen-4.0-generate-preview-06-06</option>
                                <option value="imagen-4.0-ultra-generate-preview-06-06">imagen-4.0-ultra-generate-preview-06-06</option>
                                <option value="imagen-4.0-generate-001">imagen-4.0-generate-001</option>
                                <option value="imagen-4.0-ultra-generate-001">imagen-4.0-ultra-generate-001</option>
                                <option value="imagen-4.0-fast-generate-001">imagen-4.0-fast-generate-001</option>
                                <option value="gemini-2.5-flash-preview-tts">gemini-2.5-flash-preview-tts</option>
                                <option value="gemini-2.5-pro-preview-tts">gemini-2.5-pro-preview-tts</option>
                                <option value="gemini-2.5-flash-native-audio-latest">gemini-2.5-flash-native-audio-latest</option>
                                <option value="gemini-2.5-flash-native-audio-preview-09-2025">gemini-2.5-flash-native-audio-preview-09-2025</option>
                                <option value="gemini-2.5-flash-native-audio-preview-12-2025">gemini-2.5-flash-native-audio-preview-12-2025</option>
                                <option value="gemma-3-1b-it">gemma-3-1b-it</option>
                                <option value="gemma-3-4b-it">gemma-3-4b-it</option>
                                <option value="gemma-3-12b-it">gemma-3-12b-it</option>
                                <option value="gemma-3-27b-it">gemma-3-27b-it</option>
                                <option value="gemma-3n-e4b-it">gemma-3n-e4b-it</option>
                                <option value="gemma-3n-e2b-it">gemma-3n-e2b-it</option>
                                <option value="nano-banana-pro-preview">nano-banana-pro-preview</option>
                                <option value="deep-research-pro-preview-12-2025">deep-research-pro-preview-12-2025</option>
                                <option value="aqa">aqa</option>
                                <option value="veo-2.0-generate-001">veo-2.0-generate-001</option>
                                <option value="veo-3.0-generate-001">veo-3.0-generate-001</option>
                                <option value="veo-3.0-fast-generate-001">veo-3.0-fast-generate-001</option>
                                <option value="veo-3.1-generate-preview">veo-3.1-generate-preview</option>
                                <option value="veo-3.1-fast-generate-preview">veo-3.1-fast-generate-preview</option>
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

    // Initialize Secret Storage Manager
    const secretManager = new SecretStorageManager(context.secrets);

    const provider = new GeminiCoderProvider(context.extensionUri, secretManager); // Pass manager
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
}

export function deactivate() { }
