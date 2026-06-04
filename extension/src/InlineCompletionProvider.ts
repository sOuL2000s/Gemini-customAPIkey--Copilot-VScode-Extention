// src/InlineCompletionProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import { DebounceController } from './DebounceController';
import { ConfigurationManager } from './ConfigurationManager';
import { SecretStorageManager } from './SecretStorageManager'; // NEW IMPORT

const MAX_CONTEXT_CHARS = 200000; // Limit context size

export class GeminiInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private apiAgent: GoogleGenAI | null = null;
    private model: string;

    private readonly debounceController = new DebounceController<string>(() => 
        ConfigurationManager.getDebounceDelay()
    );

    constructor(private readonly secretManager: SecretStorageManager) { // NEW DEPENDENCY
        this.model = ConfigurationManager.getInlineModel(); // Initialize model
        this.initializeApiAgent();
        
        // Listen for configuration changes related to active key or models/debounce
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('gemini.activeApiKeyName') || e.affectsConfiguration('gemini.latency.debounceMs')) {
                 this.initializeApiAgent();
            }
            if (e.affectsConfiguration('gemini.inlineModel')) {
                 this.model = ConfigurationManager.getInlineModel();
                 console.log(`Inline model updated to: ${this.model}`);
            }
        });
    }

    private async initializeApiAgent() { // Now async
        // Use SecretStorageManager to get the currently active key
        const apiKey = await this.secretManager.getActiveApiKey();
        if (apiKey) {
            this.apiAgent = new GoogleGenAI({ apiKey });
            console.log("Gemini API Agent initialized for inline suggestions.");
        } else {
            this.apiAgent = null;
        }
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | null | undefined> {

        if (token.isCancellationRequested) return null;
        
        const prompt = this.createCodeAwarePrompt(document, position);
        if (!prompt) return null;

        return await this.debounceController.schedule(async (cancellationToken) => {
            if (cancellationToken.isCancellationRequested) return undefined;

            let attempts = 0;
            const keyNames = await this.secretManager.getAllKeyNames();
            const maxAttempts = keyNames.length || 1;

            while (attempts < maxAttempts) {
                if (!this.apiAgent) {
                    await this.initializeApiAgent();
                    if (!this.apiAgent) return undefined;
                }

                try {
                    const response = await this.apiAgent!.models.generateContent({
                        model: this.model,
                        contents: prompt,
                    });
                    
                    const rawSuggestion = (response.text || '').trim();
                    const lineSuffix = document.getText(new vscode.Range(position, document.lineAt(position.line).range.end));
                    let finalSuggestion = rawSuggestion.trimStart();
                    
                    if (lineSuffix && finalSuggestion.startsWith(lineSuffix)) {
                        finalSuggestion = finalSuggestion.substring(lineSuffix.length);
                    }

                    if (!finalSuggestion.trim()) return undefined;
                    
                    const item = new vscode.InlineCompletionItem(finalSuggestion);
                    item.range = new vscode.Range(position, position); 
                    return [item] as any; // Cast for debounce controller compatibility

                } catch (e) {
                    attempts++;
                    const currentKey = this.secretManager.getActiveKeyName() || '';
                    const nextKey = await this.secretManager.getNextKeyName(currentKey);

                    if (nextKey && attempts < maxAttempts) {
                        console.warn(`Inline Key '${currentKey}' failed. Switching to '${nextKey}'...`);
                        await this.secretManager.setActiveKeyName(nextKey);
                        await this.initializeApiAgent();
                        // Continue loop with new agent
                    } else {
                        if (!cancellationToken.isCancellationRequested) {
                            console.error("Gemini Inline API failed after all attempts:", e);
                        }
                        return undefined;
                    }
                }
            }
            return undefined;
        }) as any;
    }
    
    private createCodeAwarePrompt(document: vscode.TextDocument, position: vscode.Position): string | null {
        const fullContent = document.getText();
        
        // Refactoring Change #3: Context Size Limit
        if (fullContent.length > MAX_CONTEXT_CHARS) {
            console.warn(`File context exceeds ${MAX_CONTEXT_CHARS} characters. Skipping inline completion.`);
            return null;
        }
        
        const language = document.languageId;
        const offset = document.offsetAt(position);
        
        const contentBefore = fullContent.substring(0, offset);
        const contentAfter = fullContent.substring(offset);
        
        const currentLineText = document.lineAt(position.line).text;
        const indentation = currentLineText.match(/^(\s*)/)?.[1] || '';

        const systemInstruction = `You are an expert code completion AI specializing in the ${language} language. Your task is to provide the logical code continuation, based on the file contents provided.`;
        
        const userPrompt = `
${systemInstruction}

CONTEXT:
--- START FILE: ${document.fileName} ---
${contentBefore}###CURSOR###
${contentAfter}
--- END FILE ---

TASK: Based on the context and the '###CURSOR###' position, complete the code precisely starting from the cursor. 
1. Provide ONLY the raw code continuation as text. 
2. DO NOT wrap the output in markdown fences (e.g., \`\`\`${language}\`). 
3. Maintain the existing indentation of '${indentation}' for new lines. 
4. Stop immediately once the logical continuation is complete.
`;
        return userPrompt;
    }
}