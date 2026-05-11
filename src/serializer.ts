import type {
  AlterTableAction,
  BinSqlAst,
  BinSqlMode,
  BinSqlStatement,
  CaseExpression,
  ColumnDef,
  CompileResult,
  Expression,
  FromClause,
  FromItem,
  FunctionCallExpression,
  InsertStatement,
  OrderByItem,
  RelationName,
  SelectStatement,
  SelectTarget,
  SerializeOptions,
  SqlType,
  TableConstraint,
  TableRef,
  WindowSpec,
} from "./ast";
import { binSqlError } from "./errors";

interface SerializeContext {
  projectSchema: string;
  extensionSchema: string;
  mode: BinSqlMode;
  parameters: readonly unknown[];
}

interface Scope {
  ctes: Set<string>;
  aliases: Set<string>;
  projectTables: Map<string, RelationName>;
  defaultProjectTable?: RelationName;
}

const forbiddenSchemas = new Set(["pg_catalog", "information_schema", "public"]);
const forbiddenCatalogRelations = new Set([
  "pg_class",
  "pg_constraint",
  "pg_database",
  "pg_user",
  "pg_tables",
  "pg_namespace",
  "pg_roles",
  "pg_authid",
]);

const forbiddenFunctions = [
  /^to_reg/i,
  /^has_.*_privilege$/i,
  /^pg_get_/i,
  /^pg_read_/i,
  /^pg_ls_/i,
  /^pg_advisory_/i,
  /^pg_backend_/i,
  /^pg_(terminate|cancel)_backend$/i,
  /^current_database$/i,
  /^current_schemas$/i,
  /^version$/i,
  /^format_type$/i,
];

const runtimeFunctions = new Set([
  "coalesce",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "date",
  "now",
  "gen_random_uuid",
  "time_bucket",
  "time_bucket_gapfill",
]);

const migrationFunctions = new Set(["coalesce", "now", "gen_random_uuid"]);
const timescaleMigrationFunctions = new Set([
  ...migrationFunctions,
  "time_bucket",
  "time_bucket_gapfill",
  "create_hypertable",
  "by_range",
  "add_continuous_aggregate_policy",
  "add_compression_policy",
]);

const castTypes = new Set([
  "text",
  "int",
  "integer",
  "bigint",
  "real",
  "double precision",
  "boolean",
  "timestamp",
  "timestamp with time zone",
  "timestamp without time zone",
  "timestamptz",
  "jsonb",
  "uuid",
]);

const ddlTypes = new Set([
  ...castTypes,
  "bool",
  "serial",
  "bigserial",
  "numeric",
  "decimal",
  "varchar",
  "char",
  "date",
  "json",
  "vector",
]);

const forbiddenTypes = /^reg(class|namespace|role|type|proc|procedure|operator|config|dictionary)$/i;

export function serialize(ast: BinSqlAst, options: SerializeOptions): CompileResult {
  const ctx: SerializeContext = {
    projectSchema: options.projectSchema,
    extensionSchema: options.extensionSchema ?? "public",
    mode: ast.mode,
    parameters: options.parameters ?? [],
  };
  const sql = ast.statements.map((statement) => serializeStatement(statement, ctx)).join(";\n");
  return { sql: sql ? `${sql};` : "", parameters: ctx.parameters, warnings: [] };
}

function serializeStatement(statement: BinSqlStatement, ctx: SerializeContext): string {
  switch (statement.kind) {
    case "select":
      return serializeSelect(statement, ctx, { ctes: new Set(), aliases: new Set(), projectTables: new Map() });
    case "insert":
      return serializeInsert(statement, ctx);
    case "update":
      return serializeUpdate(statement, ctx);
    case "delete":
      return serializeDelete(statement, ctx);
    case "createTable":
      return serializeCreateTable(statement, ctx);
    case "alterTable":
      return serializeAlterTable(statement.table, statement.action, ctx);
    case "createIndex":
      return serializeCreateIndex(statement, ctx);
    case "dropTable":
      return `DROP TABLE ${statement.ifExists ? "IF EXISTS " : ""}${serializeProjectRelation(statement.table, ctx)}${statement.cascade ? " CASCADE" : ""}`;
  }
}

