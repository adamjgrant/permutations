import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { NodeType } from '../parser/ast';
import type { Node, AssignmentNode, ChoiceNode, FlagNode, InterpolationNode } from '../parser/ast';

interface Context {
  flags: Set<string>;
  variables: Map<string, Node[]>; // Variable ASTs
  jsContext: any; // For interpolation
}

export class Engine {
  private variables: Map<string, Node[]> = new Map();
  private jsContext: any = {};

  compile(script: string) {



    const tokens = tokenize(script);
    const root = parse(tokens);

    if (root.children) {
      for (const node of root.children) {
        if (node.type === NodeType.ASSIGNMENT) {
          const assignment = node as AssignmentNode;
          this.variables.set(assignment.variableName, assignment.expression);
        }
      }
    }
  }

  generate(entryPoint: string): string {
    const roots = this.variables.get(entryPoint);
    if (!roots) {
      throw new Error(`Entry point ${entryPoint} not found`);
    }

    // Initialize Context
    const context: Context = {
      flags: new Set(),
      variables: this.variables,
      jsContext: { ...this.jsContext }
    };

    return this.evaluateNodes(roots, context);
  }

  private evaluateNodes(nodes: Node[], context: Context): string {
    let result = '';

    for (const node of nodes) {
      result += this.evaluateNode(node, context);
    }

    return result;
  }

  private evaluateNode(node: Node, context: Context): string {
    switch (node.type) {
      case NodeType.TEXT:
        return node.value || '';

      case NodeType.CHOICE:
        return this.evaluateChoice(node as ChoiceNode, context);

      case NodeType.VARIABLE_REF:
        const refName = node.value || '';
        const refNodes = this.variables.get(refName);
        if (refNodes) {
          return this.evaluateNodes(refNodes, context);
        }
        return `[Missing: $${refName}]`;

      case NodeType.SPLAT_REF:
        const splatName = node.value || '';
        const splatNodes = this.variables.get(splatName);
        if (splatNodes) {
          return this.evaluateNodes(splatNodes, context);
        }
        return '';

      case NodeType.FLAG:
        // #flagName
        const flagName = node.value || '';
        context.flags.add(flagName);
        return ''; // No output

      case NodeType.INTERPOLATION:
        return this.evaluateInterpolation(node as InterpolationNode, context);

      case NodeType.ASSIGNMENT:
        return '';

      default:
        return '';
    }
  }

  private evaluateChoice(node: ChoiceNode, context: Context): string {
    if (node.options.length === 0) return '';

    const effectiveOptions: Node[][] = [];

    for (const option of node.options) {
      // Check if option is a splat
      let isSplat = false;
      // Check if option contains ONLY a splat ref?
      // "option" is a list of nodes.
      if (option.length === 1 && option[0].type === NodeType.SPLAT_REF) {
        isSplat = true;
        const refName = option[0].value || '';
        const refNodes = this.variables.get(refName);

        if (refNodes && refNodes.length === 1 && refNodes[0].type === NodeType.CHOICE) {
          const targetChoice = refNodes[0] as ChoiceNode;
          effectiveOptions.push(...targetChoice.options);
        } else {
          effectiveOptions.push(option);
        }
      } else {
        effectiveOptions.push(option);
      }
    }

    if (effectiveOptions.length === 0) return '';

    const randomIndex = Math.floor(Math.random() * effectiveOptions.length);
    const selectedOption = effectiveOptions[randomIndex];

    return this.evaluateNodes(selectedOption, context);
  }

  private evaluateInterpolation(node: InterpolationNode, context: Context): string {
    const code = node.value || '';

    try {
      // RegEx to find words in `code` and define them as undefined if not in flags
      const identifiers = new Set<string>();
      const matcher = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
      let match;
      while ((match = matcher.exec(code)) !== null) {
        identifiers.add(match[0]);
      }
      // Remove keywords
      const keywords = ['true', 'false', 'null', 'undefined', 'new', 'Date', 'Math'];
      for (const kw of keywords) identifiers.delete(kw);

      const params = Array.from(identifiers);
      const values = params.map(p => context.flags.has(p) ? true : undefined);

      const func = new Function(...params, 'return ' + code);
      const result = func(...values);

      if (typeof result === 'object' && result !== null) {
        return '';
      }

      if (result === undefined || result === null) return '';
      return String(result);

    } catch (e) {
      console.error('Interpolation error:', e);
      return '[Error]';
    }
  }
}
