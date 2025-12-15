import { TokenType } from '../lexer/lexer';
import type { Token } from '../lexer/lexer';
import { NodeType } from './ast';
import type {
  Node,
  ChoiceNode,
  AssignmentNode,
  VariableRefNode,
  SplatRefNode,
  FlagNode,
  InterpolationNode
} from './ast.js';

export function parse(tokens: Token[]): Node {
  const root: Node = { type: NodeType.ROOT, children: [] };
  let current = 0;

  while (current < tokens.length) {
    // Top level parsing: stopOnAssignment = false (consume them)
    const result = parseNodes(tokens, current, [], false);

    if (result.nodes.length > 0) {
      root.children = (root.children || []).concat(result.nodes);
    }

    const prevCurrent = current;
    current = result.nextIndex;

    if (current === prevCurrent && current < tokens.length) {
      break;
    }

    if (current >= tokens.length) {
      break;
    }
  }

  return root;
}

function parseNodes(
  tokens: Token[],
  startIndex: number,
  stopAt: TokenType[] = [],
  stopOnAssignment: boolean = false
): { nodes: Node[], nextIndex: number } {
  const nodes: Node[] = [];
  let i = startIndex;

  while (i < tokens.length) {
    const token = tokens[i];

    if (stopAt.includes(token.type)) {
      break;
    }

    if (token.type === TokenType.TEXT) {
      const eqIndex = token.value.indexOf('=');
      let isAssignment = false;
      let varName = '';
      let prefixText = '';

      if (eqIndex !== -1 && stopAt.length === 0) {
        const rawPreText = token.value.substring(0, eqIndex);

        // assignments usually follow a newline or start of file
        const lastNewline = rawPreText.lastIndexOf('\n');
        let candidateName = rawPreText;

        if (lastNewline !== -1) {
          // Potential assignment is after the newline
          prefixText = rawPreText.substring(0, lastNewline + 1);
          candidateName = rawPreText.substring(lastNewline + 1);
        }

        const trimmedName = candidateName.trim();
        // Check validity
        if (trimmedName.length > 0 && /^[a-zA-Z0-9_]+$/.test(trimmedName)) {
          isAssignment = true;
          varName = trimmedName;
        }
      }

      if (isAssignment) {
        if (stopOnAssignment) {
          // We found an assignment but we are supposed to stop.
          // Do NOT consume. Return.
          break;
        } else {
          // Parse the assignment
          // If we split the token (due to newlines), push the prefix first
          if (prefixText.length > 0) {
            nodes.push({ type: NodeType.TEXT, value: prefixText });
          }

          const assignment: AssignmentNode = {
            type: NodeType.ASSIGNMENT,
            variableName: varName,
            expression: []
          };

          // Handle text after "=" in the same token
          const postText = token.value.substring(eqIndex + 1);
          if (postText.length > 0) {
            assignment.expression.push({ type: NodeType.TEXT, value: postText });
          }

          i++; // Consume the TEXT containing "="

          // Parse the rest as the expression
          // Expression should STOP on next assignment.
          const result = parseNodes(tokens, i, stopAt, true);
          assignment.expression = assignment.expression.concat(result.nodes);
          nodes.push(assignment);
          i = result.nextIndex;
          continue;
        }
      }

      nodes.push({ type: NodeType.TEXT, value: token.value });
      i++;
    } else if (token.type === TokenType.L_BRACKET) {
      i++; // Skip [
      const choiceNode: ChoiceNode = {
        type: NodeType.CHOICE,
        options: []
      };

      while (i < tokens.length && tokens[i].type !== TokenType.R_BRACKET) {
        const optionResult = parseNodes(tokens, i, [TokenType.PIPE, TokenType.R_BRACKET], true);
        choiceNode.options.push(optionResult.nodes);
        i = optionResult.nextIndex;

        if (i < tokens.length && tokens[i].type === TokenType.PIPE) {
          i++; // Skip |
        }
      }

      if (i < tokens.length && tokens[i].type === TokenType.R_BRACKET) {
        i++; // Skip ]
      }

      nodes.push(choiceNode);
    } else if (token.type === TokenType.VARIABLE) {
      nodes.push({ type: NodeType.VARIABLE_REF, value: token.value });
      i++;
    } else if (token.type === TokenType.SPLAT) {
      if (i + 1 < tokens.length && tokens[i + 1].type === TokenType.VARIABLE) {
        nodes.push({ type: NodeType.SPLAT_REF, value: tokens[i + 1].value });
        i += 2;
      } else {
        nodes.push({ type: NodeType.TEXT, value: '*' });
        i++;
      }
    } else if (token.type === TokenType.FLAG) {
      nodes.push({ type: NodeType.FLAG, value: token.value });
      i++;
    } else if (token.type === TokenType.INTERPOLATION) {
      nodes.push({ type: NodeType.INTERPOLATION, value: token.value });
      i++;
    } else {
      nodes.push({ type: NodeType.TEXT, value: token.value });
      i++;
    }
  }

  return { nodes, nextIndex: i };
}
