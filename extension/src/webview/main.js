// This script runs in the webview context.
const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    const chatHistory = document.getElementById('chat-history');
    const promptInput = document.getElementById('prompt-input');
    const sendButton = document.getElementById('send-button');

    // Utility to post a message to the extension host (extension.ts)
    const postMessage = (command, text) => {
        vscode.postMessage({ command, text });
    };

    // Helper to extract and format code blocks from the response
    function formatResponse(responseText) {
        const regex = /```(?:\w+)?\n([\s\S]*?)\n```/g;
        let match;
        let lastIndex = 0;
        let formattedHtml = '';
        let codeFound = false;

        while ((match = regex.exec(responseText)) !== null) {
            codeFound = true;
            const textBefore = responseText.substring(lastIndex, match.index).trim();
            const codeContent = match[1];

            if (textBefore) {
                formattedHtml += `<p>${textBefore}</p>`;
            }

            formattedHtml += `
                <div class="code-block">
                    <pre>${escapeHtml(codeContent)}</pre>
                    <div class="code-actions">
                        <button class="action-insert" data-code="${escapeHtml(codeContent)}">Insert at Cursor</button>
                        <button class="action-replace" data-code="${escapeHtml(codeContent)}">Replace Selection</button>
                    </div>
                </div>
            `;
            lastIndex = match.index + match[0].length;
        }

        const textAfter = responseText.substring(lastIndex).trim();
        if (textAfter) {
            formattedHtml += `<p>${textAfter}</p>`;
        }
        
        if (!codeFound && responseText.trim()) {
            // If no markdown code block was found, treat the whole response as text/explanation
            formattedHtml = `<p>${responseText.trim()}</p>`;
        }
        
        return formattedHtml;
    }

    // Handle incoming messages from extension.ts
    window.addEventListener('message', event => {
        const message = event.data;
        const content = message.content;

        // Find the last loading message and remove it
        const loadingMessage = chatHistory.querySelector('.message.loading');
        if (loadingMessage) {
            loadingMessage.remove();
        }

        switch (message.command) {
            case 'loading':
                appendMessage('loading', content);
                break;
            case 'response':
                // Format the text to handle code blocks and action buttons
                const formattedHtml = formatResponse(content);
                appendMessage('assistant', formattedHtml, false); 
                // Re-attach listeners after adding new HTML content
                attachCodeActionListeners();
                break;
            case 'error':
                appendMessage('error', content);
                break;
        }
        chatHistory.scrollTop = chatHistory.scrollHeight;
    });

    // Handle user input
    sendButton.addEventListener('click', () => {
        sendMessage();
    });

    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    function sendMessage() {
        const prompt = promptInput.value.trim();
        if (!prompt) return;

        appendMessage('user', prompt);
        
        // Clear input and disable
        promptInput.value = '';
        promptInput.disabled = true;
        sendButton.disabled = true;

        // Send prompt to extension.ts
        postMessage('submitPrompt', prompt);
        
        // Re-enable after API call returns (handled by message listener)
        promptInput.disabled = false;
        sendButton.disabled = false;
        promptInput.focus();
    }
    
    // Add event listeners for code action buttons
    function attachCodeActionListeners() {
        document.querySelectorAll('.action-insert').forEach(button => {
            button.onclick = (e) => {
                const code = e.currentTarget.getAttribute('data-code');
                vscode.postMessage({ command: 'insertCode', code: code });
            };
        });

        document.querySelectorAll('.action-replace').forEach(button => {
            button.onclick = (e) => {
                const code = e.currentTarget.getAttribute('data-code');
                vscode.postMessage({ command: 'replaceSelection', code: code });
            };
        });
    }

    // DOM Manipulation Helpers
    function appendMessage(type, content, isText = true) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', type);
        
        if (isText) {
            messageDiv.textContent = content;
        } else {
            messageDiv.innerHTML = content;
        }
        
        chatHistory.appendChild(messageDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
    
    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
});