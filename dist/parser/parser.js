"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = parse;
const lexer_1 = require("../lexer/lexer");
const ast_1 = require("./ast");
function parse(tokens) {
    const root = { type: ast_1.NodeType.ROOT, children: [] };
    let current = 0;
    while (current < tokens.length) {
        // Top level parsing: stopOnAssignment = false (consume them)
        // We pass true for 'isTopLevel' to enable import parsing
        const result = parseNodes(tokens, current, [], false);
        if (result.nodes.length > 0) {
            root.children = (root.children || []).concat(result.nodes);
        }
        const prevCurrent = current;
        current = result.nextIndex;
        if (current === prevCurrent && current < tokens.length) {
            break;
        }
        if (current >= tokens.length) {
            break;
        }
    }
    return root;
}
function parseNodes(tokens, startIndex, stopAt = [], stopOnAssignment = false) {
    const nodes = [];
    let i = startIndex;
    while (i < tokens.length) {
        const token = tokens[i];
        if (stopAt.includes(token.type)) {
            break;
        }
        // START IMPORT DETECTION
        // Check if current sequence (TEXT/STAR) forms an import statement
        if (token.type === lexer_1.TokenType.TEXT || token.type === lexer_1.TokenType.STAR) {
            // Lookahead to build a candidate line
            let tempI = i;
            let candidate = '';
            const involvedTokens = [];
            while (tempI < tokens.length) {
                const t = tokens[tempI];
                if (t.type === lexer_1.TokenType.TEXT || t.type === lexer_1.TokenType.STAR) {
                    candidate += t.value;
                    involvedTokens.push(t);
                    tempI++;
                    // If text contains newline, we should probably stop the candidate check there?
                    // Imports are single line.
                    if (t.type === lexer_1.TokenType.TEXT && t.value.includes('\n'))
                        break;
                }
                else {
                    break;
                }
            }
            // Regex check on candidate
            const fromImportRegex = /^\s*from\s+(\S+)\s+import\s+(.+)$/m; // Removed 'g' for single match
            const importRegex = /^\s*import\s+(\S+)\s*$/m;
            let match = fromImportRegex.exec(candidate);
            let isSimpleImport = false;
            if (!match) {
                match = importRegex.exec(candidate);
                if (match)
                    isSimpleImport = true;
            }
            if (match) {
                // We have an import!
                // But we need to make sure we don't consume too much if the candidate had a newline
                // For now, simplify: assume import is the whole line/block we merged.
                // Wait, we need to correctly advance 'i' and potentially split tokens if the import is only PART of the candidate?
                // "candidate" might conform to the regex.
                // Let's rely on the previous logic BUT with merged token values?
                // Merging is tricky with preserving tokens.
                // Alternative: If we detect import, we CONSUME the involved tokens and synthesize the ImportNode.
                const fullMatch = match[0];
                let moduleName = match[1];
                // Strip quotes if present
                if ((moduleName.startsWith('"') && moduleName.endsWith('"')) ||
                    (moduleName.startsWith("'") && moduleName.endsWith("'"))) {
                    moduleName = moduleName.slice(1, -1);
                }
                // If isSimpleImport is true, we don't have match[2]
                // We need to verify if the match is at the START of the candidate.
                if (match.index === 0) {
                    // It matches at the start!
                    // Determine how many tokens cover this match.
                    let lengthCovered = 0;
                    let tokensConsumedCount = 0;
                    for (const t of involvedTokens) {
                        lengthCovered += t.value.length;
                        tokensConsumedCount++;
                        if (lengthCovered >= fullMatch.length)
                            break;
                    }
                    // If we have extra text in the last consumed token, we need to SPLIT it.
                    const lastToken = involvedTokens[tokensConsumedCount - 1];
                    const extraLength = lengthCovered - fullMatch.length;
                    if (extraLength > 0) {
                        // Split the last token
                        const keepLen = lastToken.value.length - extraLength;
                        const remainingText = lastToken.value.substring(keepLen);
                        // Modify the last token in place? No, modifying 'tokens' array.
                        // We should replace the last token with the remaining part
                        // AND remove the fully consumed tokens.
                        // Actually, we are just parsing here.
                        // The logic below (lines 58+) handles TEXT token specifically.
                        // Handling STAR complicates this.
                        // Let's use the explicit logic:
                        // 1. Construct the ImportNode.
                        // 2. Advance 'i' past the used tokens.
                        // 3. Insert specific remaining TEXT token if needed.
                        const names = isSimpleImport ? ['*'] : match[2].split(',').map(n => n.trim()).filter(n => n.length > 0);
                        const importNode = {
                            type: ast_1.NodeType.IMPORT,
                            module: moduleName,
                            names: names
                        };
                        nodes.push(importNode);
                        // Handle leftover
                        if (extraLength > 0) {
                            // Insert remaining text as a new token at i + tokensConsumedCount
                            // But we want to process it next iteration?
                            // tokens.splice(i + tokensConsumedCount, 0, ...)
                            // Wait, we need to REPLACE the last used token with the remainder text?
                            // No, the last used token was "partially" used.
                            // Let's just update the tokens array for the next iteration.
                            tokens[i + tokensConsumedCount - 1] = {
                                type: lexer_1.TokenType.TEXT,
                                value: remainingText
                            };
                            // And we set i to point to that token? 
                            // No, we finished the import. The remainder is separate.
                            // We consumed N-1 tokens fully. The Nth was partial.
                            // We set i = i + N - 1. So next loop processes the Nth (now modified) token.
                            i += (tokensConsumedCount - 1);
                            continue;
                        }
                        else {
                            // All tokens fully consumed
                            i += tokensConsumedCount;
                            continue;
                        }
                    }
                    else {
                        // Exact match consumption
                        const names = isSimpleImport ? ['*'] : match[2].split(',').map(n => n.trim()).filter(n => n.length > 0);
                        const importNode = {
                            type: ast_1.NodeType.IMPORT,
                            module: moduleName,
                            names: names
                        };
                        nodes.push(importNode);
                        i += tokensConsumedCount;
                        continue;
                    }
                }
                else {
                    // Match is NOT at the start. It's somewhere in the middle.
                    // e.g. "Some text\nimport foo"
                    // Split the FIRST token at the match index.
                    // Same logic as before in TEXT block, but now we know it involves multiple tokens potentially?
                    // Actually simplicity: if match.index > 0, we found it in `candidate`.
                    // The first token `tokens[i]` contributes to `candidate`.
                    // If `match.index` is within `tokens[i]`, we simply split `tokens[i]` and continue.
                    if (match.index < tokens[i].value.length) {
                        // Split is inside the first token
                        const textBefore = tokens[i].value.substring(0, match.index);
                        const remaining = tokens[i].value.substring(match.index);
                        nodes.push({ type: ast_1.NodeType.TEXT, value: textBefore });
                        tokens.splice(i, 1, { type: tokens[i].type, value: remaining }); // Keep type (TEXT/STAR)
                        continue;
                    }
                }
            }
        }
        // END IMPORT DETECTION
        if (token.type === lexer_1.TokenType.TEXT) {
            const eqIndex = token.value.indexOf('=');
            let isAssignment = false;
            let varName = '';
            let prefixText = '';
            if (eqIndex !== -1 && stopAt.length === 0) {
                const rawPreText = token.value.substring(0, eqIndex);
                // assignments usually follow a newline or start of file
                const lastNewline = rawPreText.lastIndexOf('\n');
                let candidateName = rawPreText;
                if (lastNewline !== -1) {
                    // Potential assignment is after the newline
                    prefixText = rawPreText.substring(0, lastNewline + 1);
                    candidateName = rawPreText.substring(lastNewline + 1);
                }
                const trimmedName = candidateName.trim();
                // Check validity
                if (trimmedName.length > 0 && /^[a-zA-Z0-9_]+$/.test(trimmedName)) {
                    isAssignment = true;
                    varName = trimmedName;
                }
            }
            if (isAssignment) {
                if (stopOnAssignment) {
                    // We found an assignment but we are supposed to stop.
                    // Do NOT consume. Return.
                    break;
                }
                else {
                    // Parse the assignment
                    // If we split the token (due to newlines), push the prefix first
                    if (prefixText.length > 0) {
                        nodes.push({ type: ast_1.NodeType.TEXT, value: prefixText });
                    }
                    const assignment = {
                        type: ast_1.NodeType.ASSIGNMENT,
                        variableName: varName,
                        expression: []
                    };
                    // Handle text after "=" in the same token
                    let postText = token.value.substring(eqIndex + 1);
                    // Check if postText contains ANOTHER assignment (e.g. \nvarName =)
                    // We need to find the FIRST occurrence of \n[varName]=
                    const splitMatch = /\n\s*[a-zA-Z0-9_]+\s*=/.exec(postText);
                    if (splitMatch) {
                        // We found a start of a new assignment in this text block.
                        // Everything after the newline belongs to the NEXT token.
                        const splitIndex = splitMatch.index;
                        const remainingText = postText.substring(splitIndex);
                        postText = postText.substring(0, splitIndex); // Truncate current postText
                        // Inject the remainder as a new token immediately after this one
                        tokens.splice(i + 1, 0, { type: lexer_1.TokenType.TEXT, value: remainingText });
                        // Note: 'i' is still pointing to current token. We will increment it below.
                        // The recursed parseNodes will see the NEW token at i+1.
                    }
                    // Enforce Hardened Syntax: No naked text after =
                    if (postText.trim().length > 0) {
                        throw new Error(`Syntax Error: Variable assignments must be wrapped in brackets [ ... ]. Found text after '=': "${postText.trim()}"`);
                    }
                    // Check next token (ignoring whitespace if necessary? parser loop handles whitespace TEXT tokens as nodes)
                    // But strict syntax implies: `var = [ ... ]`
                    // The lexer produced a TEXT token for `var = `. `postText` is empty/whitespace.
                    // i points to current token. 
                    // We need to check i+1.
                    let nextTokenIndex = i + 1;
                    // Skip pure whitespace TEXT tokens to find the start of expression?
                    // Actually, let's just peek.
                    let hasLeftBracket = false;
                    // Lookahead for next non-whitespace token
                    for (let k = nextTokenIndex; k < tokens.length; k++) {
                        if (tokens[k].type === lexer_1.TokenType.L_BRACKET) {
                            hasLeftBracket = true;
                            break;
                        }
                        if (tokens[k].type === lexer_1.TokenType.TEXT && tokens[k].value.trim().length === 0) {
                            continue; // Skip whitespace
                        }
                        // Found something else before bracket
                        break;
                    }
                    if (!hasLeftBracket) {
                        throw new Error(`Syntax Error: Variable assignments must be wrapped in brackets [ ... ]. Expected '[' after '='.`);
                    }
                    // if (postText.length > 0) {
                    //   assignment.expression.push({ type: NodeType.TEXT, value: postText });
                    // }
                    // With Hardened Syntax, postText is verified to be whitespace. 
                    // We ignore it to prevent leading spaces in variables.
                    i++; // Consume the TEXT containing "="
                    // Parse the rest as the expression
                    // Expression should STOP on next assignment.
                    const result = parseNodes(tokens, i, stopAt, true);
                    assignment.expression = assignment.expression.concat(result.nodes);
                    // Hardened Syntax Fix: Trim trailing whitespace nodes from the assignment expression.
                    // This prevents newlines after the definition (e.g. \n\n) from becoming part of the variable.
                    while (assignment.expression.length > 0) {
                        const lastNode = assignment.expression[assignment.expression.length - 1];
                        if (lastNode.type === ast_1.NodeType.TEXT && (!lastNode.value || lastNode.value.trim().length === 0)) {
                            assignment.expression.pop();
                        }
                        else {
                            break;
                        }
                    }
                    nodes.push(assignment);
                    i = result.nextIndex;
                    continue;
                }
            }
            nodes.push({ type: ast_1.NodeType.TEXT, value: token.value });
            i++;
        }
        else if (token.type === lexer_1.TokenType.STAR) {
            nodes.push({ type: ast_1.NodeType.TEXT, value: '*' });
            i++;
        }
        else if (token.type === lexer_1.TokenType.L_BRACKET) {
            i++; // Skip [
            const choiceNode = {
                type: ast_1.NodeType.CHOICE,
                options: []
            };
            while (i < tokens.length && tokens[i].type !== lexer_1.TokenType.R_BRACKET) {
                const optionResult = parseNodes(tokens, i, [lexer_1.TokenType.PIPE, lexer_1.TokenType.R_BRACKET], true);
                // Smart Whitespace Handling
                let optionNodes = optionResult.nodes;
                if (optionNodes.length > 0) {
                    // Trim Start
                    if (optionNodes[0].type === ast_1.NodeType.TEXT) {
                        optionNodes[0].value = optionNodes[0].value.trimStart();
                        if (optionNodes[0].value.length === 0) {
                            optionNodes.shift(); // Remove empty node
                        }
                    }
                }
                if (optionNodes.length > 0) {
                    // Trim End
                    const lastIdx = optionNodes.length - 1;
                    if (optionNodes[lastIdx].type === ast_1.NodeType.TEXT) {
                        optionNodes[lastIdx].value = optionNodes[lastIdx].value.trimEnd();
                        if (optionNodes[lastIdx].value.length === 0) {
                            optionNodes.pop(); // Remove empty node
                        }
                    }
                }
                choiceNode.options.push(optionNodes);
                i = optionResult.nextIndex;
                if (i < tokens.length && tokens[i].type === lexer_1.TokenType.PIPE) {
                    i++; // Skip |
                }
            }
            if (i < tokens.length && tokens[i].type === lexer_1.TokenType.R_BRACKET) {
                i++; // Skip ]
            }
            nodes.push(choiceNode);
        }
        else if (token.type === lexer_1.TokenType.VARIABLE) {
            nodes.push({ type: ast_1.NodeType.VARIABLE_REF, value: token.value });
            i++;
        }
        else if (token.type === lexer_1.TokenType.SPLAT) {
            if (i + 1 < tokens.length && tokens[i + 1].type === lexer_1.TokenType.VARIABLE) {
                nodes.push({ type: ast_1.NodeType.SPLAT_REF, value: tokens[i + 1].value });
                i += 2;
            }
            else {
                nodes.push({ type: ast_1.NodeType.TEXT, value: '*' });
                i++;
            }
        }
        else if (token.type === lexer_1.TokenType.FLAG) {
            nodes.push({ type: ast_1.NodeType.FLAG, value: token.value });
            i++;
        }
        else if (token.type === lexer_1.TokenType.INTERPOLATION) {
            nodes.push({ type: ast_1.NodeType.INTERPOLATION, value: token.value });
            i++;
        }
        else {
            nodes.push({ type: ast_1.NodeType.TEXT, value: token.value });
            i++;
        }
    }
    return { nodes, nextIndex: i };
}
//# sourceMappingURL=parser.js.map