
export enum NodeType {
  ROOT,
  TEXT,
  CHOICE,
  ASSIGNMENT,
  VARIABLE_REF,
  SPLAT_REF,
  FLAG,
  INTERPOLATION,
  IMPORT
}

export interface Node {
  type: NodeType;
  value?: string;
  children?: Node[];
}

export interface ChoiceNode extends Node {
  type: NodeType.CHOICE;
  options: Node[][]; // Each option is a list of nodes (a sentence)
}

export interface AssignmentNode extends Node {
  type: NodeType.ASSIGNMENT;
  variableName: string;
  expression: Node[]; // The value being assigned (usually a choice block)
}

export interface VariableRefNode extends Node {
  type: NodeType.VARIABLE_REF;
  value: string; // The variable name
}

export interface SplatRefNode extends Node {
  type: NodeType.SPLAT_REF;
  value: string; // The variable name for splat
}

export interface FlagNode extends Node {
  type: NodeType.FLAG;
  value: string; // The flag name
}

export interface InterpolationNode extends Node {
  type: NodeType.INTERPOLATION;
  value: string; // The content inside #{}
}

export interface ImportNode extends Node {
  type: NodeType.IMPORT;
  module: string;
  names: string[]; // ["*"] or list of names
}
