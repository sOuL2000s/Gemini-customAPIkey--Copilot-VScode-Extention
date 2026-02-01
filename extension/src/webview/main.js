// src/webview/main.js
// This script runs in the webview context.
const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    const chatHistory = document.getElementById('chat-history');
    const promptInput = document.getElementById('prompt-input');
    const sendButton = document.getElementById('send-button');
    const newChatButton = document.getElementById('new-chat-button');
    const keyStatusIndicator = document.getElementById('key-status-indicator');
    const configPanel = document.getElementById('config-panel');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveKeyButton = document.getElementById('save-key-button');
    
    // UI ELEMENTS FOR F3
    const contextHeader = document.getElementById('context-header');
    const contextFileList = document.getElementById('context-file-list');
    const contextPlaceholder = document.getElementById('context-placeholder');
    const addContextFileButton = document.getElementById('add-context-file-button');
    
    // R4: Command Palette Elements
    const commandPalette = document.getElementById('command-palette');
    const paletteInput = document.getElementById('palette-input');

    const initialWelcomeMessage = `
        <div class="message system">
            Hello! I am Gemini. Ask me about the code you've selected, or how to implement a new feature.
        </div>`;

    chatHistory.innerHTML = initialWelcomeMessage; 

    // Utility to post a message to the extension host (extension.ts)
    const postMessage = (command, payload = {}) => {
        vscode.postMessage({ command, ...payload });
    };

    // --- F1: New Chat Session ---
    newChatButton.addEventListener('click', () => {
        postMessage('newChat');
    });

    // --- F2: Inline API Key Configuration ---
    saveKeyButton.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            saveKeyButton.textContent = 'Saving...';
            apiKeyInput.disabled = true;
            saveKeyButton.disabled = true;
            postMessage('saveKey', { key: key });
        }
    });

    // --- F3: Contextual File Inclusion ---
    addContextFileButton.addEventListener('click', () => {
        postMessage('addFileContext');
    });
    
    contextFileList.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('remove-context-file')) {
            const uri = target.getAttribute('data-uri');
            if (uri) {
                postMessage('removeFileContext', { uri: uri });
            }
        }
    });


    // R4: Command Palette Toggle Logic (Shortcut changed to Ctrl+Shift+G)
    const togglePalette = (show) => {
        if (show) {
            commandPalette.style.display = 'flex';
            paletteInput.focus();
        } else {
            commandPalette.style.display = 'none';
        }
    };

    // Simulate keyboard shortcut Ctrl+Shift+G (or Cmd+Shift+G) to invoke the palette
    document.addEventListener('keydown', (e) => {
        // Check for Ctrl/Cmd + Shift + G
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
            e.preventDefault();
            togglePalette(commandPalette.style.display === 'none');
            return;
        }
        
        // Hide palette on escape
        if (e.key === 'Escape' && commandPalette.style.display === 'flex') {
            togglePalette(false);
        }
    });
    
    // R4: Basic Palette Filtering
    paletteInput.addEventListener('input', () => {
        const filter = paletteInput.value.toLowerCase();
        document.querySelectorAll('#palette-results .palette-item').forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(filter) ? 'flex' : 'none';
        });
    });
    
    // R4: Command Execution from Palette
    paletteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            
            const prompt = paletteInput.value.trim();
            if (!prompt) return;

            // Send command as a prompt, then hide the palette
            postMessage('submitPrompt', { text: prompt });
            paletteInput.value = '';
            togglePalette(false);
            
            // Show loading message in the main chat view
            appendMessage('loading', 'Executing command...');

            // Disable main input area while processing
            promptInput.disabled = true;
            sendButton.disabled = true;
        }
    });


    // R2 & R3: Enhanced formatting for Code Responses (Simplified)
    function formatResponse(responseText) {
        
        // Treat contextual edit markers as plain text if they reach the webview, 
        // as successful in-editor edits are intercepted in the extension host.
        const plainText = responseText;

        // Existing logic for standard markdown code blocks
        const regex = /```(?:\w+)?\n([\s\S]*?)\n```/g;
        let match;
        let lastIndex = 0;
        let formattedHtml = '';
        let codeFound = false;

        while ((match = regex.exec(plainText)) !== null) {
            codeFound = true;
            const textBefore = plainText.substring(lastIndex, match.index).trim();
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

        const textAfter = plainText.substring(lastIndex).trim();
        if (textAfter) {
            formattedHtml += `<p>${textAfter}</p>`;
        }
        
        if (!codeFound && plainText.trim()) {
            formattedHtml = `<p>${plainText.trim()}</p>`;
        }
        
        return formattedHtml;
    }
    
    function updateContextFileList(files) {
        // Refactoring Change #7: Optimized List Rendering
        const fragment = document.createDocumentFragment();
        
        if (files.length > 0) {
            contextPlaceholder.style.display = 'none';
            files.forEach(uriPath => {
                const fileName = uriPath.split(/[\/\\]/).pop(); // Extract file name
                const listItem = document.createElement('li');
                
                listItem.className = 'context-file-tag';
                listItem.innerHTML = `
                    <span title="${uriPath}">${fileName}</span>
                    <button class="remove-context-file" data-uri="${uriPath}" title="Remove Context File">&times;</button>
                `;
                fragment.appendChild(listItem);
            });
            contextFileList.innerHTML = ''; // Clear existing content once
            contextFileList.appendChild(fragment); // Append all at once
        } else {
            contextFileList.innerHTML = '';
            contextPlaceholder.style.display = 'block';
        }
    }

    // R3: Attach listeners for code action buttons (standard blocks)
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
    
    // Note: Contextual edit action listeners removed as in-editor edits are now handled natively via commands.

    // Handle incoming messages from extension.ts
    window.addEventListener('message', event => {
        const message = event.data;
        const content = message.content;

        const loadingMessage = chatHistory.querySelector('.message.loading');
        if (loadingMessage) {
            loadingMessage.remove();
        }
        
        // Re-enable inputs only AFTER a response or error is handled
        if (message.command === 'response' || message.command === 'error') {
            promptInput.disabled = false;
            sendButton.disabled = false;
            promptInput.focus();
        }

        switch (message.command) {
            case 'updateStatus': 
                saveKeyButton.textContent = 'Save & Activate';
                apiKeyInput.disabled = false;
                saveKeyButton.disabled = false;

                if (message.keyStatus) {
                    keyStatusIndicator.classList.add('active');
                    keyStatusIndicator.title = 'API Key Status: Active';
                    configPanel.classList.add('hidden');
                    contextHeader.classList.remove('hidden'); 
                } else {
                    keyStatusIndicator.classList.remove('active');
                    keyStatusIndicator.title = 'API Key Status: Missing/Invalid';
                    configPanel.classList.remove('hidden');
                    contextHeader.classList.add('hidden'); 
                    chatHistory.innerHTML = ''; // Clear chat history when key is missing
                }
                updateContextFileList(message.contextFiles || []);
                break;
            
            case 'newChatConfirm':
                chatHistory.innerHTML = initialWelcomeMessage;
                break;
            
            case 'openPalette':
                togglePalette(true);
                break;
                
            case 'loading':
                appendMessage('loading', content);
                break;
            case 'response':
                const formattedHtml = formatResponse(content);
                appendMessage('assistant', formattedHtml, false); 
                attachCodeActionListeners();
                break;
            case 'error':
                appendMessage('error', content);
                break;
        }
        chatHistory.scrollTop = chatHistory.scrollHeight;
        
        // Auto-resize prompt input area 
        promptInput.style.height = 'auto';
        promptInput.style.height = (promptInput.scrollHeight) + 'px';
    });
    
    // Initial auto-resize setup and listener
    promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = (promptInput.scrollHeight) + 'px';
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
        
        // Reset height and disable input while request is pending
        promptInput.value = '';
        promptInput.style.height = 'auto';
        promptInput.disabled = true;
        sendButton.disabled = true;

        postMessage('submitPrompt', { text: prompt });
        
        // Hide palette if active when sending a message
        togglePalette(false);
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