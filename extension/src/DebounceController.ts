// src/DebounceController.ts
import * as vscode from 'vscode';

/**
 * Manages debouncing of asynchronous tasks, providing cancellation capabilities.
 */
export class DebounceController<T> {
    private timeoutId: NodeJS.Timeout | undefined;
    private currentTokenSource: vscode.CancellationTokenSource | undefined;

    constructor(private readonly delayMs: () => number) {}

    /**
     * Schedules a new task. Cancels any previously scheduled or running tasks.
     * The task is allowed to return T or undefined (if, e.g., conditions weren't met).
     * @param task The asynchronous function to execute after the delay.
     * @returns A Promise that resolves with the task result or undefined if cancelled.
     */
    public schedule(task: (token: vscode.CancellationToken) => Promise<T | undefined>): Promise<T | undefined> {
        // 1. Cancel the previous attempt, if any
        if (this.currentTokenSource) {
            this.currentTokenSource.cancel();
            this.currentTokenSource = undefined;
        }
        
        // Clear any pending timeout
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }

        // 2. Create a new token source for the new task
        const tokenSource = new vscode.CancellationTokenSource();
        this.currentTokenSource = tokenSource;
        const token = tokenSource.token;

        return new Promise((resolve) => {
            this.timeoutId = setTimeout(async () => {
                this.timeoutId = undefined; // Timer elapsed

                if (token.isCancellationRequested) {
                    return resolve(undefined); // Was cancelled before execution
                }

                try {
                    // Task execution is now correctly typed to return T | undefined
                    const result = await task(token);
                    resolve(result);
                } catch (error) {
                    // Log error but resolve undefined to avoid breaking the provider chain
                    console.error("Debounced task execution failed:", error);
                    resolve(undefined);
                } finally {
                    // Clean up the token source if this task finished successfully
                    if (this.currentTokenSource === tokenSource) {
                        this.currentTokenSource = undefined;
                        tokenSource.dispose();
                    }
                }
            }, this.delayMs());
        });
    }

    /**
     * Immediately clears any pending task or active token.
     */
    public cancel() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
        if (this.currentTokenSource) {
            this.currentTokenSource.cancel();
            this.currentTokenSource = undefined;
        }
    }
}