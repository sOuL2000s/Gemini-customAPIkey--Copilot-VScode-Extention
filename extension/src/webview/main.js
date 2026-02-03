// src/webview/main.js
// This script runs in the webview context.
const vscode = acquireVsCodeApi();
const CHAT_STORAGE_KEY = 'geminiCoderChatHistory';
let chatMessages = []; // Stores { type: string, content: string, isText: boolean }

document.addEventListener('DOMContentLoaded', () => {
    const chatHistory = document.getElementById('chat-history');
    const promptInput = document.getElementById('prompt-input');
    const sendButton = document.getElementById('send-button');
    const newChatButton = document.getElementById('new-chat-button'); // Added back
    const menuButton = document.getElementById('menu-button');
    const keyStatusIndicator = document.getElementById('key-status-indicator');
    const configPanel = document.getElementById('config-panel');
    const profileNameInput = document.getElementById('profile-name-input'); // NEW
    const apiKeyInput = document.getElementById('api-key-input');
    const saveKeyButton = document.getElementById('save-key-button');
    
    // UI ELEMENTS FOR F3
    const contextHeader = document.getElementById('context-header');
    const contextFileList = document.getElementById('context-file-list');
    const contextPlaceholder = document.getElementById('context-placeholder');
    const addContextFileButton = document.getElementById('add-context-file-button');
    
    // Profile Elements
    const profileSelector = document.getElementById('profile-selector'); // NEW
    const editProfilesButton = document.getElementById('edit-profiles-button'); // NEW

    // NEW: Options Menu Elements
    const optionsMenu = document.getElementById('options-menu');
    const menuEditKeys = document.getElementById('menu-edit-keys');
    const menuOpenProfilesSettings = document.getElementById('menu-open-profiles-settings');
    const menuLatencySettings = document.getElementById('menu-latency-settings');

    // R4: Command Palette Elements    const commandPalette = document.getElementById('command-palette');
    const paletteInput = document.getElementById('palette-input');

    const initialWelcomeMessageContent = "Hello! I am Gemini. Ask me about the code you've selected, or how to implement a new feature.";

    // Utility to post a message to the extension host (extension.ts)
    const postMessage = (command, payload = {}) => {
        vscode.postMessage({ command, ...payload });
    };

    // --- Persistence and Rendering Helpers ---

    // Utility to create the actual DOM element 
    function createMessageElement(type, content, isText) {
        const messageDiv = document.createElement('div');
        if (type === 'success') {
             messageDiv.classList.add('message', 'system', 'success');
        } else {
            messageDiv.classList.add('message', type);
        }
        if (isText) {
            messageDiv.textContent = content;
        } else {
            messageDiv.innerHTML = content;
        }
        return messageDiv;
    }

    // Renders the full history from chatMessages array
    function renderChatHistory() {
        chatHistory.innerHTML = '';
        
        chatMessages.forEach(msg => {
            if (msg.type !== 'loading') { // Don't render stale loading messages
                const messageDiv = createMessageElement(msg.type, msg.content, msg.isText);
                chatHistory.appendChild(messageDiv);
            }
        });
        
        chatHistory.scrollTop = chatHistory.scrollHeight;
        attachCodeActionListeners(); // Re-attach listeners after rendering
    }
    
    function saveChatHistory() {
        try {
            // Only save user, assistant, system, success messages. Skip transient ones.
            const historyToSave = chatMessages.filter(m => 
                m.type !== 'loading' && m.type !== 'error'
            );
            localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(historyToSave));
        } catch (e) {
            console.error("Failed to save chat history to local storage:", e);
        }
    }

    function loadChatHistory() {
        try {
            const storedHistory = localStorage.getItem(CHAT_STORAGE_KEY);
            if (storedHistory) {
                const loadedMessages = JSON.parse(storedHistory);
                if (Array.isArray(loadedMessages) && loadedMessages.length > 0) {
                    chatMessages = loadedMessages;
                }
            }
        } catch (e) {
            console.warn("Failed to load chat history from local storage. Starting fresh.", e);
        }
        
        // If chatMessages is empty after loading, inject the welcome message
        if (chatMessages.length === 0) {
            chatMessages.push({ type: 'system', content: initialWelcomeMessageContent, isText: true });
        }
        renderChatHistory();
    }
    
    /**
     * Updates the profile dropdown selector (used primarily for internal tracking and config panel).
     * @param {string[]} availableProfiles Array of profile names.
     * @param {string} activeProfile The currently active profile name.
     */
    function updateProfileSelector(availableProfiles, activeProfile) {
        // profileSelector is now hidden, but required by config-panel logic
        profileSelector.innerHTML = ''; 
        
        const names = Array.isArray(availableProfiles) ? availableProfiles : [];

        if (names.length === 0 || !names.includes(activeProfile)) {
            names.push(activeProfile);
        }
        
        const uniqueNames = [...new Set(names)].sort();

        uniqueNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === activeProfile) {
                option.selected = true;
            }
            profileSelector.appendChild(option);
        });
    }

    // Initialize history on load
    loadChatHistory();

    // --- F1: New Chat Session ---
    newChatButton.addEventListener('click', () => {
        // Clear internal state and storage
        chatMessages = [{ type: 'system', content: initialWelcomeMessageContent, isText: true }];
        localStorage.removeItem(CHAT_STORAGE_KEY);
        renderChatHistory(); 
        
        postMessage('newChat'); // Send message to extension to reset file context
    });
    
    // --- F3: Options Menu Logic ---
    menuButton.addEventListener('click', (e) => {
        optionsMenu.classList.toggle('hidden');
        if (!optionsMenu.classList.contains('hidden')) {
            // Position the menu slightly below and aligned to the right edge of the button
            const rect = menuButton.getBoundingClientRect();
            
            // Top: Align top of menu with bottom of button, plus a small offset (5px padding)
            optionsMenu.style.top = `${rect.bottom + 5}px`; 
            
            // Right: Align right edge of menu with right edge of button/viewport edge
            optionsMenu.style.right = `${window.innerWidth - rect.right}px`;
            
            optionsMenu.style.left = 'auto'; // Clear left positioning
        }
        e.stopPropagation(); 
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!optionsMenu.contains(e.target) && e.target !== menuButton) {
            optionsMenu.classList.add('hidden');
        }
    });
    
    // Open Edit Keys panel directly from menu
    menuEditKeys.addEventListener('click', () => {
        optionsMenu.classList.add('hidden');
        configPanel.classList.remove('hidden'); // Show config panel
        
        // Re-use logic from editProfilesButton handler for input setup
        apiKeyInput.value = '';
        profileNameInput.value = '';
        const selectedProfile = profileSelector.value;
        if (selectedProfile && selectedProfile !== 'None') {
            profileNameInput.setAttribute('placeholder', `Editing existing profile: ${selectedProfile}`);
            profileNameInput.value = selectedProfile; 
        } else {
             profileNameInput.setAttribute('placeholder', `New Profile Name (required)`);
        }
        apiKeyInput.setAttribute('placeholder', `API Key (required)`);
        profileNameInput.focus();
    });

    // Open Settings for gemini.profiles
    menuOpenProfilesSettings.addEventListener('click', () => {
        postMessage('openSettings', { settingKey: 'gemini.profiles' });
        optionsMenu.classList.add('hidden');
    });
    
    // Open Settings for latency debounce
    menuLatencySettings.addEventListener('click', () => {
        postMessage('openSettings', { settingKey: 'gemini.latency.debounceMs' });
        optionsMenu.classList.add('hidden');
    });


    // --- F2/F5: Profile Management and Saving ---

    // 1. Handle saving a new profile/key
    saveKeyButton.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        let profileName = profileNameInput.value.trim();

        if (key && profileName) {
            saveKeyButton.textContent = 'Saving...';
            apiKeyInput.disabled = true;
            profileNameInput.disabled = true;
            saveKeyButton.disabled = true;
            postMessage('saveKey', { key: key, profileName: profileName });
        } else if (key) {
             // Fallback to default if name is missing but key is present
            profileName = 'default';
            saveKeyButton.textContent = 'Saving...';
            apiKeyInput.disabled = true;
            profileNameInput.disabled = true;
            saveKeyButton.disabled = true;
            postMessage('saveKey', { key: key, profileName: profileName });
        }
    });
    
    // 2. Handle profile selection switch
    profileSelector.addEventListener('change', () => {
        const profileName = profileSelector.value;
        if (profileName && profileName !== 'None') {
            postMessage('switchProfile', { profileName });
            // Hide config panel after switching profiles
            configPanel.classList.add('hidden');
        }
    });

    // 3. Handle Edit Keys button: Toggle the simple config panel
    editProfilesButton.addEventListener('click', () => {
        optionsMenu.classList.add('hidden'); // Hide options menu if open
        
        configPanel.classList.toggle('hidden');
        if (!configPanel.classList.contains('hidden')) {
            // Clear inputs, then pre-fill name if an active profile is selected
            apiKeyInput.value = '';
            profileNameInput.value = '';
            
            const selectedProfile = profileSelector.value;
            
            if (selectedProfile && selectedProfile !== 'None') {
                profileNameInput.setAttribute('placeholder', `Editing existing profile: ${selectedProfile}`);
                profileNameInput.value = selectedProfile; 
            } else {
                 profileNameInput.setAttribute('placeholder', `New Profile Name (required)`);
            }
            apiKeyInput.setAttribute('placeholder', `API Key (required)`);
            profileNameInput.focus();
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

        // Re-enable inputs only AFTER a response or error is handled
        if (message.command === 'response' || message.command === 'error') {
            promptInput.disabled = false;
            sendButton.disabled = false;
            promptInput.focus();
        }

        switch (message.command) {
            case 'updateStatus': 
                // Check if we just transitioned from inactive (hidden config) to active
                const wasActive = keyStatusIndicator.classList.contains('active');
                
                saveKeyButton.textContent = 'Save & Activate';
                apiKeyInput.disabled = false;
                profileNameInput.disabled = false; // Re-enable profile input
                saveKeyButton.disabled = false;

                // Update Profile Display & Selector
                const activeProfile = message.activeProfile || 'None';
                updateProfileSelector(message.availableProfiles, activeProfile);
                
                if (message.keyStatus) {
                    keyStatusIndicator.classList.add('active');
                    keyStatusIndicator.title = `API Key Status: Active (Profile: ${activeProfile})`;
                    configPanel.classList.add('hidden');
                    contextHeader.classList.remove('hidden'); 
                    
                    if (!wasActive && chatMessages.length === 1 && chatMessages[0].type === 'system') {
                        // Display clear confirmation if key was just activated and chat was essentially empty (only welcome message)
                        appendMessage('success', `Gemini API Key successfully validated and activated using profile: ${activeProfile}.`, true, false);
                    }

                } else {
                    keyStatusIndicator.classList.remove('active');
                    keyStatusIndicator.title = 'API Key Status: Missing/Invalid. Please enter your key below, or configure profiles in settings.';
                    configPanel.classList.remove('hidden');
                    contextHeader.classList.add('hidden'); 
                    
                    // Clear state and storage when API key is missing/invalid
                    // Ensure that we re-initialize the welcome message if the key is removed, 
                    // otherwise the chat history will be completely blank until activation.
                    chatMessages = [{ type: 'system', content: initialWelcomeMessageContent, isText: true }];
                    localStorage.removeItem(CHAT_STORAGE_KEY);
                    renderChatHistory(); // Render the welcome message
                }
                updateContextFileList(message.contextFiles || []);
                break;
            
            case 'newChatConfirm':
                // History was cleared by newChatButton handler. We only need to re-render.
                renderChatHistory();
                break;
            
            case 'openPalette':
                togglePalette(true);
                break;
                
            case 'loading':
                // Pass false for save, as loading is transient
                appendMessage('loading', content, true, false); 
                break;
            case 'response':
                const formattedHtml = formatResponse(content);
                appendMessage('assistant', formattedHtml, false, true); 
                attachCodeActionListeners();
                break;
            case 'error':
                // Pass false for save, as errors should not persist in history
                appendMessage('error', content, true, false); 
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

        appendMessage('user', prompt, true, true); // Save user message
        
        // Reset height and disable input while request is pending
        promptInput.value = '';
        promptInput.style.height = 'auto';
        promptInput.disabled = true;
        sendButton.disabled = true;

        postMessage('submitPrompt', { text: prompt });
        
        // Hide palette if active when sending a message
        togglePalette(false);
    }
    

    // DOM Manipulation Helpers (Refactored for Persistence)
    /**
     * Appends a message to the DOM and updates the internal state array.
     * @param type Message type (user, assistant, system, loading, error, success)
     * @param content Message content (text or HTML)
     * @param isText True if content is plain text, false if HTML
     * @param save True if the message should be persisted to localStorage (default: true)
     */
    function appendMessage(type, content, isText = true, save = true) {
        
        // 1. Check if a loading message exists in state/DOM and remove it
        const loadingIndex = chatMessages.findIndex(m => m.type === 'loading');
        
        if (loadingIndex !== -1) {
            chatMessages.splice(loadingIndex, 1);
            const loadingMessage = chatHistory.querySelector('.message.loading');
            if (loadingMessage) {
                loadingMessage.remove();
            }
        }
        
        // 2. Add the new message to the internal state array
        chatMessages.push({ type, content, isText });
        
        // 3. Update DOM 
        const messageDiv = createMessageElement(type, content, isText);
        chatHistory.appendChild(messageDiv);
        
        // 4. Save history if required (we skip saving loading/error messages)
        if (save && type !== 'loading' && type !== 'error') {
            saveChatHistory();
        }

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
