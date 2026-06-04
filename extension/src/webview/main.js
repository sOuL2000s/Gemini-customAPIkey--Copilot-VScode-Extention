// src/webview/main.js
// This script runs in the webview context.
const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    // --- UI Element References ---
    const ui = {
        chatHistory: document.getElementById('chat-history'),
        promptInput: document.getElementById('prompt-input'),
        sendButton: document.getElementById('send-button'),
        newChatButton: document.getElementById('new-chat-button'),
        keyStatusIndicator: document.getElementById('key-status-indicator'),
        contextHeader: document.getElementById('context-header'),
        contextFileList: document.getElementById('context-file-list'),
        activeFileIndicator: document.getElementById('active-file-indicator'),
        addContextFileButton: document.getElementById('add-context-file-button'),
        autoContextButton: document.getElementById('auto-context-button'),
        
        keyManagement: {
            toggle: document.getElementById('key-management-toggle'),
            panel: document.getElementById('key-management-panel'),
            nameInput: document.getElementById('key-name-input'),
            valueInput: document.getElementById('key-value-input'),
            saveButton: document.getElementById('key-save-button'),
            list: document.getElementById('key-list')
        },
        settings: {
            toggle: document.getElementById('settings-toggle'),
            panel: document.getElementById('settings-panel'),
            chatModelSelect: document.getElementById('chat-model-select'),
            inlineModelSelect: document.getElementById('inline-model-select'),
            debounceInput: document.getElementById('debounce-input')
        },
        palette: {
            container: document.getElementById('command-palette'),
            input: document.getElementById('palette-input')
        }
    };

    // --- State Management ---
    let state = {
        isGenerating: false,
        lastUserPrompt: '', // Store for retry functionality
        activePanel: null, // 'keyManagement', 'settings', or null
        paletteVisible: false,
        keyStatus: {
            active: false,
            activeName: null
        },
        context: {
            files: [],
            activeFileName: null
        },
        config: {
            chatModel: 'gemini-2.5-flash',
            inlineModel: 'gemini-2.5-flash-lite',
            debounceMs: 500
        },
        keyDetails: {
            keys: [],
            activeName: ''
        }
    };

    function updateState(newState) {
        state = { ...state, ...newState };
        render();
    }

    function render() {
        // 1. Panels and Toggles
        ui.keyManagement.panel.style.display = state.activePanel === 'keyManagement' ? 'flex' : 'none';
        ui.settings.panel.style.display = state.activePanel === 'settings' ? 'flex' : 'none';
        
        ui.keyManagement.toggle.classList.toggle('active', state.activePanel === 'keyManagement');
        ui.keyManagement.toggle.setAttribute('aria-expanded', state.activePanel === 'keyManagement');
        ui.settings.toggle.classList.toggle('active', state.activePanel === 'settings');
        ui.settings.toggle.setAttribute('aria-expanded', state.activePanel === 'settings');

        // 2. Palette
        ui.palette.container.style.display = state.paletteVisible ? 'flex' : 'none';

        // 3. API Key Status
        if (state.keyStatus.active) {
            ui.keyStatusIndicator.classList.add('active');
            ui.keyStatusIndicator.title = `API Key Status: Active (${state.keyStatus.activeName || 'Default'})`;
            ui.contextHeader.classList.remove('key-missing');
        } else {
            ui.keyStatusIndicator.classList.remove('active');
            ui.keyStatusIndicator.title = 'API Key Status: Missing/Invalid. Click manage button to configure.';
            ui.contextHeader.classList.add('key-missing');
        }

        // 4. Generating State
        ui.promptInput.disabled = state.isGenerating;
        ui.sendButton.disabled = false; // Always enabled for stop
        if (state.isGenerating) {
            ui.sendButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
            ui.sendButton.title = "Stop Generation";
            ui.sendButton.classList.add('stop-button');
        } else {
            ui.sendButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
            ui.sendButton.title = "Send Prompt (Arrow Icon)";
            ui.sendButton.classList.remove('stop-button');
        }

        // 5. Context Files
        renderContextFileList();
        
        // 6. Active File
        if (state.context.activeFileName) {
            ui.activeFileIndicator.textContent = `Active: ${state.context.activeFileName}`;
            ui.activeFileIndicator.style.display = 'inline-block';
        } else {
            ui.activeFileIndicator.style.display = 'none';
        }

        // 7. Config UI
        ui.settings.chatModelSelect.value = state.config.chatModel;
        ui.settings.inlineModelSelect.value = state.config.inlineModel;
        ui.settings.debounceInput.value = state.config.debounceMs;

        // 8. Key List (R6)
        renderKeyList();
    }

    function renderContextFileList() {
        const fragment = document.createDocumentFragment();
        state.context.files.forEach(uriPath => {
            const fileName = uriPath.split(/[\/\\]/).pop();
            const listItem = document.createElement('li');
            listItem.className = 'context-file-tag';
            listItem.innerHTML = `
                <span title="${uriPath}">${fileName}</span>
                <button class="remove-context-file" data-uri="${uriPath}" title="Remove Context File">&times;</button>
            `;
            fragment.appendChild(listItem);
        });
        ui.contextFileList.innerHTML = '';
        ui.contextFileList.appendChild(fragment);
    }

    function renderKeyList() {
        ui.keyManagement.list.innerHTML = '';
        if (state.keyDetails.keys.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'No keys stored.';
            li.classList.add('key-item');
            ui.keyManagement.list.appendChild(li);
        } else {
            state.keyDetails.keys.forEach(key => {
                const li = document.createElement('li');
                li.classList.add('key-item');
                if (key.isActive) li.classList.add('active');
                li.setAttribute('data-name', key.name);
                li.innerHTML = `
                    <span class="key-name" title="${key.name}">${key.name}</span>
                    <div class="key-actions">
                        ${!key.isActive ? `<button class="key-select-button">Set Active</button>` : `<span class="active-badge">Active</span>`}
                        <button class="key-delete-button">&times;</button>
                    </div>
                `;
                ui.keyManagement.list.appendChild(li);
            });
        }
    }

    // --- Helpers ---
    const initialWelcomeMessage = `
        <div class="message system">
            <p>Hello! I am Gemini, your expert coding assistant.</p>
            <p>Here are my key functionalities:</p>
            <ul>
                <li><b>Inline Code Completion:</b> Real-time suggestions. Adjust model and latency in Settings.</li>
                <li><b>Code Chat:</b> Ask questions or refactor code. Selection is used as context.</li>
                <li><b>Context Management:</b> Add specific files or use auto-detection for project dependencies.</li>
                <li><b>Command Palette (Ctrl+Alt+H):</b> Access structured commands like <code>/refactor</code> or <code>/test</code>.</li>
                <li><b>Action Blocks:</b> AI-suggested changes come in structured diff blocks.
                    <ul>
                        <li><b>Apply to Active File:</b> Automatically replaces the code in your current file.</li>
                        <li><b>Send to Global Search:</b> Populates the VS Code global search/replace tool. Recommended for workspace-wide review.</li>
                    </ul>
                </li>
            </ul>
        </div>`;

    function saveChatHistory() {
        postMessage('saveChatHistory', { history: ui.chatHistory.innerHTML });
    }

    const postMessage = (command, payload = {}) => {
        vscode.postMessage({ command, ...payload });
    };

    // --- Event Listeners ---
    ui.newChatButton.addEventListener('click', () => postMessage('requestNewChatConfirmation'));

    ui.keyManagement.toggle.addEventListener('click', () => {
        const next = state.activePanel === 'keyManagement' ? null : 'keyManagement';
        if (next) postMessage('requestKeyManagementDetails');
        updateState({ activePanel: next, paletteVisible: false });
        if (next) setTimeout(() => ui.keyManagement.panel.querySelector('button, input').focus(), 50);
    });

    ui.settings.toggle.addEventListener('click', () => {
        const next = state.activePanel === 'settings' ? null : 'settings';
        if (next) postMessage('requestSettingsDetails');
        updateState({ activePanel: next, paletteVisible: false });
        if (next) setTimeout(() => ui.settings.panel.querySelector('button, select').focus(), 50);
    });

    [ui.keyManagement.panel, ui.settings.panel].forEach(panel => {
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                updateState({ activePanel: null });
                if (panel === ui.keyManagement.panel) ui.keyManagement.toggle.focus();
                else ui.settings.toggle.focus();
            }
        });
    });

    document.querySelectorAll('.panel-close-button').forEach(btn => {
        btn.addEventListener('click', () => updateState({ activePanel: null }));
    });

    ui.settings.chatModelSelect.addEventListener('change', (e) => postMessage('setChatModel', { value: e.target.value }));
    ui.settings.inlineModelSelect.addEventListener('change', (e) => postMessage('setInlineModel', { value: e.target.value }));
    ui.settings.debounceInput.addEventListener('change', (e) => postMessage('setDebounceDelay', { value: e.target.value }));

    ui.keyManagement.saveButton.addEventListener('click', () => {
        const name = ui.keyManagement.nameInput.value;
        const key = ui.keyManagement.valueInput.value;
        if (name && key) {
            postMessage('saveNewApiKey', { name, key });
            ui.keyManagement.valueInput.value = '';
        }
    });

    ui.keyManagement.list.addEventListener('click', (e) => {
        const name = e.target.closest('.key-item')?.getAttribute('data-name');
        if (!name) return;
        if (e.target.classList.contains('key-select-button')) postMessage('selectApiKey', { name });
        else if (e.target.classList.contains('key-delete-button')) postMessage('requestDeleteConfirmation', { name });
    });

    ui.addContextFileButton.addEventListener('click', () => postMessage('addFileContext'));
    ui.autoContextButton.addEventListener('click', () => postMessage('autoAddContext'));
    ui.contextFileList.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-context-file')) {
            postMessage('removeFileContext', { uri: e.target.getAttribute('data-uri') });
        }
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'h') {
            e.preventDefault();
            updateState({ paletteVisible: !state.paletteVisible });
            if (state.paletteVisible) ui.palette.input.focus();
        } else if (e.key === 'Escape' && state.paletteVisible) {
            updateState({ paletteVisible: false });
        }
    });

    ui.palette.input.addEventListener('input', () => {
        const filter = ui.palette.input.value.toLowerCase();
        document.querySelectorAll('#palette-results .palette-item').forEach(item => {
            item.style.display = item.textContent.toLowerCase().includes(filter) ? 'flex' : 'none';
        });
    });

    ui.palette.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = ui.palette.input.value.trim();
            if (text) {
                postMessage('submitPrompt', { text });
                ui.palette.input.value = '';
                updateState({ paletteVisible: false });
                appendMessage('loading', 'Executing command...');
            }
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

        const loadingMessage = ui.chatHistory.querySelector('.message.loading');
        if (loadingMessage) loadingMessage.remove();
        
        if (message.command === 'response' || message.command === 'error') {
            updateState({ isGenerating: false });
            saveChatHistory();
        }

        switch (message.command) {
            case 'updateStatus': 
                updateState({
                    keyStatus: { active: message.keyStatus, activeName: message.activeKeyName },
                    context: { files: message.contextFiles || [], activeFileName: message.activeFile },
                    config: message.config || state.config
                });

                if (message.chatHistory && ui.chatHistory.children.length <= 1 && ui.chatHistory.querySelector('.message.system')) {
                    ui.chatHistory.innerHTML = message.chatHistory;
                    attachCodeActionListeners();
                } else if (!ui.chatHistory.innerHTML.trim()) {
                     ui.chatHistory.innerHTML = initialWelcomeMessage;
                }
                break;
            
            case 'keyManagementDetails':
                updateState({ keyDetails: { keys: message.keys, activeName: message.activeName } });
                break;
            
            case 'newChatConfirm':
                ui.chatHistory.innerHTML = initialWelcomeMessage;
                break;
            
            case 'openPalette':
                updateState({ paletteVisible: true });
                ui.palette.input.focus();
                break;
                
            case 'loading':
                updateState({ isGenerating: true });
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
        ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight;
        
        ui.promptInput.style.height = '28px';
        ui.promptInput.style.height = Math.min(ui.promptInput.scrollHeight, 250) + 'px';
    });
    
    // Initial auto-resize setup and listener
    ui.promptInput.addEventListener('input', () => {
        ui.promptInput.style.height = '28px';
        ui.promptInput.style.height = Math.min(ui.promptInput.scrollHeight, 250) + 'px';
        if (ui.promptInput.value.trim().startsWith('#/@')) {
            ui.promptInput.value = '';
            postMessage('addFileContext');
            appendMessage('loading', 'Opening file selection dialog...');
            return;
        }
    });

    ui.sendButton.addEventListener('click', () => sendMessage());
    ui.promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    function sendMessage(retryPrompt = null) {
        const isRetry = retryPrompt !== null;
        if (state.isGenerating) {
            postMessage('stopGeneration');
            updateState({ isGenerating: false });
            return;
        }
        const prompt = isRetry ? retryPrompt : ui.promptInput.value.trim();
        if (!prompt) return;

        if (!isRetry) {
            appendMessage('user', prompt);
            ui.promptInput.value = '';
            ui.promptInput.style.height = 'auto';
        }
        
        updateState({ isGenerating: true, paletteVisible: false, lastUserPrompt: prompt });
        postMessage('submitPrompt', { text: prompt });
    }
    

    // DOM Manipulation Helpers
    function appendMessage(type, content, isText = true) {
        const div = document.createElement('div');
        div.classList.add('message', type);
        if (type === 'success') div.classList.add('system', 'success');

        if (type === 'error' && state.lastUserPrompt) {
            div.innerHTML = `
                <div class="error-content">${isText ? escapeHtml(content) : content}</div>
                <button class="retry-button">Retry Last Prompt</button>
            `;
            const retryBtn = div.querySelector('.retry-button');
            retryBtn.onclick = () => {
                div.remove(); // Clear the error message
                sendMessage(state.lastUserPrompt);
            };
        } else {
            if (isText) div.textContent = content;
            else div.innerHTML = content;
        }
        
        ui.chatHistory.appendChild(div);
        ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight;

        if (type === 'user' || type === 'assistant') saveChatHistory();
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
