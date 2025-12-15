"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const parser_1 = require("../src/parser/parser");
const ast_1 = require("../src/parser/ast");
const lexer_1 = require("../src/lexer/lexer");
describe('Parser', () => {
    test('parses simple text', () => {
        const tokens = (0, lexer_1.tokenize)('Hello World');
        const ast = (0, parser_1.parse)(tokens);
        expect(ast).toEqual({
            type: ast_1.NodeType.ROOT,
            children: [
                { type: ast_1.NodeType.TEXT, value: 'Hello World' }
            ]
        });
    });
    test('parses simple choice', () => {
        const tokens = (0, lexer_1.tokenize)('[ A | B ]');
        const ast = (0, parser_1.parse)(tokens);
        expect(ast.children).toHaveLength(1);
        expect(ast.children[0].type).toBe(ast_1.NodeType.CHOICE);
        expect(ast.children[0].options).toHaveLength(2);
    });
    test('parses nested choice', () => {
        const tokens = (0, lexer_1.tokenize)('[ A | B [ C | D ] ]');
        const ast = (0, parser_1.parse)(tokens);
        expect(ast.children[0].type).toBe(ast_1.NodeType.CHOICE);
        // Deep check can be added as we implement the structure
    });
    test('parses variable definition', () => {
        const tokens = (0, lexer_1.tokenize)('greeting = [ Hi | Hello ]');
        const ast = (0, parser_1.parse)(tokens);
        expect(ast.children[0].type).toBe(ast_1.NodeType.ASSIGNMENT);
        expect(ast.children[0].variableName).toBe('greeting');
    });
});
//# sourceMappingURL=parser.test.js.map