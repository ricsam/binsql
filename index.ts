export type {
  BinSqlAst,
  BinSqlMode,
  BinSqlStatement,
  CompileResult,
  ParseOptions,
  SerializeOptions,
} from "./src/ast";
export type { BinSqlDiagnostic } from "./src/errors";
export { BinSqlError } from "./src/errors";
export { parse } from "./src/parser";
export { serialize } from "./src/serializer";
export { splitStatements } from "./src/statements";

import type { CompileResult, ParseOptions, SerializeOptions } from "./src/ast";
import { parse } from "./src/parser";
import { serialize } from "./src/serializer";

export function compile(input: string, options: ParseOptions & SerializeOptions): CompileResult {
  return serialize(parse(input, options), options);
}
