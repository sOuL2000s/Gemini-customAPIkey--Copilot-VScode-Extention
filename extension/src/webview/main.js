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
    // const paletteResults = document.getElementById('palette-results'); // Referenced here, but not used in R4 logic below.

    const initialWelcomeMessage = `
        <div class="message system">
            Hello! I am Gemini. Ask me about the code you've selected, or how to implement a new feature.
        </div>`;

    // Initialize history
    // NOTE: This initial setting is redundant if 'newChatConfirm' handles initialization,
    // but useful if the view loads before the first status update.
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
            // Center the palette within the webview space
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


    // R2 & R3: Enhanced formatting for Code Responses and Contextual Edits
    function formatResponse(responseText) {
        const CONTEXTUAL_EDIT_MARKER = "[[CONTEXTUAL_EDIT]]";
        const DIFF_SEPARATOR = "[[---]]";

        // 1. Check for Contextual Edit Structure
        if (responseText.includes(CONTEXTUAL_EDIT_MARKER)) {
            
            // Handle case where description is multi-line or missing
            const parts = responseText.split(CONTEXTUAL_EDIT_MARKER);
            const description = parts[0].trim();
            const editContent = parts.length > 1 ? parts[1].trim() : '';

            const diffParts = editContent.split(DIFF_SEPARATOR).map(p => p.trim());
            
            if (diffParts.length === 2) {
                const [removedRaw, addedRaw] = diffParts;
                
                let diffHtml = '';
                let replacementCode = addedRaw.trim(); // The final code to replace with

                // Simulate lines before/after the change for visual context
                diffHtml += `<div class="diff-line diff-context">// ... code context ...</div>`;

                // Removed lines
                if (removedRaw) {
                    removedRaw.split('\n').forEach(line => {
                        diffHtml += `<div class="diff-line diff-removed">${escapeHtml(line)}</div>`;
                    });
                }
                
                // Added lines (R2)
                if (addedRaw) {
                     addedRaw.split('\n').forEach(line => {
                        diffHtml += `<div class="diff-line diff-added">${escapeHtml(line)}</div>`;
                    });
                }
                
                diffHtml += `<div class="diff-line diff-context">// ... code context ...</div>`;
                
                // Build the final contextual block
                let formattedHtml = description ? `<p>${escapeHtml(description)}</p>` : '';
                
                formattedHtml += `
                    <div class="code-edit-block">
                        <pre>${diffHtml}</pre>
                        <!-- R3: Action Controls -->
                        <div class="context-actions">
                            <button class="reject-button" data-type="reject">Reject</button>
                            <button class="accept-button" data-type="accept" data-code="${escapeHtml(replacementCode)}">Accept Edit</button>
                        </div>
                    </div>
                `;
                
                return formattedHtml;
            }
        }


        // 2. Existing logic for standard markdown code blocks
        const regex = /```(?:\w+)?\n([\s\S]*?)\n```/g;
        let match;
        let lastIndex = 0;
        let formattedHtml = '';
        let codeFound = false;
        
        // Ensure we clean the response if the markers were partially included but structure failed
        const plainText = responseText.replace(CONTEXTUAL_EDIT_MARKER, '').replace(DIFF_SEPARATOR, ''); 

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
        contextFileList.innerHTML = '';
        
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
                contextFileList.appendChild(listItem);
            });
        } else {
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
    
    // R3: Attach listeners for contextual edit action buttons
    function attachContextualActionListeners() {
        document.querySelectorAll('.context-actions .accept-button').forEach(button => {
            button.onclick = (e) => {
                const code = e.currentTarget.getAttribute('data-code');
                // Send command to replace the current selection in the active editor
                vscode.postMessage({ command: 'replaceSelection', code: code });
            };
        });
        
        document.querySelectorAll('.context-actions .reject-button').forEach(button => {
            button.onclick = (e) => {
                // Remove the proposed edit block visually upon rejection
                const editBlock = e.currentTarget.closest('.code-edit-block');
                if (editBlock) {
                    editBlock.remove();
                }
            };
        });
    }

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
            case 'updateStatus': // F2 & F3 Status Updates
                saveKeyButton.textContent = 'Save & Activate';
                apiKeyInput.disabled = false;
                saveKeyButton.disabled = false;

                if (message.keyStatus) {
                    keyStatusIndicator.classList.add('active');
                    keyStatusIndicator.title = 'API Key Status: Active';
                    configPanel.classList.add('hidden');
                    contextHeader.classList.remove('hidden'); // Show context bar
                } else {
                    keyStatusIndicator.classList.remove('active');
                    keyStatusIndicator.title = 'API Key Status: Missing/Invalid';
                    configPanel.classList.remove('hidden');
                    contextHeader.classList.add('hidden'); // Hide context bar
                    chatHistory.innerHTML = ''; 
                }
                updateContextFileList(message.contextFiles || []);
                break;
            
            case 'newChatConfirm':
                chatHistory.innerHTML = initialWelcomeMessage;
                break;
                
            case 'loading':
                appendMessage('loading', content);
                break;
            case 'response':
                const formattedHtml = formatResponse(content);
                appendMessage('assistant', formattedHtml, false); 
                attachCodeActionListeners();
                attachContextualActionListeners();
                break;
            case 'error':
                appendMessage('error', content);
                break;
        }
        chatHistory.scrollTop = chatHistory.scrollHeight;
        
        // Auto-resize prompt input area (mimicking modern chat UIs)
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