function serializeSelect(statement: SelectStatement, ctx: SerializeContext, parentScope: Scope): string {
  const ctes = new Set(parentScope.ctes);
  for (const cte of statement.ctes) {
    ctes.add(cte.name);
  }
  const scope = statement.from
    ? scopeFromClause(statement.from, ctes)
    : { ctes, aliases: new Set<string>(), projectTables: new Map<string, RelationName>() };

  const withSql =
    statement.ctes.length > 0
      ? `WITH ${statement.ctes
          .map((cte) => `${quoteIdentifier(cte.name)} AS (${serializeSelect(cte.select, ctx, { ...scope, ctes })})`)
          .join(", ")} `
      : "";
  const targetSql = statement.targets.map((target) => serializeTarget(target, ctx, scope)).join(", ");
  const fromSql = statement.from ? ` FROM ${serializeFromClause(statement.from, ctx, scope)}` : "";
  const whereSql = statement.where ? ` WHERE ${serializeExpression(statement.where, ctx, scope)}` : "";
  const groupSql =
    statement.groupBy.length > 0
      ? ` GROUP BY ${statement.groupBy.map((expression) => serializeExpression(expression, ctx, scope)).join(", ")}`
      : "";
  const orderSql =
    statement.orderBy.length > 0
      ? ` ORDER BY ${statement.orderBy.map((item) => serializeOrderByItem(item, ctx, scope)).join(", ")}`
      : "";
  const limitSql = statement.limit ? ` LIMIT ${serializeExpression(statement.limit, ctx, scope)}` : "";
  const offsetSql = statement.offset ? ` OFFSET ${serializeExpression(statement.offset, ctx, scope)}` : "";
  return `${withSql}SELECT ${statement.distinct ? "DISTINCT " : ""}${targetSql}${fromSql}${whereSql}${groupSql}${orderSql}${limitSql}${offsetSql}`;
}

function serializeInsert(statement: InsertStatement, ctx: SerializeContext): string {
  const scope = emptyScope();
  const columns = statement.columns.length > 0 ? ` (${statement.columns.map(quoteIdentifier).join(", ")})` : "";
  const values = statement.values
    .map((row) => `(${row.map((expression) => serializeExpression(expression, ctx, scope)).join(", ")})`)
    .join(", ");
  const conflict = statement.onConflict
    ? statement.onConflict.kind === "nothing"
      ? ` ON CONFLICT${serializeConflictTarget(statement.onConflict.columns)} DO NOTHING`
      : ` ON CONFLICT${serializeConflictTarget(statement.onConflict.columns)} DO UPDATE SET ${statement.onConflict.assignments
          .map((assignment) => `${quoteIdentifier(assignment.column)} = ${serializeExpression(assignment.value, ctx, scope)}`)
          .join(", ")}`
    : "";
  const returning =
    statement.returning.length > 0
      ? ` RETURNING ${statement.returning.map((target) => serializeTarget(target, ctx, scope)).join(", ")}`
      : "";
  return `INSERT INTO ${serializeProjectRelation(statement.into, ctx)}${columns} VALUES ${values}${conflict}${returning}`;
}

function serializeUpdate(statement: Extract<BinSqlStatement, { kind: "update" }>, ctx: SerializeContext): string {
  const scope = scopeFromTableRefs([statement.table], new Set());
  const assignments = statement.assignments
    .map((assignment) => `${quoteIdentifier(assignment.column)} = ${serializeExpression(assignment.value, ctx, scope)}`)
    .join(", ");
  const where = statement.where ? ` WHERE ${serializeExpression(statement.where, ctx, scope)}` : "";
  const returning =
    statement.returning.length > 0
      ? ` RETURNING ${statement.returning.map((target) => serializeTarget(target, ctx, scope)).join(", ")}`
      : "";
  return `UPDATE ${serializeTableRef(statement.table, ctx, scope)} SET ${assignments}${where}${returning}`;
}

