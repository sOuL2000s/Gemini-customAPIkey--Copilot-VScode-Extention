// src/SecretStorageManager.ts
import * as vscode from 'vscode';

const SECRET_KEY_PREFIX = 'gemini.apikey.';

export class SecretStorageManager {
    private readonly secrets: vscode.SecretStorage;

    constructor(secrets: vscode.SecretStorage) {
        this.secrets = secrets;
    }

    private getKeyStorageId(name: string): string {
        return SECRET_KEY_PREFIX + name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    }

    /**
     * Retrieves the list of all stored API key names.
     */
    public async getAllKeyNames(): Promise<string[]> {
        const keys = await this.secrets.keys();
        const names = [];
        
        // Due to VS Code Secret Storage implementation details, keys() returns internal IDs.
        // We have to iterate and find which stored IDs belong to us, 
        // and map them back if possible. For simplicity, we currently rely on external storage
        // of key names or derive them, but here we iterate over all keys hoping VS Code
        // eventually supports better key management indexing.
        // For this implementation, we rely on the provider re-requesting the active name
        // and the list of names derived from stored key IDs.
        
        // NOTE: In a real-world scenario, storing a manifest of user-friendly names 
        // linked to cryptic SecretStorage IDs is often necessary. 
        // For this plaintext implementation, we will fetch keys and assume the provider 
        // will keep track of user-friendly names vs internal SecretStorage names. 
        // We will prioritize Configuration for active name management.
        
        const configKeys = await this.getStoredConfigKeyNames();
        return configKeys.filter(name => name.trim() !== '');
    }

    // Since VSCode Secret Storage keys() method is implementation-dependent, 
    // we use a workaround by assuming key names are stored in a configuration entry 
    // that we manage, or we query keys iteratively.
    // Given the constraints, let's simplify and rely on the extension host 
    // managing the map of names if necessary, but keep CRUD simple by prefixing.
    
    // For now, we manually manage a list of names if we can't iterate stored keys reliably.
    // To keep it simple, we store a list of names in a public setting:
    private async getStoredConfigKeyNames(): Promise<string[]> {
        const config = vscode.workspace.getConfiguration('gemini');
        const storedNames = config.get<string[]>('storedApiKeys') || [];
        return storedNames;
    }

    private async setStoredConfigKeyNames(names: string[]): Promise<void> {
         await vscode.workspace.getConfiguration('gemini').update(
            'storedApiKeys', 
            Array.from(new Set(names)), // Ensure uniqueness
            vscode.ConfigurationTarget.Global
        );
    }
    
    /**
     * Retrieves the API key for the given name.
     */
    public async getApiKey(name: string): Promise<string | undefined> {
        if (!name) return undefined;
        return this.secrets.get(this.getKeyStorageId(name));
    }

    /**
     * Saves a new API key or updates an existing one.
     */
    public async saveApiKey(name: string, key: string): Promise<void> {
        if (!name || !key) throw new Error("Name and key required.");
        const internalId = this.getKeyStorageId(name);
        await this.secrets.store(internalId, key.trim());
        
        // Update list of configured names
        const names = await this.getStoredConfigKeyNames();
        if (!names.includes(name)) {
            names.push(name);
            await this.setStoredConfigKeyNames(names);
        }
    }

    /**
     * Deletes a stored API key.
     */
    public async deleteApiKey(name: string): Promise<void> {
        if (!name) return;
        const internalId = this.getKeyStorageId(name);
        await this.secrets.delete(internalId);
        
        // Update list of configured names
        const names = await this.getStoredConfigKeyNames();
        const updatedNames = names.filter(n => n !== name);
        await this.setStoredConfigKeyNames(updatedNames);
    }
    
    // --- Active Key Management (Uses VS Code Configuration) ---

    /**
     * Gets the name of the currently active key from configuration.
     */
    public getActiveKeyName(): string | undefined {
        const config = vscode.workspace.getConfiguration('gemini');
        const activeName = config.get<string>('activeApiKeyName');
        return activeName?.trim() || undefined;
    }
    
    /**
     * Sets the currently active key name in configuration.
     */
    public async setActiveKeyName(name: string): Promise<void> {
        await vscode.workspace.getConfiguration('gemini').update(
            'activeApiKeyName', 
            name, 
            vscode.ConfigurationTarget.Global
        );
    }

    /**
     * Retrieves the actual API key content for the currently active key.
     */
    public async getActiveApiKey(): Promise<string | undefined> {
        const activeName = this.getActiveKeyName();
        if (!activeName) {
            // If no active name set, try to pick the first available one
            const allNames = await this.getAllKeyNames();
            if (allNames.length > 0) {
                await this.setActiveKeyName(allNames[0]);
                return this.getApiKey(allNames[0]);
            }
            return undefined;
        }
        return this.getApiKey(activeName);
    }

    /**
     * Finds the next available API key name for failover.
     */
    public async getNextKeyName(currentName: string): Promise<string | undefined> {
        const allNames = await this.getAllKeyNames();
        if (allNames.length <= 1) return undefined;
        
        const currentIndex = allNames.indexOf(currentName);
        const nextIndex = (currentIndex + 1) % allNames.length;
        return allNames[nextIndex];
    }
}