"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const engine_1 = require("../src/engine/engine");
describe('Feature Edge Cases', () => {
    let engine;
    beforeEach(() => {
        engine = new engine_1.Engine();
    });
    test('Mixed Splats (Options + Splat)', () => {
        // Tests mixing explicit choices with a splat
        const script = `
        colors = [ Red | Blue ]
        mix = [ Green | *$colors | Yellow ]
        main = $mix
    `;
        engine.compile(script);
        // Expected outcomes: Green, Red, Blue, Yellow
        // (Assuming equal probability is NOT required by simple spec, just possibility)
        const results = new Set();
        for (let i = 0; i < 100; i++) {
            results.add(engine.generate('main').trim());
        }
        expect(results.has('Green')).toBe(true);
        expect(results.has('Red')).toBe(true);
        expect(results.has('Blue')).toBe(true);
        expect(results.has('Yellow')).toBe(true);
        expect(results.size).toBe(4);
    });
    test('Deep Nesting Execution', () => {
        // Tests deeply nested choices
        const script = `
        main = [ A | [ B | [ C | D ] ] ]
    `;
        engine.compile(script);
        const results = new Set();
        for (let i = 0; i < 100; i++) {
            results.add(engine.generate('main').trim());
        }
        expect(results.has('A')).toBe(true);
        expect(results.has('B')).toBe(true);
        expect(results.has('C')).toBe(true);
        expect(results.has('D')).toBe(true);
    });
    test('Empty Options / Whitespace Literals', () => {
        // Tests blank choices or choices with only whitespace
        const script = `

        // First option is empty text (using [|...])
        // Second option is text "Space"
        choice = [| Space ]
        main = Start:$choice:End
    `;
        engine.compile(script);
        const results = new Set();
        for (let i = 0; i < 50; i++) {
            const res = engine.generate('main').trim();
            // Collapse multiple spaces to single space for reliable testing?
            // No, we want to verify empty option logic.
            results.add(res);
        }
        // "Start:" + "" + ":End" -> "Start::End"
        // "Start:" + " Space " + ":End" -> "Start: Space :End"
        // DEBUG: Log output
        console.log('Test Output:', Array.from(results));
        expect(results.has('Start::End')).toBe(true);
        expect(results.has('Start: Space :End')).toBe(true);
    });
    test('Nested Flag Scoping', () => {
        // Flags inside a nested choice should be visible to subsequent interpolation
        // "Left-to-Right" flow means if we traverse the branch with the flag, it sets.
        const script = `
        main = [ [ RouteA #flagA ] | RouteB ] : #{ flagA ? "GotA" : "NoA" }
    `;
        engine.compile(script);
        const results = new Set();
        for (let i = 0; i < 100; i++) {
            const res = engine.generate('main').replace(/\s+/g, ' ').trim();
            results.add(res);
        }
        expect(results.has('RouteA : GotA')).toBe(true);
        expect(results.has('RouteB : NoA')).toBe(true);
    });
    test('Non-existent Variable Handling', () => {
        // Reference to undefined variable
        const script = `
        main = Hello $stranger
      `;
        engine.compile(script);
        const result = engine.generate('main');
        // Spec typically implies it might error or show placeholder. 
        // Current implementation returns "[Missing: $stranger]"
        expect(result).toContain('[Missing: $stranger]');
    });
});
//# sourceMappingURL=features.test.js.map