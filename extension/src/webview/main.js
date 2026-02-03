// src/webview/main.js
// This script runs in the webview context.
// src/webview/main.js
// This script runs in the webview context.
const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    const chatHistory = document.getElementById('chat-history');
    const promptInput = document.getElementById('prompt-input');
    const sendButton = document.getElementById('send-button');
    const newChatButton = document.getElementById('new-chat-button');
    const keyStatusIndicator = document.getElementById('key-status-indicator');
    
    // Key Management Elements (R6)
    const keyManagementToggle = document.getElementById('key-management-toggle');
    const keyManagementPanel = document.getElementById('key-management-panel');
    const keyNameInput = document.getElementById('key-name-input');
    const keyValueInput = document.getElementById('key-value-input');
    const keySaveButton = document.getElementById('key-save-button');
    const keyList = document.getElementById('key-list');
    
    // UI ELEMENTS FOR F3
    const contextHeader = document.getElementById('context-header');
    const contextFileList = document.getElementById('context-file-list');
    // 1. New active file indicator element
    const activeFileIndicator = document.getElementById('active-file-indicator'); 
    const addContextFileButton = document.getElementById('add-context-file-button');
    
    // R4: Command Palette Elements
    const commandPalette = document.getElementById('command-palette');
    const paletteInput = document.getElementById('palette-input');

    const CHAT_STORAGE_KEY = 'geminiLocalCoderChatHistory'; // 3. Storage key
    const initialWelcomeMessage = `
        <div class="message system">
            Hello! I am Gemini. Ask me about the code you've selected, or how to implement a new feature.
        </div>`;

    // 3. Load chat history on startup
    loadChatHistory();

    function loadChatHistory() {
        const history = localStorage.getItem(CHAT_STORAGE_KEY);
        if (history) {
            try {
                // Ensure history is parsed, then inserted as innerHTML
                chatHistory.innerHTML = JSON.parse(history);
            } catch {
                chatHistory.innerHTML = initialWelcomeMessage;
            }
        } else {
            chatHistory.innerHTML = initialWelcomeMessage; 
        }
    }
    
    function saveChatHistory() {
        // 3. Save chat history to local storage
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatHistory.innerHTML));
    }

    // Utility to post a message to the extension host (extension.ts)
    const postMessage = (command, payload = {}) => {
        vscode.postMessage({ command, ...payload });
    };

    // --- F1: New Chat Session ---
    newChatButton.addEventListener('click', () => {
        postMessage('newChat');
    });

    // R6: Key Management Toggle
    keyManagementToggle.addEventListener('click', () => {
        const isHidden = keyManagementPanel.style.display === 'none' || !keyManagementPanel.style.display;
        if (isHidden) {
            // Request fresh list whenever the panel is opened
            postMessage('requestKeyManagementDetails');
        }
        keyManagementPanel.style.display = isHidden ? 'flex' : 'none';
        
        // Hide palette if active
        togglePalette(false);
    });
    
    // R6: Key Save Handler
    keySaveButton.addEventListener('click', () => {
        const name = keyNameInput.value;
        const key = keyValueInput.value;
        
        if (name && key) {
            postMessage('saveNewApiKey', { name, key });
            // Clear value field for security, keep name for easy editing
            keyValueInput.value = '';
        } else {
            // Use the status bar for feedback instead of alert in final implementation
            vscode.postMessage({ command: 'error', content: "API Key Name and Key value must not be empty." });
        }
    });
    
    // R6: Key List Actions (Select/Delete)
    keyList.addEventListener('click', (e) => {
        const target = e.target;
        // Traverse up to find the nearest key item
        const keyItem = target.closest('.key-item'); 
        const name = keyItem?.getAttribute('data-name');
        
        if (!name) return;
        
        if (target.classList.contains('key-select-button')) {
             postMessage('selectApiKey', { name });
        } else if (target.classList.contains('key-delete-button')) {
            postMessage('requestDeleteConfirmation', { name });
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


    // R2 & R3: Enhanced formatting for Code Responses (Handling FIND/REPLACE blocks)
    function formatResponse(responseText) {
        // Regex for FIND/REPLACE blocks. Assumes structure: --- FIND --- ```lang...``` --- REPLACE --- ```lang...```
        const findReplaceRegex = /---\s*FIND\s*---\s*```(?:\w+)?\n([\s\S]*?)\n```\s*---\s*REPLACE\s*---\s*```(?:\w+)?\n([\s\S]*?)\n```/gi;
        
        // Regex for standard standalone markdown blocks
        const standardCodeRegex = /```(?:\w+)?\n([\s\S]*?)\n```/g;
        
        let formattedHtml = '';
        let lastIndex = 0;
        let codeFound = false;
        
        const responseSegments = [];
        
        // 1. Extract and process FIND/REPLACE blocks first
        let match;
        while ((match = findReplaceRegex.exec(responseText)) !== null) {
            // Push text content before this block
            if (match.index > lastIndex) {
                responseSegments.push({ type: 'text', content: responseText.substring(lastIndex, match.index) });
            }
            
            const findContent = match[1].trim();
            const replaceContent = match[2].trim();
            
            responseSegments.push({ type: 'findReplace', find: findContent, replace: replaceContent });
            lastIndex = match.index + match[0].length;
        }
        
        // Push remaining text content
        if (lastIndex < responseText.length) {
            responseSegments.push({ type: 'text', content: responseText.substring(lastIndex) });
        }
        
        // 2. Process segments and render
        for (const segment of responseSegments) {
            if (segment.type === 'findReplace') {
                codeFound = true;
                formattedHtml += `
                    <div class="code-diff-block">
                        <div class="diff-header code-header">
                            <span>--- FIND ---</span>
                            <button class="copy-button" data-code="${escapeHtml(segment.find)}" title="Copy FIND block">Copy</button>
                        </div>
                        <div class="find-block">
                            <pre>${escapeHtml(segment.find)}</pre>
                        </div>
                        <div class="diff-header code-header">
                            <span>--- REPLACE ---</span>
                            <button class="copy-button" data-code="${escapeHtml(segment.replace)}" title="Copy REPLACE block">Copy</button>
                        </div>
                        <div class="replace-block">
                            <pre>${escapeHtml(segment.replace)}</pre>
                            <div class="code-actions">
                                <button class="action-replace" data-code="${escapeHtml(segment.replace)}">Apply Replacement</button>
                            </div>
                        </div>
                    </div>
                `;
            } else if (segment.type === 'text') {
                let text = segment.content;
                let standardMatch;
                let textLastIndex = 0;
                
                // 3. Look for standard code blocks within the remaining text segments
                while ((standardMatch = standardCodeRegex.exec(text)) !== null) {
                    codeFound = true;
                    const textBefore = text.substring(textLastIndex, standardMatch.index).trim();
                    const codeContent = standardMatch[1];
                    
                    if (textBefore) {
                         formattedHtml += `<p>${textBefore}</p>`;
                    }
                    
                    formattedHtml += `
                        <div class="code-block">
                            <div class="code-header standard-header">
                                <button class="copy-button" data-code="${escapeHtml(codeContent)}" title="Copy code block">Copy</button>
                            </div>
                            <pre>${escapeHtml(codeContent)}</pre>
                            <div class="code-actions">
                                <button class="action-insert" data-code="${escapeHtml(codeContent)}">Insert at Cursor</button>
                                <button class="action-replace" data-code="${escapeHtml(codeContent)}">Replace Selection</button>
                            </div>
                        </div>
                    `;
                    textLastIndex = standardMatch.index + standardMatch[0].length;
                }
                
                const textAfter = text.substring(textLastIndex).trim();
                if (textAfter) {
                    formattedHtml += `<p>${textAfter}</p>`;
                }
            }
        }
        
        if (!codeFound && responseText.trim()) {
            // Handle plain text response if no blocks were found
            formattedHtml = `<p>${responseText.trim()}</p>`;
        }
        
        return formattedHtml;
    }
    
    function updateContextFileList(files) {
        // Refactoring Change #7: Optimized List Rendering
        const fragment = document.createDocumentFragment();
        
        if (files.length > 0) {
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
        }
    }
    
    // R6: New function to handle key list rendering
    function updateKeyManagementDetails(keys, activeName) {
        keyList.innerHTML = ''; // Clear existing
        
        if (keys.length === 0) {
            const listItem = document.createElement('li');
            listItem.textContent = 'No keys stored.';
            listItem.classList.add('key-item');
            keyList.appendChild(listItem);
            return;
        }

        keys.forEach(key => {
            const listItem = document.createElement('li');
            listItem.classList.add('key-item');
            if (key.isActive) {
                listItem.classList.add('active');
            }
            listItem.setAttribute('data-name', key.name);
            
            listItem.innerHTML = `
                <span class="key-name" title="${key.name}">${key.name}</span>
                <div class="key-actions">
                    ${!key.isActive ? `<button class="key-select-button">Set Active</button>` : `<span class="active-badge">Active</span>`}
                    <button class="key-delete-button" title="Delete Key">&times;</button>
                </div>
            `;
            keyList.appendChild(listItem);
        });
        
        // Update key status indicator text based on active key availability
        keyManagementToggle.title = activeName ? `Manage API Keys (Active: ${activeName})` : `Manage API Keys (No Active Key)`;
        
        // Pre-fill name field if we are editing (though actual editing requires key input)
        keyNameInput.value = '';
    }
    
    // 1. Update the active file indicator display
    function updateActiveFileIndicator(activeFile) {
        if (activeFile) {
            activeFileIndicator.textContent = `Active: ${activeFile}`;
            activeFileIndicator.style.display = 'inline-block';
        } else {
            activeFileIndicator.style.display = 'none';
        }
    }

    function attachCopyListeners() {
        document.querySelectorAll('.copy-button').forEach(button => {
            button.onclick = (e) => {
                const code = e.currentTarget.getAttribute('data-code');
                if (code) {
                    navigator.clipboard.writeText(code).then(() => {
                        const originalText = button.innerHTML;
                        button.innerHTML = 'Copied!';
                        // Reset text after 2 seconds
                        setTimeout(() => {
                            button.innerHTML = originalText;
                        }, 2000);
                    }).catch(err => {
                        console.error('Failed to copy text: ', err);
                        button.innerHTML = 'Error';
                    });
                }
            };
        });
    }

    // R3: Attach listeners for code action buttons (standard blocks)
    function attachCodeActionListeners() {
        attachCopyListeners(); // Attach copy listeners whenever code actions are attached

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
            // 3. Save state after response
            saveChatHistory();
        }

        switch (message.command) {
            case 'updateStatus': 
                // 1. Update Active File Indicator
                updateActiveFileIndicator(message.activeFile);
                
                // 4. Handle Key Status
                if (message.keyStatus) {
                    keyStatusIndicator.classList.add('active');
                    keyStatusIndicator.title = `API Key Status: Active (${message.activeKeyName || 'Default'})`;
                    contextHeader.classList.remove('key-missing'); 
                } else {
                    keyStatusIndicator.classList.remove('active');
                    keyStatusIndicator.title = 'API Key Status: Missing/Invalid. Click manage button to configure.';
                    contextHeader.classList.add('key-missing'); 
                }
                updateContextFileList(message.contextFiles || []);
                break;
            
            case 'keyManagementDetails': // R6: Handle key list update
                updateKeyManagementDetails(message.keys, message.activeName);
                break;
            
            case 'newChatConfirm':
                chatHistory.innerHTML = initialWelcomeMessage;
                // 3. Clear chat history from storage
                localStorage.removeItem(CHAT_STORAGE_KEY);
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
        // Handle custom styling for API key success notification
        if (type === 'success') {
             messageDiv.classList.add('message', 'system');
             messageDiv.classList.add('success');
        } else {
            messageDiv.classList.add('message', type);
        }

        if (isText) {
            messageDiv.textContent = content;
        } else {
            messageDiv.innerHTML = content;
        }
        
        chatHistory.appendChild(messageDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;

        // 3. Save chat history immediately after appending a user/assistant message
        if (type === 'user' || type === 'assistant') {
             saveChatHistory();
        }
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