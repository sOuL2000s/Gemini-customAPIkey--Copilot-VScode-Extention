// src/ConfigurationManager.ts
import * as vscode from 'vscode';

export class ConfigurationManager {
    private static readonly CONFIG_SECTION = 'gemini';

    /**
     * Retrieves the Gemini API Key securely from the VS Code configuration.
     * @returns The API key string, or undefined if not set or empty.
     */
    public static getApiKey(): string | undefined {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION);
        const apiKey = config.get<string>('apiKey');
        
        // Safety check: Return undefined if the key is undefined or an empty string after trimming.
        if (!apiKey || apiKey.trim() === '') {
            return undefined;
        }
        return apiKey.trim();
    }

    /**
     * Retrieves the configured debounce delay in milliseconds, respecting bounds.
     */
    public static getDebounceDelay(): number {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION);
        // Uses default from package.json (500) if undefined.
        const delay = config.get<number>('latency.debounceMs') || 500;
        
        // Respect the defined package.json bounds (100ms to 2000ms)
        return Math.max(100, Math.min(2000, delay));
    }
}