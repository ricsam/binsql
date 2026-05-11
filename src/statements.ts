import { sqlLexer } from "./lexer";
import { binSqlError } from "./errors";

export function splitStatements(input: string): string[] {
  const lexResult = sqlLexer.tokenize(input);
  if (lexResult.errors.length > 0) {
    const first = lexResult.errors[0]!;
    binSqlError({
      code: "E_PARSE",
      message: first.message,
      position: {
        offset: first.offset,
        line: first.line ?? 1,
        column: first.column ?? 1,
      },
    });
  }

  const statements: string[] = [];
  let startOffset: number | undefined;
  let depth = 0;

  for (const token of lexResult.tokens) {
    if (startOffset === undefined && token.tokenType.name !== "Semicolon") {
      startOffset = token.startOffset ?? 0;
    }

    if (token.tokenType.name === "LParen") {
      depth++;
    } else if (token.tokenType.name === "RParen") {
      depth = Math.max(0, depth - 1);
    } else if (token.tokenType.name === "Semicolon" && depth === 0) {
      if (startOffset !== undefined) {
        const statement = input.slice(startOffset, token.startOffset).trim();
        if (statement) {
          statements.push(statement);
        }
      }
      startOffset = undefined;
    }
  }

  if (startOffset !== undefined) {
    const statement = input.slice(startOffset).trim();
    if (statement) {
      statements.push(statement);
    }
  }

  return statements;
}
