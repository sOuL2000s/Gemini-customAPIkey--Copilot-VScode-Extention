// src/InlineCompletionProvider.ts
import * as vscode from 'vscode';
import { GoogleGenAI } from '@google/genai';
import { DebounceController } from './DebounceController';
import { ConfigurationManager } from './ConfigurationManager';

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

        if (!this.apiAgent) {
            // Silently fail if key is missing, as expected for ghost text
            return null;
        }
        
        if (token.isCancellationRequested) {
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
                
                // Use || '' for safe string access
                const cleanedText = this.extractRawCode(response.text || '');

                // 4. Calculate relevant insertion text (handling line suffixes)
                const lineSuffix = document.getText(new vscode.Range(position, document.lineAt(position.line).range.end));
                
                let finalSuggestion = cleanedText.trimStart();
                
                // Remove the line suffix if the suggestion starts with it
                if (finalSuggestion.startsWith(lineSuffix)) {
                    finalSuggestion = finalSuggestion.substring(lineSuffix.length);
                }

                if (!finalSuggestion.trim()) {
                    return undefined;
                }
                
                return finalSuggestion;

            } catch (e) {
                if (!cancellationToken.isCancellationRequested) {
                    // Only log errors that weren't due to explicit cancellation
                    console.error("Gemini API call failed:", e);
                }
                return undefined;
            }
        });

        if (!completionText) {
            return null;
        }

        // 5. Return Inline Completion Item (using direct assignment for range fix)
        const item = new vscode.InlineCompletionItem(completionText);
        item.range = new vscode.Range(position, position);

        return [item];
    }
    
    private createCodeAwarePrompt(document: vscode.TextDocument, position: vscode.Position): string {
        const fullContent = document.getText();
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
3. Maintain the existing indentation of '${indentation}'. 
4. Stop immediately once the logical continuation is complete.
`;
        return userPrompt;
    }

    private extractRawCode(responseText: string): string {
        const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)\n```/;
        const match = responseText.match(codeBlockRegex);

        if (match && match[1]) {
            return match[1].trim();
        }
        
        return responseText.trim();
    }
    
    public outlineEditingStrategy(): string {
        return "The Inline Completion Provider uses the `vscode.InlineCompletionItem.insertText` property. When the user accepts the suggestion (usually by pressing Tab), VS Code automatically applies the text, handling multi-line insertion seamlessly at the `range` specified in the item (typically a zero-width range at the cursor position). No explicit use of `TextEditorEdit` or `WorkspaceEdit` is required for accepting ghost text suggestions.";
    }
}