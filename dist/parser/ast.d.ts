export declare enum NodeType {
    ROOT = 0,
    TEXT = 1,
    CHOICE = 2,
    ASSIGNMENT = 3,
    VARIABLE_REF = 4,
    SPLAT_REF = 5,
    FLAG = 6,
    INTERPOLATION = 7,
    IMPORT = 8
}
export interface Node {
    type: NodeType;
    value?: string;
    children?: Node[];
}
export interface ChoiceNode extends Node {
    type: NodeType.CHOICE;
    options: Node[][];
}
export interface AssignmentNode extends Node {
    type: NodeType.ASSIGNMENT;
    variableName: string;
    expression: Node[];
}
export interface VariableRefNode extends Node {
    type: NodeType.VARIABLE_REF;
    value: string;
}
export interface SplatRefNode extends Node {
    type: NodeType.SPLAT_REF;
    value: string;
}
export interface FlagNode extends Node {
    type: NodeType.FLAG;
    value: string;
}
export interface InterpolationNode extends Node {
    type: NodeType.INTERPOLATION;
    value: string;
}
export interface ImportNode extends Node {
    type: NodeType.IMPORT;
    module: string;
    names: string[];
}
//# sourceMappingURL=ast.d.ts.map