function serializeDelete(statement: Extract<BinSqlStatement, { kind: "delete" }>, ctx: SerializeContext): string {
  const scope = scopeFromTableRefs([statement.from, ...statement.using], new Set());
  const using =
    statement.using.length > 0
      ? ` USING ${statement.using.map((table) => serializeTableRef(table, ctx, scope)).join(", ")}`
      : "";
  const where = statement.where ? ` WHERE ${serializeExpression(statement.where, ctx, scope)}` : "";
  const returning =
    statement.returning.length > 0
      ? ` RETURNING ${statement.returning.map((target) => serializeTarget(target, ctx, scope)).join(", ")}`
      : "";
  return `DELETE FROM ${serializeTableRef(statement.from, ctx, scope)}${using}${where}${returning}`;
}

function serializeCreateTable(statement: Extract<BinSqlStatement, { kind: "createTable" }>, ctx: SerializeContext): string {
  requireMigrationMode(ctx);
  const columns = statement.columns.map((column) => serializeColumnDef(column, ctx));
  const constraints = statement.constraints.map((constraint) => serializeTableConstraint(constraint, ctx));
  return `CREATE TABLE ${statement.ifNotExists ? "IF NOT EXISTS " : ""}${serializeProjectRelation(statement.table, ctx)} (${[
    ...columns,
    ...constraints,
  ].join(", ")})`;
}

function serializeAlterTable(table: RelationName, action: AlterTableAction, ctx: SerializeContext): string {
  requireMigrationMode(ctx);
  const prefix = `ALTER TABLE ${serializeProjectRelation(table, ctx)} `;
  switch (action.kind) {
    case "addColumn":
      return `${prefix}ADD COLUMN ${action.ifNotExists ? "IF NOT EXISTS " : ""}${serializeColumnDef(action.column, ctx)}`;
    case "dropColumn":
      return `${prefix}DROP COLUMN ${action.ifExists ? "IF EXISTS " : ""}${quoteIdentifier(action.column)}`;
    case "renameTable":
      return `${prefix}RENAME TO ${quoteIdentifier(action.name)}`;
    case "renameColumn":
      return `${prefix}RENAME COLUMN ${quoteIdentifier(action.from)} TO ${quoteIdentifier(action.to)}`;
    case "addConstraint":
      return `${prefix}ADD CONSTRAINT ${action.ifNotExists ? "" : ""}${serializeTableConstraint(action.constraint, ctx, {
        omitConstraintKeyword: true,
      })}`;
    case "addUniqueUsingIndex":
      return `${prefix}ADD CONSTRAINT ${quoteIdentifier(action.name)} UNIQUE USING INDEX ${quoteIdentifier(action.index)}`;
    case "setOptions":
      if (ctx.mode !== "timescaleMigration") {
        binSqlError({ code: "E_MODE_REQUIRED", message: "ALTER TABLE SET options require timescaleMigration mode" });
      }
      return `${prefix}SET (${action.options.map(serializeTableOption).join(", ")})`;
  }
}

function serializeCreateIndex(statement: Extract<BinSqlStatement, { kind: "createIndex" }>, ctx: SerializeContext): string {
  requireMigrationMode(ctx);
  const scope = emptyScope();
  const columns = statement.columns.map((column) => serializeOrderByItem(column, ctx, scope)).join(", ");
  const where = statement.where ? ` WHERE ${serializeExpression(statement.where, ctx, scope)}` : "";
  return `CREATE ${statement.unique ? "UNIQUE " : ""}INDEX ${statement.ifNotExists ? "IF NOT EXISTS " : ""}${quoteIdentifier(
    statement.name,
  )} ON ${serializeProjectRelation(statement.table, ctx)}${statement.method ? ` USING ${quoteIdentifier(statement.method)}` : ""} (${columns})${where}`;
}

