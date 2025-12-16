export declare enum TokenType {
    TEXT = 0,
    L_BRACKET = 1,
    R_BRACKET = 2,
    PIPE = 3,
    DOLLAR = 4,
    VARIABLE = 5,
    SPLAT = 6,
    FLAG = 7,
    INTERPOLATION = 8,
    STAR = 9
}
export interface Token {
    type: TokenType;
    value: string;
}
export declare function tokenize(input: string): Token[];
//# sourceMappingURL=lexer.d.ts.map