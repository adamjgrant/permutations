
import { Engine } from '../src/engine/engine';

describe('Whitespace Behavior Reproduction', () => {
  let engine: Engine;

  beforeEach(() => {
    engine = new Engine();
  });


  test('Docs: Whitespace Accumulation', () => {
    // Scenario 1: Loose matching (Standard)
    // Spaces are accumulated from assignments and choice options.
    const looseScript = [
      'greeting = [ Hello ]', // 1 space in assignment, 2 spaces in choice
      'name = [ stranger ]',
      'main = $greeting, $name!'
    ].join('\n');

    engine.compile(looseScript);
    const looseResult = engine.generate('main');

    // Logic:
    // main = ' ' (from "main = ")
    // $greeting = ' ' (from "greeting = ") + ' Hello ' (from "[ Hello ]")
    // Total before Hello: 2 spaces

    // $name = ' ' (from "name = ") + ' stranger ' (from "[ stranger ]")
    // Total before stranger from comma: 
    // ', ' (comma space) + ' ' (assignment) + ' stranger '
    // wait, assignment space for name is NOT included in $name reference, it's evaluated when defining $name?
    // No, "name = [ ... ]".
    // Value of name is " " + " stranger ".

    // So:
    // " " (main) + " " (greeting assign) + " Hello " (greeting val)
    // + ", " (text)
    // + " " (name assign) + " stranger " (name val)
    // + "!"

    // Expected: "  Hello ,   stranger !"
    // Note: 2 spaces before Hello, 3 spaces before stranger (1 comma, 1 assign, 1 val)

    // Let's verifying:
    // Loose result code likely matches this.
    expect(looseResult).toContain('  Hello ,   stranger !');
  });

  test('Docs: Clean Output', () => {
    // Scenario 2: Tight syntax
    const cleanScript = [
      'greeting=[Hello]',
      'name=[stranger]',
      'main=$greeting, $name!'
    ].join('\n');

    engine.compile(cleanScript);
    const cleanResult = engine.generate('main');

    // greeting = "Hello"
    // name = "stranger"
    // main = "Hello" + ", " + "stranger" + "!"

    expect(cleanResult).toBe('Hello, stranger!');
  });
});
