// src/ConfigurationManager.ts
import * as vscode from 'vscode';

type ApiProfiles = { [key: string]: string };

export class ConfigurationManager {
    private static readonly CONFIG_SECTION = 'gemini';

    /**
     * Retrieves the currently active Gemini API Key from the configured profiles.
     * @returns The active API key string, or undefined if not set or invalid.
     */
    public static getActiveApiKey(): string | undefined {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION);
        const activeProfileName = config.get<string>('activeProfile');
        const profiles = config.get<ApiProfiles>('profiles') || {};
        
        if (!activeProfileName || activeProfileName.trim() === '') {
            return undefined;
        }
        
        const apiKey = profiles[activeProfileName];

        // Safety check: Return undefined if the key is undefined or an empty string after trimming.
        if (!apiKey || apiKey.trim() === '') {
            return undefined;
        }
        return apiKey.trim();
    }

    /**
     * Retrieves all configured API key profiles.
     */
    public static getProfiles(): { activeName: string | undefined, profiles: ApiProfiles } {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION);
        const activeProfileName = config.get<string>('activeProfile');
        const profiles = config.get<ApiProfiles>('profiles') || {};

        return {
            activeName: activeProfileName,
            profiles: profiles
        };
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
