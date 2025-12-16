"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenType = void 0;
exports.tokenize = tokenize;
var TokenType;
(function (TokenType) {
    TokenType[TokenType["TEXT"] = 0] = "TEXT";
    TokenType[TokenType["L_BRACKET"] = 1] = "L_BRACKET";
    TokenType[TokenType["R_BRACKET"] = 2] = "R_BRACKET";
    TokenType[TokenType["PIPE"] = 3] = "PIPE";
    TokenType[TokenType["DOLLAR"] = 4] = "DOLLAR";
    TokenType[TokenType["VARIABLE"] = 5] = "VARIABLE";
    TokenType[TokenType["SPLAT"] = 6] = "SPLAT";
    TokenType[TokenType["FLAG"] = 7] = "FLAG";
    TokenType[TokenType["INTERPOLATION"] = 8] = "INTERPOLATION";
    TokenType[TokenType["STAR"] = 9] = "STAR";
})(TokenType || (exports.TokenType = TokenType = {}));
function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
        const char = input[i];
        if (char === '[') {
            tokens.push({ type: TokenType.L_BRACKET, value: '[' });
            i++;
        }
        else if (char === ']') {
            tokens.push({ type: TokenType.R_BRACKET, value: ']' });
            i++;
        }
        else if (char === '|') {
            tokens.push({ type: TokenType.PIPE, value: '|' });
            i++;
        }
        else if (char === '*' && (i + 1 < input.length) && input[i + 1] === '$') { // Check for splat before var
            tokens.push({ type: TokenType.SPLAT, value: '*' });
            i++;
        }
        else if (char === '*') {
            tokens.push({ type: TokenType.STAR, value: '*' });
            i++;
        }
        else if (char === '$') {
            // Check for Logic ($$) or Interpolation (${) or Variable ($var)
            if (i + 1 < input.length) {
                const nextChar = input[i + 1];
                if (nextChar === '$') {
                    // Flag: $$flagName
                    i += 2; // Skip $$
                    let flagName = '';
                    while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                        flagName += input[i];
                        i++;
                    }
                    tokens.push({ type: TokenType.FLAG, value: flagName });
                    continue;
                }
                else if (nextChar === '{') {
                    // Interpolation: ${ ... }
                    i += 2; // Skip ${
                    let code = '';
                    let depth = 1;
                    while (i < input.length && depth > 0) {
                        if (input[i] === '{')
                            depth++;
                        if (input[i] === '}')
                            depth--;
                        if (depth > 0) {
                            code += input[i];
                            i++;
                        }
                    }
                    tokens.push({ type: TokenType.INTERPOLATION, value: code });
                    i++; // Skip final }
                    continue;
                }
                else if (/[a-zA-Z0-9_]/.test(nextChar)) {
                    // Variable: $varName
                    i++; // Skip $
                    let varName = '';
                    while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                        varName += input[i];
                        i++;
                    }
                    tokens.push({ type: TokenType.VARIABLE, value: varName });
                    continue;
                }
            }
            // Fallback: Just a dollar sign
            tokens.push({ type: TokenType.DOLLAR, value: '$' });
            i++;
        }
        else if (char === '#') {
            // Comment: Consume until newline
            while (i < input.length && input[i] !== '\n') {
                i++;
            }
            // Do NOT emit token
        }
        else {
            // Text
            let text = '';
            // Accumulate text until special char
            // Special chars: [, ], |, $, #, *
            while (i < input.length && !['[', ']', '|', '$', '#', '*'].includes(input[i])) {
                text += input[i];
                i++;
            }
            if (text.length > 0) {
                tokens.push({ type: TokenType.TEXT, value: text });
            }
        }
    }
    return tokens;
}
//# sourceMappingURL=lexer.js.map