import * as vscode from 'vscode';
import * as path from 'path';

// --- Configuration ---
const BACKEND_URL = 'http://127.0.0.1:8000/chat';

/**
 * Handles the sidebar view, communication with the editor, and backend API calls.
 */
class GeminiCoderProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'geminiCoderView';
    
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

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
            }
        });
    }

    /**
     * Gathers context and calls the backend API.
     */
    private async handlePromptSubmission(userPrompt: string) {
        if (!this._view) {
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.sendMessageToWebview('error', 'No active text editor found.');
            return;
        }

        // 1. Gather Context
        const selectedText = editor.document.getText(editor.selection);
        const languageId = editor.document.languageId;

        this.sendMessageToWebview('loading', 'Thinking...');

        try {
            // 2. Prepare Payload
            const payload = {
                prompt: userPrompt,
                selectedCode: selectedText,
                language: languageId,
            };

            // 3. Call Backend
            const response = await fetch(BACKEND_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Backend Error: ${response.status} - ${errorBody}`);
            }

            const data = await response.json();
            
            // 4. Send AI response back to the webview
            this.sendMessageToWebview('response', data.responseText);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('API Call Failed:', errorMessage);
            this.sendMessageToWebview('error', `Failed to connect to backend (http://127.0.0.1:8000). Ensure the Python FastAPI service is running.\nError: ${errorMessage}`);
        }
    }
    
    private sendMessageToWebview(type: 'loading' | 'response' | 'error', content: string) {
        if (this._view) {
            this._view.webview.postMessage({ command: type, content: content });
        }
    }


    /**
     * Inserts generated code at the current cursor position.
     */
    private insertCode(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                const position = editor.selection.active;
                editBuilder.insert(position, code);
            });
        }
    }

    /**
     * Replaces the currently selected code with the generated code.
     */
    private replaceSelection(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
            editor.edit(editBuilder => {
                editBuilder.replace(editor.selection, code);
            });
        } else if (editor) {
             // If nothing is selected, treat it as an insertion at cursor
             this.insertCode(code);
        }
    }


    /**
     * Loads the HTML content for the webview.
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles.css'));
        
        // Use a Content Security Policy
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
                
                <div id="action-bar">
                    <textarea id="prompt-input" placeholder="Ask Gemini..." rows="3"></textarea>
                    <button id="send-button">Send</button>
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
}

// This method is called when your extension is deactivated
export function deactivate() {}