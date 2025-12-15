"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lexer_1 = require("../src/lexer/lexer");
describe('Lexer', () => {
    test('identifies simple text', () => {
        const tokens = (0, lexer_1.tokenize)('Hello World');
        expect(tokens).toEqual([
            { type: lexer_1.TokenType.TEXT, value: 'Hello World' }
        ]);
    });
    test('identifies magic characters', () => {
        const tokens = (0, lexer_1.tokenize)('[]|#$');
        expect(tokens).toEqual([
            { type: lexer_1.TokenType.L_BRACKET, value: '[' },
            { type: lexer_1.TokenType.R_BRACKET, value: ']' },
            { type: lexer_1.TokenType.PIPE, value: '|' },
            { type: lexer_1.TokenType.HASH, value: '#' },
            { type: lexer_1.TokenType.DOLLAR, value: '$' },
        ]);
    });
    test('identifies variable references', () => {
        const tokens = (0, lexer_1.tokenize)('$varName');
        expect(tokens).toEqual([
            { type: lexer_1.TokenType.VARIABLE, value: 'varName' }
        ]);
    });
    test('identifies variable references with splat', () => {
        const tokens = (0, lexer_1.tokenize)('*$varName');
        expect(tokens).toEqual([
            { type: lexer_1.TokenType.SPLAT, value: '*' },
            { type: lexer_1.TokenType.VARIABLE, value: 'varName' }
        ]);
    });
    test('identifies flags', () => {
        const tokens = (0, lexer_1.tokenize)('#formal');
        expect(tokens).toEqual([
            { type: lexer_1.TokenType.FLAG, value: 'formal' }
        ]);
    });
    test('identifies interpolation', () => {
        const tokens = (0, lexer_1.tokenize)('#{ 1 + 1 }');
        expect(tokens).toEqual([
            { type: lexer_1.TokenType.INTERPOLATION, value: ' 1 + 1 ' }
        ]);
    });
    test('handles mixed content', () => {
        const input = 'Hello [ World | Friend ]';
        const tokens = (0, lexer_1.tokenize)(input);
        expect(tokens).toEqual([
            { type: lexer_1.TokenType.TEXT, value: 'Hello ' },
            { type: lexer_1.TokenType.L_BRACKET, value: '[' },
            { type: lexer_1.TokenType.TEXT, value: ' World ' },
            { type: lexer_1.TokenType.PIPE, value: '|' },
            { type: lexer_1.TokenType.TEXT, value: ' Friend ' },
            { type: lexer_1.TokenType.R_BRACKET, value: ']' },
        ]);
    });
    test('identifies empty choice start', () => {
        const tokens = (0, lexer_1.tokenize)('[|');
        expect(tokens).toEqual([
            { type: lexer_1.TokenType.L_BRACKET, value: '[' },
            { type: lexer_1.TokenType.PIPE, value: '|' }
        ]);
    });
});
//# sourceMappingURL=lexer.test.js.map