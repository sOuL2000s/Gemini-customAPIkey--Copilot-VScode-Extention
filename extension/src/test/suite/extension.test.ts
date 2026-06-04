// extension/src/test/suite/extension.test.ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SecretStorageManager } from '../../SecretStorageManager';
import { ConfigurationManager } from '../../ConfigurationManager';
import { FindReplaceStrategy } from '../../FindReplaceStrategy';

suite('Gemini Local Coder Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('ConfigurationManager: Default Values', () => {
        assert.strictEqual(ConfigurationManager.getChatModel(), 'gemini-2.5-flash');
        assert.strictEqual(ConfigurationManager.getInlineModel(), 'gemini-2.5-flash-lite');
        assert.strictEqual(ConfigurationManager.getDebounceDelay(), 500);
    });

    test('SecretStorageManager: CRUD Operations', async () => {
        const extension = vscode.extensions.getExtension('SouparnaPaul.gemini-local-coder');
        const api = await extension?.activate();
        const secrets: vscode.SecretStorage = api.context.secrets;
        const manager = new SecretStorageManager(secrets);

        const testKeyName = 'TestKey';
        const testKeyValue = 'AIza-test-value';

        await manager.saveApiKey(testKeyName, testKeyValue);
        let retrieved = await manager.getApiKey(testKeyName);
        assert.strictEqual(retrieved, testKeyValue);

        assert.ok((await manager.getAllKeyNames()).includes(testKeyName));

        await manager.setActiveKeyName(testKeyName);
        assert.strictEqual(manager.getActiveKeyName(), testKeyName);

        await manager.deleteApiKey(testKeyName);
        retrieved = await manager.getApiKey(testKeyName);
        assert.strictEqual(retrieved, undefined);
    });

    test('FindReplaceStrategy: Exact Match', async () => {
        const content = 'function hello() {\n  console.log("world");\n}';
        const doc = await vscode.workspace.openTextDocument({ content, language: 'javascript' });
        
        const findText = 'console.log("world");';
        const result = await FindReplaceStrategy.findMatchingRange(doc, findText);
        
        assert.ok(result);
        assert.strictEqual(result.foundMatchText, findText);
    });

    test('FindReplaceStrategy: Normalized Match (Indentation)', async () => {
        const content = 'function hello() {\n    console.log("world");\n}';
        const doc = await vscode.workspace.openTextDocument({ content, language: 'javascript' });
        
        const findText = '  console.log("world");';
        const result = await FindReplaceStrategy.findMatchingRange(doc, findText.trim());
        
        assert.ok(result);
        assert.strictEqual(result.foundMatchText.trim(), findText.trim());
    });

    test('FindReplaceStrategy: Strategy 3 (Bracket Matching)', async () => {
        const content = 'class MyClass {\n  constructor() {\n    this.val = 1;\n  }\n}';
        const doc = await vscode.workspace.openTextDocument({ content, language: 'javascript' });
        
        const findText = 'constructor() {\n  this.val = 1;\n}';
        const result = await FindReplaceStrategy.findMatchingRange(doc, findText);
        
        assert.ok(result);
        assert.ok(result.foundMatchText.includes('this.val = 1;'));
    });
});