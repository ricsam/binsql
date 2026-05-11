import type { BinSqlDiagnostic } from "./errors";

export type BinSqlMode = "runtime" | "migration" | "timescaleMigration";

export interface ParseOptions {
  mode: BinSqlMode;
}

export interface SerializeOptions {
  projectSchema: string;
  extensionSchema?: string;
  parameters?: readonly unknown[];
}

export interface CompileResult {
  sql: string;
  parameters: readonly unknown[];
  warnings: BinSqlDiagnostic[];
}

export interface BinSqlAst {
  kind: "script";
  mode: BinSqlMode;
  statements: BinSqlStatement[];
}

export type BinSqlStatement =
  | SelectStatement
  | InsertStatement
  | UpdateStatement
  | DeleteStatement
  | CreateTableStatement
  | AlterTableStatement
  | CreateIndexStatement
  | DropTableStatement;

export interface IdentifierPath {
  parts: string[];
}

export interface RelationName {
  schema?: string;
  name: string;
}

export interface TableRef {
  kind: "table";
  name: RelationName;
  alias?: string;
}

export interface SubqueryRef {
  kind: "subquery";
  select: SelectStatement;
  alias: string;
}

export type FromItem = TableRef | SubqueryRef;

export interface JoinClause {
  type: "join" | "inner" | "left";
  item: FromItem;
  on?: Expression;
  using?: string[];
}

export interface FromClause {
  base: FromItem;
  joins: JoinClause[];
}

export interface Cte {
  name: string;
  select: SelectStatement;
}

export interface SelectTarget {
  expression: Expression;
  alias?: string;
}

export interface OrderByItem {
  expression: Expression;
  direction?: "ASC" | "DESC";
  nulls?: "FIRST" | "LAST";
}

export interface SelectStatement {
  kind: "select";
  ctes: Cte[];
  distinct: boolean;
  targets: SelectTarget[];
  from?: FromClause;
  where?: Expression;
  groupBy: Expression[];
  orderBy: OrderByItem[];
  limit?: Expression;
  offset?: Expression;
}

export interface InsertStatement {
  kind: "insert";
  into: RelationName;
  columns: string[];
  values: Expression[][];
  onConflict?: OnConflictClause;
  returning: SelectTarget[];
}

export type OnConflictClause =
  | { kind: "nothing"; columns: string[] }
  | { kind: "update"; columns: string[]; assignments: Assignment[] };

export interface Assignment {
  column: string;
  value: Expression;
}

export interface UpdateStatement {
  kind: "update";
  table: TableRef;
  assignments: Assignment[];
  where?: Expression;
  returning: SelectTarget[];
}

export interface DeleteStatement {
  kind: "delete";
  from: TableRef;
  using: TableRef[];
  where?: Expression;
  returning: SelectTarget[];
}

export interface SqlType {
  name: string[];
  args: number[];
  arrayDepth: number;
}

export type ColumnConstraint =
  | { kind: "primaryKey" }
  | { kind: "notNull" }
  | { kind: "unique" }
  | { kind: "default"; expression: Expression };

export interface ColumnDef {
  name: string;
  type: SqlType;
  constraints: ColumnConstraint[];
}

export type TableConstraint =
  | { kind: "primaryKey"; name?: string; columns: string[] }
  | { kind: "unique"; name?: string; columns: string[] }
  | {
      kind: "foreignKey";
      name?: string;
      columns: string[];
      references: RelationName;
      referencedColumns: string[];
      onUpdate?: string;
      onDelete?: string;
    };

export interface CreateTableStatement {
  kind: "createTable";
  ifNotExists: boolean;
  table: RelationName;
  columns: ColumnDef[];
  constraints: TableConstraint[];
}

export type AlterTableAction =
  | { kind: "addColumn"; ifNotExists: boolean; column: ColumnDef }
  | { kind: "dropColumn"; ifExists: boolean; column: string }
  | { kind: "renameTable"; name: string }
  | { kind: "renameColumn"; from: string; to: string }
  | { kind: "addConstraint"; constraint: TableConstraint; ifNotExists: boolean }
  | { kind: "addUniqueUsingIndex"; ifNotExists: boolean; name: string; index: string }
  | { kind: "setOptions"; options: TableOption[] };

export interface TableOption {
  name: string;
  value?: string;
}

export interface AlterTableStatement {
  kind: "alterTable";
  table: RelationName;
  action: AlterTableAction;
}

export interface IndexColumn {
  expression: Expression;
  direction?: "ASC" | "DESC";
  nulls?: "FIRST" | "LAST";
}

export interface CreateIndexStatement {
  kind: "createIndex";
  unique: boolean;
  ifNotExists: boolean;
  name: string;
  table: RelationName;
  method?: string;
  columns: IndexColumn[];
  where?: Expression;
}

export interface DropTableStatement {
  kind: "dropTable";
  ifExists: boolean;
  table: RelationName;
  cascade: boolean;
}

export type Expression =
  | StarExpression
  | LiteralExpression
  | ParameterExpression
  | ColumnExpression
  | UnaryExpression
  | BinaryExpression
  | CastExpression
  | FunctionCallExpression
  | WindowedFunctionExpression
  | IsNullExpression
  | InListExpression
  | LikeExpression
  | CaseExpression
  | ExistsExpression
  | SubqueryExpression;

export interface StarExpression {
  kind: "star";
}

export interface LiteralExpression {
  kind: "literal";
  literalType: "string" | "number" | "boolean" | "null" | "interval";
  value: string | number | boolean | null;
}

export interface ParameterExpression {
  kind: "parameter";
  index: number;
}

export interface ColumnExpression {
  kind: "column";
  parts: string[];
}

export interface UnaryExpression {
  kind: "unary";
  operator: "NOT" | "+" | "-";
  expression: Expression;
}

export interface BinaryExpression {
  kind: "binary";
  operator: string;
  left: Expression;
  right: Expression;
}

export interface CastExpression {
  kind: "cast";
  expression: Expression;
  type: SqlType;
}

export type FunctionArg =
  | { kind: "expr"; expression: Expression }
  | { kind: "named"; name: string; expression: Expression };

export interface FunctionCallExpression {
  kind: "call";
  name: IdentifierPath;
  args: FunctionArg[];
  distinct: boolean;
}

export interface WindowedFunctionExpression {
  kind: "window";
  call: FunctionCallExpression;
  spec: WindowSpec;
}

export interface WindowSpec {
  partitionBy: Expression[];
  orderBy: OrderByItem[];
  rows?: "UNBOUNDED_PRECEDING_TO_CURRENT_ROW";
}

export interface IsNullExpression {
  kind: "isNull";
  expression: Expression;
  not: boolean;
}

export interface InListExpression {
  kind: "in";
  expression: Expression;
  not: boolean;
  values: Expression[] | SelectStatement;
}

export interface LikeExpression {
  kind: "like";
  expression: Expression;
  not: boolean;
  operator: "LIKE" | "ILIKE";
  pattern: Expression;
}

export interface CaseExpression {
  kind: "case";
  cases: { when: Expression; then: Expression }[];
  else?: Expression;
}

export interface ExistsExpression {
  kind: "exists";
  select: SelectStatement;
}

export interface SubqueryExpression {
  kind: "subquery";
  select: SelectStatement;
}
