import * as fs from 'fs';
import * as path from 'path';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { NodeType } from '../parser/ast';
import type { Node, AssignmentNode, ChoiceNode, FlagNode, InterpolationNode, ImportNode } from '../parser/ast';

interface Context {
  flags: Set<string>;
  variables: Map<string, Node[]>; // Variable ASTs
  jsContext: any; // For interpolation
}

export class Engine {
  private variables: Map<string, Node[]> = new Map();
  private jsContext: any = {};
  private loadedModules: Set<string> = new Set(); // To prevent cycles

  compile(script: string, baseDir?: string) {
    const tokens = tokenize(script);
    const root = parse(tokens);

    if (root.children) {
      for (const node of root.children) {
        if (node.type === NodeType.ASSIGNMENT) {
          const assignment = node as AssignmentNode;
          this.variables.set(assignment.variableName, assignment.expression);
        } else if (node.type === NodeType.IMPORT) {
          this.handleImport(node as ImportNode, baseDir);
        }
      }
    }
  }

  private handleImport(node: ImportNode, baseDir?: string) {
    if (!baseDir) {
      console.warn('Warning: No base directory provided. skipping import:', node.module);
      return;
    }

    let targetPath = path.join(baseDir, node.module);
    // implicit extension
    if (!fs.existsSync(targetPath) && fs.existsSync(targetPath + '.perm')) {
      targetPath += '.perm';
    }

    const absolutePath = path.resolve(targetPath);

    if (this.loadedModules.has(absolutePath)) {
      return; // Already loaded (cycle or repeated import)
    }
    this.loadedModules.add(absolutePath);

    if (!fs.existsSync(absolutePath)) {
      console.error(`Error: Module not found: ${node.module} (at ${absolutePath})`);
      return;
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');

    // Recursive compile
    // We create a temporary engine or just use this one?
    // If we use 'this', variables are merged into the SAME map.
    // This matches "from ... import *" behavior where everything goes into global scope.
    // But we need to handle "named imports".

    // Strategy:
    // Compile the module into a SEPARATE variable map.
    // Then copy only requested variables.

    const moduleEngine = new Engine();
    // Share loadedModules to prevent global cycles across engines
    moduleEngine.loadedModules = this.loadedModules;
    moduleEngine.compile(content, path.dirname(absolutePath));

    // Now merge
    if (node.names.includes('*')) {
      // Import ALL
      for (const [key, value] of moduleEngine.variables) {
        this.variables.set(key, value);
      }
    } else {
      // Import specified
      for (const name of node.names) {
        const value = moduleEngine.variables.get(name);
        if (value) {
          this.variables.set(name, value);
        } else {
          console.warn(`Warning: Imported variable '${name}' not found in module '${node.module}'`);
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