function serializeColumnDef(column: ColumnDef, ctx: SerializeContext): string {
  const constraints = column.constraints.map((constraint) => {
    switch (constraint.kind) {
      case "primaryKey":
        return "PRIMARY KEY";
      case "notNull":
        return "NOT NULL";
      case "unique":
        return "UNIQUE";
      case "default":
        return `DEFAULT ${serializeExpression(constraint.expression, ctx, emptyScope())}`;
    }
  });
  return [quoteIdentifier(column.name), serializeType(column.type, ctx, false), ...constraints].join(" ");
}

function serializeConflictTarget(columns: string[]): string {
  return columns.length > 0 ? ` (${columns.map(quoteIdentifier).join(", ")})` : "";
}

function serializeTableConstraint(
  constraint: TableConstraint,
  ctx: SerializeContext,
  options: { omitConstraintKeyword?: boolean } = {},
): string {
  const name = constraint.name ? `${options.omitConstraintKeyword ? "" : "CONSTRAINT "}${quoteIdentifier(constraint.name)} ` : "";
  switch (constraint.kind) {
    case "primaryKey":
      return `${name}PRIMARY KEY (${constraint.columns.map(quoteIdentifier).join(", ")})`;
    case "unique":
      return `${name}UNIQUE (${constraint.columns.map(quoteIdentifier).join(", ")})`;
    case "foreignKey":
      return `${name}FOREIGN KEY (${constraint.columns.map(quoteIdentifier).join(", ")}) REFERENCES ${serializeProjectRelation(
        constraint.references,
        ctx,
      )} (${constraint.referencedColumns.map(quoteIdentifier).join(", ")})${constraint.onUpdate ? ` ON UPDATE ${serializeReferentialAction(constraint.onUpdate)}` : ""}${
        constraint.onDelete ? ` ON DELETE ${serializeReferentialAction(constraint.onDelete)}` : ""
      }`;
  }
}

function serializeTableOption(option: { name: string; value?: string }): string {
  const allowed = new Set(["timescaledb.continuous", "timescaledb.compress", "timescaledb.compress_segmentby", "timescaledb.compress_orderby"]);
  if (!allowed.has(option.name)) {
    binSqlError({ code: "E_UNSUPPORTED_STATEMENT", message: `Unsupported table option ${option.name}` });
  }
  return option.value === undefined ? option.name : `${option.name} = ${quoteString(option.value.replace(/^'|'$/g, ""))}`;
}

function serializeTarget(target: SelectTarget, ctx: SerializeContext, scope: Scope): string {
  const alias = target.alias ? ` AS ${quoteIdentifier(target.alias)}` : "";
  return `${serializeExpression(target.expression, ctx, scope)}${alias}`;
}

function serializeFromClause(from: FromClause, ctx: SerializeContext, scope: Scope): string {
  const joins = from.joins
    .map((join) => {
      const type = join.type === "join" ? "JOIN" : `${join.type.toUpperCase()} JOIN`;
      const condition = join.on
        ? ` ON ${serializeExpression(join.on, ctx, scope)}`
        : ` USING (${(join.using ?? []).map(quoteIdentifier).join(", ")})`;
      return ` ${type} ${serializeFromItem(join.item, ctx, scope)}${condition}`;
    })
    .join("");
  return `${serializeFromItem(from.base, ctx, scope)}${joins}`;
}

function serializeFromItem(item: FromItem, ctx: SerializeContext, scope: Scope): string {
  if (item.kind === "subquery") {
    return `(${serializeSelect(item.select, ctx, scope)}) AS ${quoteIdentifier(item.alias)}`;
  }
  return serializeTableRef(item, ctx, scope);
}

function serializeTableRef(ref: TableRef, ctx: SerializeContext, scope: Scope): string {
  const isCte = !ref.name.schema && scope.ctes.has(ref.name.name);
  const relation = isCte ? quoteIdentifier(ref.name.name) : serializeProjectRelation(ref.name, ctx);
  return `${relation}${ref.alias ? ` AS ${quoteIdentifier(ref.alias)}` : ""}`;
}

function serializeProjectRelation(relation: RelationName, ctx: SerializeContext): string {
  validateRelation(relation, ctx);
  return `${quoteIdentifier(ctx.projectSchema)}.${quoteIdentifier(relation.name)}`;
}

