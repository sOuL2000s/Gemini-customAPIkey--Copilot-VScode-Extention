# Extension Quick Start

This document provides a basic guide for developing and testing your VS Code extension.

## Commands

*   `npm install` - Installs dependencies.
*   `npm run compile` - Compiles the TypeScript source code into JavaScript in the `out` directory.
*   `npm run watch` - Compiles continuously when changes are made to the source files.

## Running in VS Code

1.  **Open the project** folder (`gemini-local-coder/extension`) in VS Code.
2.  **Go to the Run and Debug View** (Ctrl+Shift+D).
3.  Select the **"Run Extension"** launch configuration.
4.  Press **F5** (or click the green start arrow).

This action opens a new window, the **Extension Development Host**. Your extension is running in this host window.

## Testing

1.  In the Extension Development Host window, navigate to the Activity Bar on the right.
2.  Click the **Gemini Coder** icon.
3.  Open a code file.
4.  Select some code and use the chat interface to send a prompt to the local FastAPI backend.