
import { tokenize, TokenType } from '../src/lexer/lexer';

describe('Lexer', () => {
  test('identifies simple text', () => {
    const tokens = tokenize('Hello World');
    expect(tokens).toEqual([
      { type: TokenType.TEXT, value: 'Hello World' }
    ]);
  });


  test('identifies magic characters', () => {
    const tokens = tokenize('[]|$');
    expect(tokens).toEqual([
      { type: TokenType.L_BRACKET, value: '[' },
      { type: TokenType.R_BRACKET, value: ']' },
      { type: TokenType.PIPE, value: '|' },
      { type: TokenType.DOLLAR, value: '$' },
    ]);
  });

  test('identifies variable references', () => {
    const tokens = tokenize('$varName');
    expect(tokens).toEqual([
      { type: TokenType.VARIABLE, value: 'varName' }
    ]);
  });

  test('identifies variable references with splat', () => {
    const tokens = tokenize('*$varName');
    expect(tokens).toEqual([
      { type: TokenType.SPLAT, value: '*' },
      { type: TokenType.VARIABLE, value: 'varName' }
    ]);
  });

  test('identifies flags', () => {
    const tokens = tokenize('$$formal');
    expect(tokens).toEqual([
      { type: TokenType.FLAG, value: 'formal' }
    ]);
  });

  test('identifies interpolation', () => {
    const tokens = tokenize('${ 1 + 1 }');
    expect(tokens).toEqual([
      { type: TokenType.INTERPOLATION, value: ' 1 + 1 ' }
    ]);
  });

  test('ignores comments', () => {
    const tokens = tokenize('# This is a comment\nNext');
    expect(tokens).toEqual([
      { type: TokenType.TEXT, value: '\nNext' }
    ]);
  });


  test('handles mixed content', () => {
    const input = 'Hello [ World | Friend ]';
    const tokens = tokenize(input);
    expect(tokens).toEqual([
      { type: TokenType.TEXT, value: 'Hello ' },
      { type: TokenType.L_BRACKET, value: '[' },
      { type: TokenType.TEXT, value: ' World ' },
      { type: TokenType.PIPE, value: '|' },
      { type: TokenType.TEXT, value: ' Friend ' },
      { type: TokenType.R_BRACKET, value: ']' },
    ]);
  });

  test('identifies empty choice start', () => {
    const tokens = tokenize('[|');
    expect(tokens).toEqual([
      { type: TokenType.L_BRACKET, value: '[' },
      { type: TokenType.PIPE, value: '|' }
    ]);
  });
});
