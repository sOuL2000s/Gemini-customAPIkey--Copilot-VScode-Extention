// src/ConfigurationManager.ts
import * as vscode from 'vscode';

export class ConfigurationManager {
    private static readonly CONFIG_SECTION = 'gemini';

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