function serializeExpression(expression: Expression, ctx: SerializeContext, scope: Scope, parentPrecedence = 0): string {
  switch (expression.kind) {
    case "star":
      return "*";
    case "literal":
      return serializeLiteral(expression);
    case "parameter":
      return `$${expression.index}`;
    case "column":
      return serializeColumn(expression.parts, ctx, scope);
    case "unary": {
      const sql = `${expression.operator} ${serializeExpression(expression.expression, ctx, scope, 70)}`;
      return maybeParenthesize(sql, 70, parentPrecedence);
    }
    case "binary": {
      validateOperator(expression.operator);
      const precedence = expressionPrecedence(expression.operator);
      const sql = `${serializeExpression(expression.left, ctx, scope, precedence)} ${expression.operator} ${serializeExpression(
        expression.right,
        ctx,
        scope,
        precedence + 1,
      )}`;
      return maybeParenthesize(sql, precedence, parentPrecedence);
    }
    case "cast":
      return `${serializeExpression(expression.expression, ctx, scope, 80)}::${serializeType(expression.type, ctx, true)}`;
    case "call":
      return serializeFunctionCall(expression, ctx, scope);
    case "window":
      return `${serializeFunctionCall(expression.call, ctx, scope)} OVER (${serializeWindowSpec(expression.spec, ctx, scope)})`;
    case "isNull":
      return `${serializeExpression(expression.expression, ctx, scope, 40)} IS ${expression.not ? "NOT " : ""}NULL`;
    case "in": {
      const values = Array.isArray(expression.values)
        ? expression.values.map((value) => serializeExpression(value, ctx, scope)).join(", ")
        : serializeSelect(expression.values, ctx, scope);
      return `${serializeExpression(expression.expression, ctx, scope, 40)} ${expression.not ? "NOT " : ""}IN (${values})`;
    }
    case "like":
      return `${serializeExpression(expression.expression, ctx, scope, 40)} ${expression.not ? "NOT " : ""}${expression.operator} ${serializeExpression(
        expression.pattern,
        ctx,
        scope,
        41,
      )}`;
    case "case":
      return serializeCase(expression, ctx, scope);
    case "exists":
      return `EXISTS (${serializeSelect(expression.select, ctx, scope)})`;
    case "subquery":
      return `(${serializeSelect(expression.select, ctx, scope)})`;
  }
}

function serializeColumn(parts: string[], ctx: SerializeContext, scope: Scope): string {
  if (parts.length === 1) {
    if (scope.defaultProjectTable) {
      return `${quoteIdentifier(ctx.projectSchema)}.${quoteIdentifier(scope.defaultProjectTable.name)}.${quoteIdentifier(parts[0]!)}`;
    }
    return quoteIdentifier(parts[0]!);
  }
  if (parts.length === 2) {
    const [qualifier, column] = parts as [string, string];
    if (qualifier === "excluded") {
      return `EXCLUDED.${quoteIdentifier(column)}`;
    }
    if (scope.aliases.has(qualifier) || scope.ctes.has(qualifier)) {
      return `${quoteIdentifier(qualifier)}.${quoteIdentifier(column)}`;
    }
    if (scope.projectTables.has(qualifier)) {
      return `${quoteIdentifier(ctx.projectSchema)}.${quoteIdentifier(qualifier)}.${quoteIdentifier(column)}`;
    }
    return `${quoteIdentifier(qualifier)}.${quoteIdentifier(column)}`;
  }
  if (parts.length === 3) {
    const [schema, table, column] = parts as [string, string, string];
    if (schema !== ctx.projectSchema) {
      binSqlError({ code: "E_FORBIDDEN_SCHEMA", message: `Forbidden schema reference ${schema}` });
    }
    return `${quoteIdentifier(ctx.projectSchema)}.${quoteIdentifier(table)}.${quoteIdentifier(column)}`;
  }
  binSqlError({ code: "E_UNSUPPORTED_EXPRESSION", message: "Column references with more than three parts are not supported" });
}

