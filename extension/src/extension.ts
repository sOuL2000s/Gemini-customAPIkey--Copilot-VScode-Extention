import * as vscode from 'vscode';
import { GoogleGenAI } from '@google/genai';
import { ConfigurationManager } from './ConfigurationManager';
import { GeminiInlineCompletionProvider } from './InlineCompletionProvider';

// --- Configuration ---
const GEMINI_CHAT_MODEL = "gemini-2.5-flash-preview-09-2025"; 

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
    
    private readonly chatModel = GEMINI_CHAT_MODEL; // Refactoring #5: Used dedicated model constant
    private contextFiles: Map<string, string> = new Map(); 
    
    constructor(private readonly _extensionUri: vscode.Uri) {
        this.initializeApiAgent();
        vscode.workspace.onDidChangeConfiguration(() => this.initializeApiAgent());
    }
    
    private initializeApiAgent() {
        const apiKey = ConfigurationManager.getActiveApiKey();
        
        if (apiKey) {
            this.apiAgent = new GoogleGenAI({ apiKey });
        } else {
            this.apiAgent = null;
        }
        this.postViewStatus();
    }

    private postViewStatus() {
        if (this._view) {
            const { activeName, profiles } = ConfigurationManager.getProfiles();
            this._view.webview.postMessage({ 
                command: 'updateStatus', 
                keyStatus: this.apiAgent !== null,
                activeProfile: activeName,
                availableProfiles: Object.keys(profiles),
                contextFiles: Array.from(this.contextFiles.keys())
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
                case 'saveKey':
                    this.handleSaveKey(message.key);
                    return;
                case 'openSettings':
                    this.handleOpenSettings(message.settingKey);
                    return;
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

    private async handleSaveKey(key: string, profileName: string = 'default') {
        const trimmedKey = key.trim();
        if (trimmedKey) {
            const config = vscode.workspace.getConfiguration('gemini');
            const profiles = config.get<{[key: string]: string}>('profiles') || {};
            
            // Allow specifying profileName, defaulting to 'default'
            if (!profileName || profileName.trim() === '') {
                 profileName = 'default';
            }
            
            profiles[profileName] = trimmedKey;
            
            await config.update('profiles', profiles, vscode.ConfigurationTarget.Global);
            await config.update('activeProfile', profileName, vscode.ConfigurationTarget.Global);
            
            // Re-initialize agent to validate the new key
            this.initializeApiAgent();
        }
    }

    private async handleSwitchProfile(profileName: string) {
        if (profileName) {
            const config = vscode.workspace.getConfiguration('gemini');
            await config.update('activeProfile', profileName, vscode.ConfigurationTarget.Global);
            
            // Re-initialize agent to load the key from the new profile
            this.initializeApiAgent();
        }
    }

    private async handleAddFileContext() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Select file for context',
            filters: {
                'Code Files': ['ts', 'js', 'py', 'json', 'yaml', 'txt', 'md'],
                'All Files': ['*']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);

        if (fileUri && fileUri.length > 0) {
            const uri = fileUri[0];
            try {
                const contentBytes = await vscode.workspace.fs.readFile(uri);
                const content = Buffer.from(contentBytes).toString('utf8');
                
                // Context limit check
                if (content.length > 100000) { 
                    this.sendMessageToWebview('error', `File too large (${content.length} chars). Max recommended size is 100,000 characters for chat context.`);
                    return;
                }

                this.contextFiles.set(uri.fsPath, content);
                this.postViewStatus();

            } catch (e) {
                console.error("Failed to read context file:", e);
                this.sendMessageToWebview('error', `Failed to read file: ${uri.fsPath}`);
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
    
    private sendMessageToWebview(type: 'loading' | 'response' | 'error' | 'newChatConfirm' | 'openPalette', content: string) {
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
    
    private handleOpenSettings(settingKey: string) {
        if (settingKey) {
            vscode.commands.executeCommand('workbench.action.openSettings', settingKey);
        }
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
                            Hello! I am Gemini. Ask me about the code you've selected, or how to implement a new feature.
                        </div>
                    </div>
                </div>
                
                <div id="bottom-controls">
                    
                    <div id="config-panel" class="hidden">
                        <input type="text" id="profile-name-input" placeholder="Profile Name (e.g., 'work', 'personal')">
                        <input type="password" id="api-key-input" placeholder="API Key">
                        <button id="save-key-button">Save & Activate</button>
                    </div>

                    <div id="context-header">
                        <div id="context-file-controls">
                            
                            <div id="profile-display">
                                <label for="profile-selector" id="profile-label">Profile:</label>
                                <select id="profile-selector" title="Select Active Gemini API Profile"></select>
                                <button id="edit-profiles-button" title="Add/Edit API Keys">Edit Keys</button>
                            </div>
                            
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

                            <button id="menu-button" title="More Options (Three Dot Menu)">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
                                </svg>
                            </button>

                            <div id="key-status-indicator" title="API Key Status: Missing"></div>
                        </div>
                        <div id="context-summary">
                            <ul id="context-file-list">
                                <!-- Files loaded here -->
                            </ul>
                            <span id="context-placeholder">Describe what to build next</span>
                        </div>
                    </div>
                
                    <div id="action-bar">
                        <textarea id="prompt-input" placeholder="Ask Gemini..." rows="1"></textarea>
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
                    <input type="text" id="palette-input" placeholder="Gemini Command Palette (Ctrl+Shift+G)">
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

                <!-- NEW: Three Dot Menu Structure -->
                <div id="options-menu" class="hidden">
                    <ul id="menu-options-list">
                        <li id="menu-edit-keys">Add/Edit API Keys</li>
                        <li id="menu-open-profiles-settings">Open gemini.profiles in Settings</li>
                        <li id="menu-latency-settings">Adjust Latency/Debounce Settings</li>
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

    const provider = new GeminiCoderProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GeminiCoderProvider.viewType, provider)
    );
    
    // R5: Register Command Palette Command
    context.subscriptions.push(
        vscode.commands.registerCommand('gemini-local-coder.openCommandPalette', () => {
            provider.openCommandPalette();
        })
    );
    


    const inlineProvider = new GeminiInlineCompletionProvider();
    const selector: vscode.DocumentSelector = { language: '*', scheme: 'file' };

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(selector, inlineProvider)
    );
    
    console.log('Gemini Inline Completion Provider registered.');
}

export function deactivate() { }
