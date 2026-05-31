# Gemini Local Coder

A high-performance, self-contained coding assistant for VS Code, powered directly by the Google Gemini API. This extension provides a low-latency, "Copilot-style" experience without requiring a complex local setup, while maintaining full control over your API keys and model selection.

## 🚀 Key Features

### 1. Context-Aware Inline Completion
*   **Real-time Suggestions:** Get ghost-text completions as you type, similar to GitHub Copilot.
*   **Configurable Latency:** Adjustable debounce settings (100ms - 2000ms) to balance performance and API usage.
*   **Model Selection:** Choose between fast models like `gemini-2.5-flash-lite` for speed or more capable models for complex logic.

### 2. Intelligent Chat Sidebar
*   **Direct Interaction:** Ask questions, request refactors, or generate unit tests directly in the sidebar.
*   **Action Blocks:** Gemini provides structured `--- FIND ---` and `--- REPLACE ---` blocks that can be applied to your active file with a single click.
*   **Chat History:** Your conversations are persisted locally so you never lose your progress.

### 3. Advanced Context Management
*   **Active File Focus:** The extension automatically includes your current file content in every request.
*   **External Context:** Manually add specific files (TS, JS, PY, JSON, etc.) to the chat context to help Gemini understand cross-file dependencies.
*   **Optimized Prompting:** Uses system instructions designed to minimize conversational filler and maximize code output.

### 4. Robust API Key Management
*   **Multi-Key Support:** Store multiple API keys (e.g., Work, Personal, Free Tier).
*   **Automatic Failover:** If a request fails due to rate limits or invalid keys, the extension automatically attempts to cycle through your stored keys.
*   **Secure Storage:** Uses the native VS Code `SecretStorage` to keep your keys encrypted.

### 5. Integrated Command Palette
*   **Quick Access:** Use `Ctrl+Alt+H` (`Cmd+Alt+H` on Mac) to open a specialized palette for common tasks like `/refactor`, `/test`, or `/explain`.

## 🛠️ Installation & Setup

1.  **Install the Extension:** (Available via VSIX or Marketplace).
2.  **Get a Gemini API Key:** Visit the [Google AI Studio](https://aistudio.google.com/app/apikey) to generate a free or pay-as-you-go key.
3.  **Configure the Key:**
    *   Open the Gemini Coder sidebar.
    *   Click the **Manage API Keys** (Gear) icon.
    *   Enter a name (e.g., "Primary") and your API key, then click **Save & Set Active**.
4.  **Start Coding:** Open any file and start typing for inline completions, or use the sidebar for chat.

## ⚙️ Configuration

The extension can be customized via standard VS Code settings or the sidebar's Settings panel:

*   `gemini.chatModel`: The model used for sidebar conversations.
*   `gemini.inlineModel`: The model used for ghost-text completions (Flash models recommended).
*   `gemini.latency.debounceMs`: How long to wait after you stop typing before requesting an inline completion.

## ⌨️ Keyboard Shortcuts

| Command | Windows/Linux | macOS |
| :--- | :--- | :--- |
| Open Gemini Palette | `Ctrl+Alt+H` | `Cmd+Alt+H` |
| Accept Inline Suggestion | `Tab` | `Tab` |

## 🛠️ Development & Maintenance

### Local Setup & Debugging
1.  **Clone the Repository:** `git clone <repository-url>`
2.  **Install Dependencies:** Navigate to the `extension/` folder and run `npm install`.
3.  **Compile Source:** Run `npm run compile` to build the TypeScript code into the `out/` directory.
4.  **Run/Debug:** 
    *   Open the `extension/` folder in VS Code.
    *   Press `F5` (or go to Run and Debug > "Run Extension") to launch the **Extension Development Host**.
    *   Use `npm run watch` to recompile automatically on file changes.

### Packaging
To create a `.vsix` bundle for manual installation:
1.  Navigate to the `extension/` directory.
2.  Run `npx vsce package`.

## 🤖 CI/CD & GitHub Automations

This project includes a GitHub Actions workflow (`.github/workflows/release.yml`) to automate the creation of GitHub Releases with attached extension binaries.

### Triggering a Release
The automation is triggered by pushing a Git tag that follows semantic versioning (e.g., `1.0.0` or `v1.0.0`).

1.  **Commit Changes:** Ensure all code and `package.json` version updates are committed.
2.  **Tag and Push:**
    ```bash
    git tag v3.6.1
    git push origin v3.6.1
    ```

### How the Workflow Works
Once the tag is pushed, GitHub Actions will:
1.  **Checkout Code:** Pull the repository onto an `ubuntu-latest` runner.
2.  **Environment Setup:** Install Node.js 20 and dependencies.
3.  **Compile & Package:** Run the build scripts and generate the `.vsix` file.
4.  **Publish Release:** Create a new GitHub Release based on the tag, generate automatic release notes, and upload the `.vsix` file as a release asset.

## 🛡️ Security & Privacy

*   **Direct API Calls:** This extension communicates directly with Google's Gemini API. No intermediate servers are used.
*   **Local Processing:** File context is gathered locally on your machine before being sent to the API.
*   **Secret Storage:** API keys are never stored in plain text configuration files.

---

*Developed by Souparna Paul. Licensed under the MIT License.*