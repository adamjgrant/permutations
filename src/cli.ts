#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { Engine } from './engine/engine';

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
    const engine = new Engine();

    engine.compile(script, path.dirname(absoluteFilePath));
    const result = engine.generate(entryPoint);

    // console.log(JSON.stringify(result)); // DEBUG: Show exact chars
    console.log(result);
  } catch (error: any) {
    console.error('Error executing script:', error.message);
    process.exit(1);
  }
}

main();
