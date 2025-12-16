"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Engine = void 0;
const fs = require("fs");
const path = require("path");
const lexer_1 = require("../lexer/lexer");
const parser_1 = require("../parser/parser");
const ast_1 = require("../parser/ast");
class Engine {
    constructor() {
        this.variables = new Map();
        this.jsContext = {};
        this.loadedModules = new Set(); // To prevent cycles
    }
    compile(script, baseDir) {
        const tokens = (0, lexer_1.tokenize)(script);
        const root = (0, parser_1.parse)(tokens);
        if (root.children) {
            for (const node of root.children) {
                if (node.type === ast_1.NodeType.ASSIGNMENT) {
                    const assignment = node;
                    this.variables.set(assignment.variableName, assignment.expression);
                }
                else if (node.type === ast_1.NodeType.IMPORT) {
                    this.handleImport(node, baseDir);
                }
            }
        }
    }
    handleImport(node, baseDir) {
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
        }
        else {
            // Import specified
            for (const name of node.names) {
                const value = moduleEngine.variables.get(name);
                if (value) {
                    this.variables.set(name, value);
                }
                else {
                    console.warn(`Warning: Imported variable '${name}' not found in module '${node.module}'`);
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
            case ast_1.NodeType.TEXT:
                return node.value || '';
            case ast_1.NodeType.CHOICE:
                return this.evaluateChoice(node, context);
            case ast_1.NodeType.VARIABLE_REF:
                const refName = node.value || '';
                const refNodes = this.variables.get(refName);
                if (refNodes) {
                    return this.evaluateNodes(refNodes, context);
                }
                return `[Missing: $${refName}]`;
            case ast_1.NodeType.SPLAT_REF:
                const splatName = node.value || '';
                const splatNodes = this.variables.get(splatName);
                if (splatNodes) {
                    return this.evaluateNodes(splatNodes, context);
                }
                return '';
            case ast_1.NodeType.FLAG:
                // #flagName
                const flagName = node.value || '';
                context.flags.add(flagName);
                return ''; // No output
            case ast_1.NodeType.INTERPOLATION:
                return this.evaluateInterpolation(node, context);
            case ast_1.NodeType.ASSIGNMENT:
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
            if (option.length === 1 && option[0].type === ast_1.NodeType.SPLAT_REF) {
                isSplat = true;
                const refName = option[0].value || '';
                const refNodes = this.variables.get(refName);
                if (refNodes && refNodes.length === 1 && refNodes[0].type === ast_1.NodeType.CHOICE) {
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
exports.Engine = Engine;
//# sourceMappingURL=engine.js.map