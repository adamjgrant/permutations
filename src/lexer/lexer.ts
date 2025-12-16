

export enum TokenType {
  TEXT,
  L_BRACKET,
  R_BRACKET,
  PIPE,
  DOLLAR,
  VARIABLE,
  SPLAT,
  FLAG,
  INTERPOLATION,
  STAR
}

export interface Token {
  type: TokenType;
  value: string;
}



export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (char === '[') {
      tokens.push({ type: TokenType.L_BRACKET, value: '[' });
      i++;
    } else if (char === ']') {
      tokens.push({ type: TokenType.R_BRACKET, value: ']' });
      i++;
    } else if (char === '|') {
      tokens.push({ type: TokenType.PIPE, value: '|' });
      i++;
    } else if (char === '*' && (i + 1 < input.length) && input[i + 1] === '$') { // Check for splat before var
      tokens.push({ type: TokenType.SPLAT, value: '*' });
      i++;
    } else if (char === '*') {
      tokens.push({ type: TokenType.STAR, value: '*' });
      i++;
    } else if (char === '$') {
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
        } else if (nextChar === '{') {
          // Interpolation: ${ ... }
          i += 2; // Skip ${
          let code = '';
          let depth = 1;
          while (i < input.length && depth > 0) {
            if (input[i] === '{') depth++;
            if (input[i] === '}') depth--;
            if (depth > 0) {
              code += input[i];
              i++;
            }
          }
          tokens.push({ type: TokenType.INTERPOLATION, value: code });
          i++; // Skip final }
          continue;
        } else if (/[a-zA-Z0-9_]/.test(nextChar)) {
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

    } else if (char === '#') {
      // Comment: Consume until newline
      while (i < input.length && input[i] !== '\n') {
        i++;
      }
      // Do NOT emit token
    } else {
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
