// extension/src/FindReplaceStrategy.ts
import * as vscode from 'vscode';

export class FindReplaceStrategy {
    /**
     * Helper method to find a matching range in the document using a 3-step strategy:
     * 1. Exact Match
     * 2. Normalized Match (trimming leading/trailing whitespace from each line)
     * 3. First-line Anchor Search + simple bracket/parenthesis/brace matching
     */
    public static async findMatchingRange(document: vscode.TextDocument, findTextLF: string): Promise<{ range: vscode.Range, foundMatchText: string } | null> {
        const documentContent = document.getText();
        const documentLines = documentContent.split('\n');
        const findLines = findTextLF.split('\n');

        // Strategy 1: Exact Match
        let startIndex = documentContent.indexOf(findTextLF);
        if (startIndex !== -1) {
            const endIndex = startIndex + findTextLF.length;
            return {
                range: new vscode.Range(document.positionAt(startIndex), document.positionAt(endIndex)),
                foundMatchText: findTextLF
            };
        }

        // Strategy 2: Normalized Match (ignore all leading/trailing whitespace per line for comparison)
        const findLinesTrimmed = findLines.map(line => line.trim());

        if (findLinesTrimmed.length > 0 && findLinesTrimmed.join('').trim().length > 0) {
            for (let i = 0; i <= documentLines.length - findLinesTrimmed.length; i++) {
                let match = true;
                let foundBlockLines: string[] = [];
                for (let j = 0; j < findLinesTrimmed.length; j++) {
                    if (i + j >= documentLines.length || documentLines[i + j].trim() !== findLinesTrimmed[j]) {
                        match = false;
                        break;
                    }
                    foundBlockLines.push(documentLines[i + j]);
                }
                if (match) {
                    const blockStartIndex = document.offsetAt(new vscode.Position(i, 0));
                    const blockEndIndex = document.offsetAt(new vscode.Position(i + findLinesTrimmed.length - 1, documentLines[i + findLinesTrimmed.length - 1].length));
                    return {
                        range: new vscode.Range(document.positionAt(blockStartIndex), document.positionAt(blockEndIndex)),
                        foundMatchText: foundBlockLines.join('\n')
                    };
                }
            }
        }

        // Strategy 3: First-line Anchor Search + simple bracket/parenthesis/brace matching
        const firstFindMeaningfulLine = findLines.find(line => line.trim().length > 0);
        if (firstFindMeaningfulLine) {
            const firstFindLineTrimmed = firstFindMeaningfulLine.trim();

            for (let i = 0; i < documentLines.length; i++) {
                if (documentLines[i].trim().startsWith(firstFindLineTrimmed)) {
                    let openBracketCount = 0;
                    let blockEndLineIndex = -1;
                    let potentialFoundTextLines: string[] = [];

                    for (let k = i; k < documentLines.length; k++) {
                        const line = documentLines[k];
                        potentialFoundTextLines.push(line);

                        for (const char of line) {
                            if (char === '(' || char === '[' || char === '{') {
                                openBracketCount++;
                            } else if (char === ')' || char === ']' || char === '}') {
                                openBracketCount--;
                            }
                        }

                        if (openBracketCount <= 0 && k > i) { 
                            blockEndLineIndex = k;
                            break;
                        }
                    }

                    if (blockEndLineIndex !== -1) {
                        const foundBlockText = potentialFoundTextLines.join('\n');
                        const normalizedFoundBlock = foundBlockText.split('\n').map(l => l.trim()).join('\n').trim();
                        const normalizedFindText = findTextLF.split('\n').map(l => l.trim()).join('\n').trim();

                        if (normalizedFoundBlock === normalizedFindText) {
                            const blockStartIndex = document.offsetAt(new vscode.Position(i, 0));
                            const blockEndIndex = document.offsetAt(new vscode.Position(blockEndLineIndex, documentLines[blockEndLineIndex].length));
                            return {
                                range: new vscode.Range(document.positionAt(blockStartIndex), document.positionAt(blockEndIndex)),
                                foundMatchText: foundBlockText
                            };
                        }
                    }
                }
            }
        }

        return null;
    }
}