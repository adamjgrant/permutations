
import { parse } from '../src/parser/parser';
import { NodeType } from '../src/parser/ast';
import { tokenize } from '../src/lexer/lexer';

describe('Parser', () => {
  test('parses simple text', () => {
    const tokens = tokenize('Hello World');
    const ast = parse(tokens);
    expect(ast).toEqual({
      type: NodeType.ROOT,
      children: [
        { type: NodeType.TEXT, value: 'Hello World' }
      ]
    });
  });

  test('parses simple choice', () => {
    const tokens = tokenize('[ A | B ]');
    const ast = parse(tokens);
    expect(ast.children).toHaveLength(1);
    expect(ast.children[0].type).toBe(NodeType.CHOICE);
    expect((ast.children[0] as any).options).toHaveLength(2);
  });

  test('parses nested choice', () => {
    const tokens = tokenize('[ A | B [ C | D ] ]');
    const ast = parse(tokens);
    expect(ast.children[0].type).toBe(NodeType.CHOICE);
    // Deep check can be added as we implement the structure
  });

  test('parses variable definition', () => {
    const tokens = tokenize('greeting = [ Hi | Hello ]');
    const ast = parse(tokens);
    expect(ast.children[0].type).toBe(NodeType.ASSIGNMENT);
    expect((ast.children[0] as any).variableName).toBe('greeting');
  });
});