function serializeFunctionCall(call: FunctionCallExpression, ctx: SerializeContext, scope: Scope): string {
  if (call.name.parts.length !== 1) {
    binSqlError({ code: "E_FORBIDDEN_SCHEMA", message: "Schema-qualified function calls are not accepted" });
  }
  const name = call.name.parts[0]!.toLowerCase();
  validateFunction(name, ctx.mode);
  const args = call.args
    .map((arg) =>
      arg.kind === "named"
        ? `${quoteIdentifier(arg.name)} => ${serializeExpression(arg.expression, ctx, scope)}`
        : serializeExpression(arg.expression, ctx, scope),
    )
    .join(", ");
  return `${name}(${call.distinct ? "DISTINCT " : ""}${args})`;
}

function serializeWindowSpec(spec: WindowSpec, ctx: SerializeContext, scope: Scope): string {
  const pieces = [];
  if (spec.partitionBy.length > 0) {
    pieces.push(`PARTITION BY ${spec.partitionBy.map((expression) => serializeExpression(expression, ctx, scope)).join(", ")}`);
  }
  if (spec.orderBy.length > 0) {
    pieces.push(`ORDER BY ${spec.orderBy.map((item) => serializeOrderByItem(item, ctx, scope)).join(", ")}`);
  }
  if (spec.rows) {
    pieces.push("ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW");
  }
  return pieces.join(" ");
}

function serializeOrderByItem(item: OrderByItem, ctx: SerializeContext, scope: Scope): string {
  return `${serializeExpression(item.expression, ctx, scope)}${item.direction ? ` ${item.direction}` : ""}${item.nulls ? ` NULLS ${item.nulls}` : ""}`;
}

function serializeCase(expression: CaseExpression, ctx: SerializeContext, scope: Scope): string {
  const cases = expression.cases
    .map((item) => `WHEN ${serializeExpression(item.when, ctx, scope)} THEN ${serializeExpression(item.then, ctx, scope)}`)
    .join(" ");
  return `CASE ${cases}${expression.else ? ` ELSE ${serializeExpression(expression.else, ctx, scope)}` : ""} END`;
}

function serializeLiteral(expression: Extract<Expression, { kind: "literal" }>): string {
  switch (expression.literalType) {
    case "string":
      return quoteString(String(expression.value));
    case "interval":
      return `INTERVAL ${quoteString(String(expression.value))}`;
    case "number":
      return String(expression.value);
    case "boolean":
      return expression.value ? "TRUE" : "FALSE";
    case "null":
      return "NULL";
  }
}

function serializeType(type: SqlType, ctx: SerializeContext, cast: boolean): string {
  if (type.name.length !== 1) {
    binSqlError({ code: "E_FORBIDDEN_SCHEMA", message: "Schema-qualified types are not accepted" });
  }
  const name = type.name[0]!.toLowerCase();
  if (forbiddenTypes.test(name)) {
    binSqlError({ code: "E_FORBIDDEN_TYPE", message: `Forbidden type ${name}` });
  }
  const allowed = cast ? castTypes : ddlTypes;
  if (!allowed.has(name)) {
    binSqlError({ code: "E_FORBIDDEN_TYPE", message: `Unsupported type ${name}` });
  }
  const normalized = normalizeTypeName(name);
  const args = type.args.length > 0 ? `(${type.args.join(", ")})` : "";
  const arrays = "[]".repeat(type.arrayDepth);
  if (normalized === "vector") {
    if (cast) {
      binSqlError({ code: "E_FORBIDDEN_TYPE", message: "Casts to vector are not supported" });
    }
    if (type.args.length !== 1 || !Number.isInteger(type.args[0])) {
      binSqlError({ code: "E_FORBIDDEN_TYPE", message: "vector type requires an integer dimension" });
    }
    return `${quoteIdentifier(ctx.extensionSchema)}.${quoteIdentifier("vector")}${args}${arrays}`;
  }
  return `${normalized}${args}${arrays}`;
}

