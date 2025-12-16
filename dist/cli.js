#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const engine_1 = require("./engine/engine");
function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: perm <file> [entryPoint]');
        process.exit(1);
    }
    const filePath = args[0];
    const entryPoint = args[1] || 'main';
    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
    }
    try {
        const absoluteFilePath = path.resolve(filePath);
        const script = fs.readFileSync(absoluteFilePath, 'utf-8');
        const engine = new engine_1.Engine();
        engine.compile(script, path.dirname(absoluteFilePath));
        const result = engine.generate(entryPoint);
        console.log(result);
    }
    catch (error) {
        console.error('Error executing script:', error.message);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=cli.js.map