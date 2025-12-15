import { tokenize } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';
import { NodeType } from '../parser/ast.js';
export class Engine {
    variables = new Map();
    jsContext = {};
    compile(script) {
        const tokens = tokenize(script);
        const root = parse(tokens);
        if (root.children) {
            for (const node of root.children) {
                if (node.type === NodeType.ASSIGNMENT) {
                    const assignment = node;
                    this.variables.set(assignment.variableName, assignment.expression);
                }
            }
        }
    }
    generate(entryPoint) {
        const roots = this.variables.get(entryPoint);
        if (!roots) {
            throw new Error(`Entry point ${entryPoint} not found`);
        }
        // Initialize Context
        const context = {
            flags: new Set(),
            variables: this.variables,
            jsContext: { ...this.jsContext }
        };
        return this.evaluateNodes(roots, context);
    }
    evaluateNodes(nodes, context) {
        let result = '';
        for (const node of nodes) {
            result += this.evaluateNode(node, context);
        }
        return result;
    }
    evaluateNode(node, context) {
        switch (node.type) {
            case NodeType.TEXT:
                return node.value || '';
            case NodeType.CHOICE:
                return this.evaluateChoice(node, context);
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
                return this.evaluateInterpolation(node, context);
            case NodeType.ASSIGNMENT:
                return '';
            default:
                return '';
        }
    }
    evaluateChoice(node, context) {
        if (node.options.length === 0)
            return '';
        const effectiveOptions = [];
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
                    const targetChoice = refNodes[0];
                    effectiveOptions.push(...targetChoice.options);
                }
                else {
                    effectiveOptions.push(option);
                }
            }
            else {
                effectiveOptions.push(option);
            }
        }
        if (effectiveOptions.length === 0)
            return '';
        const randomIndex = Math.floor(Math.random() * effectiveOptions.length);
        const selectedOption = effectiveOptions[randomIndex];
        return this.evaluateNodes(selectedOption, context);
    }
    evaluateInterpolation(node, context) {
        const code = node.value || '';
        try {
            // RegEx to find words in `code` and define them as undefined if not in flags
            const identifiers = new Set();
            const matcher = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
            let match;
            while ((match = matcher.exec(code)) !== null) {
                identifiers.add(match[0]);
            }
            // Remove keywords
            const keywords = ['true', 'false', 'null', 'undefined', 'new', 'Date', 'Math'];
            for (const kw of keywords)
                identifiers.delete(kw);
            const params = Array.from(identifiers);
            const values = params.map(p => context.flags.has(p) ? true : undefined);
            const func = new Function(...params, 'return ' + code);
            const result = func(...values);
            if (typeof result === 'object' && result !== null) {
                return '';
            }
            if (result === undefined || result === null)
                return '';
            return String(result);
        }
        catch (e) {
            console.error('Interpolation error:', e);
            return '[Error]';
        }
    }
}
//# sourceMappingURL=engine.js.map