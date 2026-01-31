import * as vscode from 'vscode';
import { GoogleGenAI } from '@google/genai';
import { ConfigurationManager } from './ConfigurationManager';
import { GeminiInlineCompletionProvider } from './InlineCompletionProvider';

// --- Configuration ---
const GEMINI_CHAT_MODEL = "gemini-2.5-flash-preview-09-2025"; 

/**
 * Handles the sidebar view, communication with the editor, and DIRECT Gemini API calls.
 */
class GeminiCoderProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'geminiCoderView';
    
    private _view?: vscode.WebviewView;
    private apiAgent: GoogleGenAI | null = null;
    
    // F3: State to hold contextual file contents
    private contextFiles: Map<string, string> = new Map(); 

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.initializeApiAgent();
        vscode.workspace.onDidChangeConfiguration(() => this.initializeApiAgent());
    }
    
    private initializeApiAgent() {
        const apiKey = ConfigurationManager.getApiKey();
        if (apiKey) {
            this.apiAgent = new GoogleGenAI({ apiKey });
            this.postViewStatus();
        } else {
            this.apiAgent = null;
            this.postViewStatus();
        }
    }

    private postViewStatus() {
        if (this._view) {
            this._view.webview.postMessage({ 
                command: 'updateStatus', 
                keyStatus: this.apiAgent !== null,
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

    private async handleSaveKey(key: string) {
        const trimmedKey = key.trim();
        if (trimmedKey) {
            await vscode.workspace.getConfiguration('gemini').update(
                'apiKey', 
                trimmedKey, 
                vscode.ConfigurationTarget.Global
            );
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
                
                if (content.length > 50000) { 
                    this.sendMessageToWebview('error', `File too large (${content.length} chars). Max recommended size is 50,000 characters.`);
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

        const selectedText = editor.document.getText(editor.selection);
        const languageId = editor.document.languageId;

        this.sendMessageToWebview('loading', 'Thinking...');

        try {
            let contextBlock = '';
            if (this.contextFiles.size > 0) {
                for (const [path, content] of this.contextFiles.entries()) {
                    contextBlock += `\n--- EXTERNAL CONTEXT FILE: ${path} ---\n${content}\n--- END EXTERNAL CONTEXT ---\n`;
                }
            }

            // FIX: Strengthened system instruction for consistent contextual editing (R2)
            const systemInstruction = `
                You are an expert Senior Software Engineer specializing in ${languageId}.
                Your goal is to assist the user with code generation, explanation, debugging, and refactoring.
                ${contextBlock}
                
                CRITICAL CONSTRAINT: If the user requests any code modification, update, or insertion, you MUST respond using ONE of the following formats. DO NOT use both.
                
                1. A standard markdown code block (\`\`\`language\`).
                2. The precise contextual edit format (for inline changes to the selected code):
                
                [Brief description of the change]
                [[CONTEXTUAL_EDIT]]
                [Lines of existing code to be REMOVED (keep original indentation)]
                [[---]]
                [Lines of new code to be ADDED (with correct indentation)]

                DO NOT add extra commentary outside the chosen block structure.
            `;

            const userContent = `
                --- Selected Code Context ---
                ${selectedText ? selectedText : 'No code selected.'}
                --- End Selected Code Context ---
                
                User's Request: ${userPrompt}
            `;

            const response = await this.apiAgent.models.generateContent({
                model: GEMINI_CHAT_MODEL,
                contents: userContent,
                config: {
                    systemInstruction: systemInstruction
                }
            });
            
            if (response && response.text) {
                this.sendMessageToWebview('response', response.text);
            } else {
                this.sendMessageToWebview('error', 'Received an empty or malformed response from the Gemini API.');
            }
        } catch (error) {
            let messagePart: string | unknown;
            if (error instanceof Error) {
                messagePart = error.message ?? 'Unknown API Error occurred.';
            } else {
                messagePart = error;
            }
            const errorMessage: string = String(messagePart);
            
            console.error('API Call Failed:', errorMessage);
            this.sendMessageToWebview('error', `Gemini API Error: Check your API key or network connection. Error: ${errorMessage}`);
        }
    }
    
    private sendMessageToWebview(type: 'loading' | 'response' | 'error' | 'newChatConfirm', content: string) {
        if (this._view) {
            this._view.webview.postMessage({ command: type, content: content });
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
                        <input type="password" id="api-key-input" placeholder="Enter your Gemini API Key">
                        <button id="save-key-button">Save & Activate</button>
                    </div>

                    <div id="context-header">
                        <div id="context-file-controls">
                            
                            <button id="add-context-file-button" title="Add file context (Paperclip Icon)">
                                <!-- Paperclip Icon SVG (Attachment Icon) -->
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3L22 10"/>
                                    <path d="M19 11l-6.5 6.5a1.5 1.5 0 0 1-3-3L16 8"/>
                                </svg>
                            </button>
                            
                            <button id="new-chat-button" title="Start New Chat Session (Plus Icon)">
                                <!-- Plus Icon SVG -->
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
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
                            <!-- Send Arrow Icon SVG -->
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- R4: INLINE COMMAND PALETTE STRUCTURE (Hidden by default) -->
                <div id="command-palette">
                    <!-- Shortcut updated to Ctrl+Shift+G -->
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

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

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

// --- Extension Activation ---
export function activate(context: vscode.ExtensionContext) {
    console.log('Gemini Local Coder extension is now active!');

    const provider = new GeminiCoderProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GeminiCoderProvider.viewType, provider)
    );

    const inlineProvider = new GeminiInlineCompletionProvider();
    const selector: vscode.DocumentSelector = { language: '*', scheme: 'file' };

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(selector, inlineProvider)
    );
    
    console.log('Gemini Inline Completion Provider registered.');
}

export function deactivate() { }