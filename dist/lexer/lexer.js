export var TokenType;
(function (TokenType) {
    TokenType[TokenType["TEXT"] = 0] = "TEXT";
    TokenType[TokenType["L_BRACKET"] = 1] = "L_BRACKET";
    TokenType[TokenType["R_BRACKET"] = 2] = "R_BRACKET";
    TokenType[TokenType["PIPE"] = 3] = "PIPE";
    TokenType[TokenType["HASH"] = 4] = "HASH";
    TokenType[TokenType["DOLLAR"] = 5] = "DOLLAR";
    TokenType[TokenType["VARIABLE"] = 6] = "VARIABLE";
    TokenType[TokenType["SPLAT"] = 7] = "SPLAT";
    TokenType[TokenType["FLAG"] = 8] = "FLAG";
    TokenType[TokenType["INTERPOLATION"] = 9] = "INTERPOLATION";
})(TokenType || (TokenType = {}));
export function tokenize(input) {
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
        else if (char === '$') {
            // Check if it's a variable or just a dollar sign
            if (i + 1 < input.length && /[a-zA-Z0-9_]/.test(input[i + 1])) {
                i++; // Skip $
                let varName = '';
                while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                    varName += input[i];
                    i++;
                }
                tokens.push({ type: TokenType.VARIABLE, value: varName });
            }
            else {
                tokens.push({ type: TokenType.DOLLAR, value: '$' });
                i++;
            }
        }
        else if (char === '#') {
            if ((i + 1 < input.length) && input[i + 1] === '{') {
                // Interpolation
                i += 2; // Skip #{
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
            }
            else {
                // Flag
                tokens.push({ type: TokenType.HASH, value: '#' });
                i++;
                // Check if it immediately follows with a name
                if (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                    let flagName = '';
                    while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                        flagName += input[i];
                        i++;
                    }
                    tokens.pop(); // Remove the #
                    tokens.push({ type: TokenType.FLAG, value: flagName });
                }
            }
        }
        else {
            // Text
            let text = '';
            // Accumulate text until special char
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