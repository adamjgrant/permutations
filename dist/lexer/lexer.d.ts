export declare enum TokenType {
    TEXT = 0,
    L_BRACKET = 1,
    R_BRACKET = 2,
    PIPE = 3,
    HASH = 4,
    DOLLAR = 5,
    VARIABLE = 6,
    SPLAT = 7,
    FLAG = 8,
    INTERPOLATION = 9
}
export interface Token {
    type: TokenType;
    value: string;
}
export declare function tokenize(input: string): Token[];
//# sourceMappingURL=lexer.d.ts.map