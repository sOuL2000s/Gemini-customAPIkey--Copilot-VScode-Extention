// src/InlineCompletionProvider.ts
import * as vscode from 'vscode';
import { GoogleGenAI } from '@google/genai';
import { DebounceController } from './DebounceController';
import { ConfigurationManager } from './ConfigurationManager';

const MAX_CONTEXT_CHARS = 200000; // Limit context size

export class GeminiInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private apiAgent: GoogleGenAI | null = null;
    private readonly model = 'gemini-2.5-flash';

    private readonly debounceController = new DebounceController<string>(() => 
        ConfigurationManager.getDebounceDelay()
    );

    constructor() {
        this.initializeApiAgent();
        vscode.workspace.onDidChangeConfiguration(() => this.initializeApiAgent());
    }

    private initializeApiAgent() {
        const apiKey = ConfigurationManager.getApiKey();
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

        if (!this.apiAgent || token.isCancellationRequested) {
            return null;
        }
        
        // 1. Context Extraction and Prompt Generation
        const prompt = this.createCodeAwarePrompt(document, position);
        if (!prompt) {
             return null;
        }

        // 2. Debounce and Execute API Call
        const completionText = await this.debounceController.schedule(async (cancellationToken) => {
            
            if (cancellationToken.isCancellationRequested) {
                return undefined; 
            }

            try {
                const response = await this.apiAgent!.models.generateContent({
                    model: this.model,
                    contents: prompt,
                });
                
                // --- Refactoring Change #1 & #2: Removed extractRawCode, relying on prompt ---
                const rawSuggestion = (response.text || '').trim();

                // 3. Calculate relevant insertion text (handling line suffixes)
                const lineSuffix = document.getText(new vscode.Range(position, document.lineAt(position.line).range.end));
                
                let finalSuggestion = rawSuggestion.trimStart();
                
                // Remove the line suffix if the suggestion starts with it
                if (lineSuffix && finalSuggestion.startsWith(lineSuffix)) {
                    finalSuggestion = finalSuggestion.substring(lineSuffix.length);
                }

                if (!finalSuggestion.trim()) {
                    return undefined;
                }
                
                return finalSuggestion;

            } catch (e) {
                if (!cancellationToken.isCancellationRequested) {
                    console.error("Gemini Inline API call failed:", e);
                }
                return undefined;
            }
        });

        if (!completionText) {
            return null;
        }

        // 4. Return Inline Completion Item
        const item = new vscode.InlineCompletionItem(completionText);
        // Correctly set range for pure insertion at cursor position
        item.range = new vscode.Range(position, position); 

        return [item];
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