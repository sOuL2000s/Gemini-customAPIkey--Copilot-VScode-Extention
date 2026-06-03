// src/webview/main.js
// This script runs in the webview context.
// src/webview/main.js
// This script runs in the webview context.
const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    const chatHistory = document.getElementById('chat-history');
    const promptInput = document.getElementById('prompt-input');
    const sendButton = document.getElementById('send-button');
    let isGenerating = false; 
    const newChatButton = document.getElementById('new-chat-button');
    const keyStatusIndicator = document.getElementById('key-status-indicator');
    
    // Key Management Elements (R6)
    const keyManagementToggle = document.getElementById('key-management-toggle');
    const keyManagementPanel = document.getElementById('key-management-panel');
    const keyNameInput = document.getElementById('key-name-input');
    const keyValueInput = document.getElementById('key-value-input');
    const keySaveButton = document.getElementById('key-save-button');
    const keyList = document.getElementById('key-list');

    // NEW Settings Elements
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsPanel = document.getElementById('settings-panel');
    const chatModelSelect = document.getElementById('chat-model-select');
    const inlineModelSelect = document.getElementById('inline-model-select');
    const debounceInput = document.getElementById('debounce-input');
    
    // UI ELEMENTS FOR F3
    const contextHeader = document.getElementById('context-header');
    const contextFileList = document.getElementById('context-file-list');
    // 1. New active file indicator element
    const activeFileIndicator = document.getElementById('active-file-indicator'); 
    const addContextFileButton = document.getElementById('add-context-file-button');
    const autoContextButton = document.getElementById('auto-context-button');
    
    // R4: Command Palette Elements
    const commandPalette = document.getElementById('command-palette');
    const paletteInput = document.getElementById('palette-input');

    const initialWelcomeMessage = `
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
        </div>`;

    function saveChatHistory() {
        // Post the history to the extension host for persistence
        postMessage('saveChatHistory', { history: chatHistory.innerHTML });
    }

    // Utility to post a message to the extension host (extension.ts)
    const postMessage = (command, payload = {}) => {
        vscode.postMessage({ command, ...payload });
    };

    // --- F1: New Chat Session ---
    newChatButton.addEventListener('click', () => {
        postMessage('newChat');
    });

    const updateToggleStates = () => {
        const keyVisible = keyManagementPanel.style.display === 'flex';
        const settingsVisible = settingsPanel.style.display === 'flex';
        
        keyManagementToggle.classList.toggle('active', keyVisible);
        keyManagementToggle.setAttribute('aria-expanded', keyVisible);
        
        settingsToggle.classList.toggle('active', settingsVisible);
        settingsToggle.setAttribute('aria-expanded', settingsVisible);
    };

    // R6: Key Management Toggle
    keyManagementToggle.addEventListener('click', () => {
        const isCurrentlyVisible = keyManagementPanel.style.display === 'flex';
        settingsPanel.style.display = 'none';
        
        if (!isCurrentlyVisible) {
            postMessage('requestKeyManagementDetails');
            keyManagementPanel.style.display = 'flex';
            // Accessibility: Focus first interactive element in panel
            setTimeout(() => keyManagementPanel.querySelector('button, input').focus(), 50);
        } else {
            keyManagementPanel.style.display = 'none';
        }
        updateToggleStates();
        togglePalette(false);
    });

    // NEW: Settings Toggle
    settingsToggle.addEventListener('click', () => {
        const isCurrentlyVisible = settingsPanel.style.display === 'flex';
        keyManagementPanel.style.display = 'none';

        if (!isCurrentlyVisible) {
            postMessage('requestSettingsDetails');
            settingsPanel.style.display = 'flex';
            // Accessibility: Focus first interactive element in panel
            setTimeout(() => settingsPanel.querySelector('button, select').focus(), 50);
        } else {
            settingsPanel.style.display = 'none';
        }
        updateToggleStates();
        togglePalette(false);
    });

    // Panel Keyboard Navigation
    [keyManagementPanel, settingsPanel].forEach(panel => {
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                panel.style.display = 'none';
                updateToggleStates();
                // Return focus to the toggle that opened it
                if (panel === keyManagementPanel) keyManagementToggle.focus();
                else settingsToggle.focus();
            }
        });
    });

    // Handle close buttons inside panels
    document.querySelectorAll('.panel-close-button').forEach(btn => {
        btn.addEventListener('click', () => {
            keyManagementPanel.style.display = 'none';
            settingsPanel.style.display = 'none';
            updateToggleStates();
        });
    });
    
    // NEW: Settings Change Listeners
    chatModelSelect.addEventListener('change', (e) => {
        postMessage('setChatModel', { value: e.target.value });
    });
    inlineModelSelect.addEventListener('change', (e) => {
        postMessage('setInlineModel', { value: e.target.value });
    });
    debounceInput.addEventListener('change', (e) => {
        postMessage('setDebounceDelay', { value: e.target.value });
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

    autoContextButton.addEventListener('click', () => {
        postMessage('autoAddContext');
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


    // R4: Command Palette Toggle Logic (Shortcut corresponds to package.json: Ctrl+Alt+H)
    const togglePalette = (show) => {
        if (show) {
            commandPalette.style.display = 'flex';
            paletteInput.focus();
        } else {
            commandPalette.style.display = 'none';
        }
    };

    // Simulate keyboard shortcut Ctrl+Alt+H (or Cmd+Alt+H) to invoke the palette
    document.addEventListener('keydown', (e) => {
        // Check for Ctrl/Cmd + Alt + H
        if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'h') {
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
            
            // CRITICAL FIX: Do NOT trim findContent and replaceContent.
            // This ensures all whitespace, including leading/trailing newlines and indentation,
            // is preserved for exact matching in the editor.
            const findContent = match[1];
            const replaceContent = match[2];
            
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
                                <button class="action-global-search" 
                                        data-find="${escapeHtml(segment.find)}" 
                                        data-replace="${escapeHtml(segment.replace)}">
                                    Send to Global Search
                                </button>
                                <button class="action-apply-to-active" 
                                        data-find="${escapeHtml(segment.find)}" 
                                        data-replace="${escapeHtml(segment.replace)}" 
                                        title="Search and replace in active editor">
                                    Apply to Active File
                                </button>
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
            listItem.setAttribute('role', 'option');
            listItem.setAttribute('aria-selected', key.isActive);

            if (key.isActive) {
                listItem.classList.add('active');
            }
            listItem.setAttribute('data-name', key.name);
            
            listItem.innerHTML = `
                <span class="key-name" title="${key.name}">${key.name}</span>
                <div class="key-actions">
                    ${!key.isActive ? `<button class="key-select-button" aria-label="Set ${key.name} as active">Set Active</button>` : `<span class="active-badge" aria-label="Currently Active">Active</span>`}
                    <button class="key-delete-button" title="Delete Key" aria-label="Delete API Key ${key.name}">&times;</button>
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

        document.querySelectorAll('.action-global-search').forEach(button => {
            button.onclick = (e) => {
                const findText = e.currentTarget.getAttribute('data-find');
                const replaceText = e.currentTarget.getAttribute('data-replace');
                vscode.postMessage({ 
                    command: 'sendToGlobalSearch', 
                    find: findText, 
                    replace: replaceText 
                });
            };
        });

        // NEW: Listener for "Apply to Active File" button
        document.querySelectorAll('.action-apply-to-active').forEach(button => {
            button.onclick = (e) => {
                const findText = e.currentTarget.getAttribute('data-find');
                const replaceText = e.currentTarget.getAttribute('data-replace');
                if (findText !== null && replaceText !== null) { // Ensure they are not null
                    vscode.postMessage({ 
                        command: 'applyFindReplace', 
                        find: findText, 
                        replace: replaceText 
                    });
                } else {
                    vscode.postMessage({ command: 'error', content: 'Missing find or replace content for action.' });
                }
            };
        });

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
    


    const setGeneratingState = (generating) => {
        isGenerating = generating;
        if (generating) {
            sendButton.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                </svg>
            `;
            sendButton.title = "Stop Generation";
            sendButton.classList.add('stop-button');
            promptInput.disabled = true;
            sendButton.disabled = false;
        } else {
            sendButton.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
            `;
            sendButton.title = "Send Prompt (Arrow Icon)";
            sendButton.classList.remove('stop-button');
            promptInput.disabled = false;
            sendButton.disabled = false;
            promptInput.focus();
        }
    };

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
            setGeneratingState(false);
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

                // Load Chat History if provided and current view is just initialized
                if (message.chatHistory && chatHistory.children.length <= 1 && chatHistory.querySelector('.message.system')) {
                    chatHistory.innerHTML = message.chatHistory;
                    attachCodeActionListeners(); // Re-attach listeners to restored buttons
                } else if (!chatHistory.innerHTML.trim()) {
                     chatHistory.innerHTML = initialWelcomeMessage;
                }
                
                // NEW: Update Settings UI if config data is present
                if (message.config) {
                    chatModelSelect.value = message.config.chatModel;
                    inlineModelSelect.value = message.config.inlineModel;
                    debounceInput.value = message.config.debounceMs;
                }
                break;
            
            case 'keyManagementDetails': // R6: Handle key list update
                updateKeyManagementDetails(message.keys, message.activeName);
                break;
            
            case 'newChatConfirm':
                chatHistory.innerHTML = initialWelcomeMessage;
                break;
            
            case 'openPalette':
                togglePalette(true);
                break;
                
            case 'loading':
                setGeneratingState(true);
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
        promptInput.style.height = '28px';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 250) + 'px';
    });
    
    // Initial auto-resize setup and listener
    promptInput.addEventListener('input', () => {
        promptInput.style.height = '28px';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 250) + 'px';
        // Check for quick trigger: #/@ followed by optional whitespace
        const value = promptInput.value.trim();
        if (value.startsWith('#/@')) {
            // Clear input and trigger file selection
            promptInput.value = '';
            postMessage('addFileContext');
            
            // Send feedback to user
            appendMessage('loading', 'Opening file selection dialog...');
            
            // Stop processing the input event further
            return;
        }
        
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
        if (isGenerating) {
            postMessage('stopGeneration');
            setGeneratingState(false);
            return;
        }

        const prompt = promptInput.value.trim();
        if (!prompt) return;

        appendMessage('user', prompt);
        
        // Reset height and disable input while request is pending
        promptInput.value = '';
        promptInput.style.height = 'auto';
        promptInput.disabled = true;
        
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
