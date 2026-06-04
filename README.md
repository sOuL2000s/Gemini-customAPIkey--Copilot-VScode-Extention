# Gemini Local Coder

A high-performance, self-contained coding assistant for VS Code, powered directly by the Google Gemini API. Experience seamless AI-driven development with real-time inline completions, a powerful sidebar chat, and intelligent context management.

## ✨ Key Features

-   **🚀 Direct Gemini Integration**: Communicates directly with the Google GenAI SDK. No middle-man servers, ensuring lower latency and better privacy.
-   **✍️ Intelligent Inline Completions**: Receive real-time, context-aware code suggestions as you type, optimized for speed and logic.
-   **💬 Advanced Code Chat**: A dedicated sidebar interface to ask questions, refactor code, or generate entire features based on your current selection.
-   **📂 Smart Context Management**:
    -   **Active File Context**: Automatically understands your current file.
    -   **External File Context**: Manually add specific files to the chat memory.
    -   **Auto-Detection**: Automatically scans imports and exports to pull in relevant project dependencies.
-   **🛠️ Action Blocks (FIND/REPLACE)**: Apply AI-suggested changes directly to your editor with one click using structured diff blocks.
-   **🔑 Multi-Key Management**: Store multiple API keys with secure SecretStorage. Includes **automatic failover**—if one key hits a rate limit, the extension seamlessly switches to the next.
-   **⌨️ Custom Command Palette**: Access structured commands like `/refactor`, `/test`, and `/explain` quickly using `Ctrl+Alt+H`.

## 🛠️ Installation & Setup

1.  **Install the Extension**: Open the VSIX or install from the Marketplace.
2.  **Get an API Key**: Obtain a free or paid API key from the [Google AI Studio](https://aistudio.google.com/).
3.  **Configure the Extension**:
    -   Open the **Gemini Coder** view in the Activity Bar.
    -   Click the **API Key Management** (gear icon) button.
    -   Enter a name (e.g., "Primary") and your `AIza...` key.
    -   Click **Save & Set Active**.

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+Alt+H` | Open Gemini Command Palette |
| `Cmd+Alt+H` | Open Gemini Command Palette (macOS) |

## ⚙️ Configuration

You can fine-tune your experience in the **Settings** panel within the sidebar or via VS Code Settings (`gemini.*`):

-   **Chat Model**: Choose between `gemini-2.5-pro` (complex reasoning) or `gemini-2.5-flash` (balanced speed).
-   **Inline Model**: Select faster models like `gemini-2.5-flash-lite` for near-instant completions.
-   **Debounce Delay**: Adjust the wait time (100ms - 2000ms) after typing stops before triggering AI suggestions.

## 🤝 Contributing

This project is built with TypeScript and utilizes the `@google/genai` SDK.

### Development Setup
1. Clone the repository.
2. Run `npm install` in the `extension` directory.
3. Press `F5` to open the Extension Development Host.

---
**Developed by [Souparna Paul](https://github.com/sOuL2000s)**