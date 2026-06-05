// src/ConfigurationManager.ts
import * as vscode from 'vscode';

export class ConfigurationManager {
    private static readonly CONFIG_SECTION = 'gemini';
    private static readonly CONFIG_TARGET = vscode.ConfigurationTarget.Global; // Use Global target for settings managed via sidebar

    /**
     * Retrieves the configured model for the chat sidebar.
     */
    public static getChatModel(): string {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION);
        // Default matches the one defined in package.json
        return config.get<string>('chatModel') || "gemini-2.5-flash";
    }

    /**
     * Sets the configured model for the chat sidebar.
     */
    public static async setChatModel(model: string): Promise<void> {
        await vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION).update('chatModel', model, this.CONFIG_TARGET);
    }

    /**
     * Retrieves the configured model for inline completion.
     */
    public static getInlineModel(): string {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION);
        // Default matches the one defined in package.json
        return config.get<string>('inlineModel') || "gemini-2.5-flash-lite";
    }
    
    /**
     * Sets the configured model for inline completion.
     */
    public static async setInlineModel(model: string): Promise<void> {
        await vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION).update('inlineModel', model, this.CONFIG_TARGET);
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
    
    /**
     * Sets the configured debounce delay in milliseconds.
     */
    public static async setDebounceDelay(delay: number): Promise<void> {
        // Ensure bounds are respected before setting
        const clampedDelay = Math.max(100, Math.min(2000, delay));
        await vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION).update('latency.debounceMs', clampedDelay, this.CONFIG_TARGET);
    }

    public static getAutoDetectDepth(): number {
        return vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION).get<number>('context.autoDetectDepth') || 1;
    }

    public static getIgnorePatterns(): string[] {
        return vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION).get<string[]>('context.ignorePatterns') || [];
    }

    public static getMaxTokens(): number {
        return vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION).get<number>('context.maxTokens') || 1000000;
    }
}
