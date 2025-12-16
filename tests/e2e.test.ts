
import { Engine } from '../src/engine/engine';

describe('End-to-End', () => {
  let engine: Engine;

  beforeEach(() => {
    engine = new Engine();
  });

  test('Master Script Execution', () => {
    const script = `

        # 1. SETUP
        # ---------------------------------------------------------
        # JS Interpolation used for static variable definition
        year=[ \${ new Date().getFullYear() } ]
        hello = [ Hello ]
        world = [ World | Galaxy ]
        line_1 = [ $hello $world ]
        line_2 = [ Excuse me, [ what $$qu | that ] is really neat \${ qu ? "?" : "." } ]
        line_3 = [ I will have the [ steak $$meat | salad ] \${ meat && "(Medium Rare)" } ]
        
        list_a = [ A | B ]
        list_b = [ Y | Z ]
        line_4 = [ *$list_a | *$list_b | Others ]
        a = [ A ]
        b = [ B ]
        main_alt = [ $a$b ]
        
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