function validateRelation(relation: RelationName, ctx: SerializeContext): void {
  if (relation.schema) {
    if (forbiddenSchemas.has(relation.schema) || relation.schema !== ctx.projectSchema) {
      binSqlError({ code: "E_FORBIDDEN_SCHEMA", message: `Forbidden schema reference ${relation.schema}` });
    }
  }
  const lower = relation.name.toLowerCase();
  if (lower.startsWith("pg_") || forbiddenCatalogRelations.has(lower)) {
    binSqlError({ code: "E_FORBIDDEN_CATALOG", message: `Forbidden catalog relation ${relation.name}` });
  }
}

function validateFunction(name: string, mode: BinSqlMode): void {
  if (forbiddenFunctions.some((pattern) => pattern.test(name))) {
    binSqlError({ code: "E_FORBIDDEN_FUNCTION", message: `Forbidden function ${name}` });
  }
  const allowed =
    mode === "runtime" ? runtimeFunctions : mode === "timescaleMigration" ? timescaleMigrationFunctions : migrationFunctions;
  if (!allowed.has(name)) {
    binSqlError({ code: "E_FORBIDDEN_FUNCTION", message: `Unsupported function ${name}` });
  }
}

function validateOperator(operator: string): void {
  if (!["OR", "AND", "=", "<>", "<", "<=", ">", ">=", "+", "-", "*", "/", "<=>", "<->", "<#>"].includes(operator)) {
    binSqlError({ code: "E_FORBIDDEN_OPERATOR", message: `Unsupported operator ${operator}` });
  }
}

function requireMigrationMode(ctx: SerializeContext): void {
  if (ctx.mode === "runtime") {
    binSqlError({ code: "E_MODE_REQUIRED", message: "DDL statements require migration mode" });
  }
}

function serializeReferentialAction(action: string): string {
  const normalized = action.toUpperCase().replace(/\s+/g, " ").trim();
  if (!["CASCADE", "RESTRICT", "SET NULL", "SET DEFAULT", "NO ACTION"].includes(normalized)) {
    binSqlError({ code: "E_UNSUPPORTED_STATEMENT", message: `Unsupported referential action ${action}` });
  }
  return normalized;
}

function normalizeTypeName(name: string): string {
  switch (name) {
    case "int":
      return "integer";
    case "bool":
      return "boolean";
    case "timestamp with time zone":
      return "timestamptz";
    case "timestamp without time zone":
      return "timestamp";
    default:
      return name;
  }
}

function scopeFromClause(from: FromClause, ctes: Set<string>): Scope {
  const tableRefs: TableRef[] = [];
  collectTableRefs(from.base, tableRefs);
  for (const join of from.joins) {
    collectTableRefs(join.item, tableRefs);
  }
  return scopeFromTableRefs(tableRefs, ctes);
}

function collectTableRefs(item: FromItem, refs: TableRef[]): void {
  if (item.kind === "table") refs.push(item);
}

function scopeFromTableRefs(refs: TableRef[], ctes: Set<string>): Scope {
  const aliases = new Set<string>();
  const projectTables = new Map<string, RelationName>();
  let defaultProjectTable: RelationName | undefined;
  for (const ref of refs) {
    if (ref.alias) {
      aliases.add(ref.alias);
      continue;
    }
    if (!ref.name.schema && ctes.has(ref.name.name)) {
      aliases.add(ref.name.name);
      continue;
    }
    projectTables.set(ref.name.name, ref.name);
    defaultProjectTable = defaultProjectTable ? undefined : ref.name;
  }
  return { ctes, aliases, projectTables, defaultProjectTable };
}

function emptyScope(): Scope {
  return { ctes: new Set(), aliases: new Set(), projectTables: new Map() };
}

function expressionPrecedence(operator: string): number {
  switch (operator) {
    case "OR":
      return 10;
    case "AND":
      return 20;
    case "=":
    case "<>":
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "<=>":
    case "<->":
    case "<#>":
      return 40;
    case "+":
    case "-":
      return 50;
    case "*":
    case "/":
      return 60;
    default:
      return 100;
  }
}

function maybeParenthesize(sql: string, precedence: number, parentPrecedence: number): string {
  return precedence < parentPrecedence ? `(${sql})` : sql;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
