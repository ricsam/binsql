export type BinSqlDiagnosticCode =
  | "E_PARSE"
  | "E_UNSUPPORTED_STATEMENT"
  | "E_UNSUPPORTED_EXPRESSION"
  | "E_FORBIDDEN_SCHEMA"
  | "E_FORBIDDEN_CATALOG"
  | "E_FORBIDDEN_FUNCTION"
  | "E_FORBIDDEN_TYPE"
  | "E_FORBIDDEN_OPERATOR"
  | "E_MODE_REQUIRED";

export interface BinSqlDiagnostic {
  code: BinSqlDiagnosticCode;
  message: string;
  position?: { offset: number; line: number; column: number };
}

export class BinSqlError extends Error {
  readonly diagnostic: BinSqlDiagnostic;

  constructor(diagnostic: BinSqlDiagnostic) {
    super(diagnostic.message);
    this.name = "BinSqlError";
    this.diagnostic = diagnostic;
  }
}

export function binSqlError(diagnostic: BinSqlDiagnostic): never {
  throw new BinSqlError(diagnostic);
}
