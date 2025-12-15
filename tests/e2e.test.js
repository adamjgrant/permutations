"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const engine_1 = require("../src/engine/engine");
describe('End-to-End', () => {
    let engine;
    beforeEach(() => {
        engine = new engine_1.Engine();
    });
    test('Master Script Execution', () => {
        const script = `
        // 1. SETUP
        // ---------------------------------------------------------
        // JS Interpolation used for static variable definition
        year=#{ new Date().getFullYear() }
        greetings = [ Hello | Hi ]
        names = [ World | Friend ]
        line_1 = $greetings $names
        line_2 = Excuse me, [ what #qu | that ] is really neat #{ qu ? "?" : "." }
        line_3 = I will have the [ steak #meat | salad ] #{ meat && "(Medium Rare)" }
        
        list_a = [ A | B ]
        list_b = [ Y | Z ]
        line_4 = [ *$list_a | *$list_b | Others [ 1 | 2 ] ]
        
        main = [
            $line_1 |
            $line_2 |
            $line_3 |
            $line_4
        ] -- Copyright $year
      `;
        engine.compile(script);
        const result = engine.generate('main');
        expect(result).toBeTruthy();
        expect(result).toContain('-- Copyright ' + new Date().getFullYear());
    });
});
//# sourceMappingURL=e2e.test.js.map