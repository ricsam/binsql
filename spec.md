# binsql Spec

## Goal

`binsql` is a safe SQL dialect for Build it Now project databases.

The contract is:

```text
binsql string -> parse -> validate against a policy -> normalize to binsql AST -> serialize canonical PostgreSQL SQL -> execute
```

The original input string must never be passed through to PostgreSQL. PostgreSQL only receives SQL emitted by the binsql serializer from a validated AST.

The first target is the SQL already produced or used by Build it Now projects:

- Drizzle-generated migrations in local project data and templates.
- Project runtime SQL sent through `@/db`, including Drizzle SQL fragments.
- Custom migrations for `pgvector` and TimescaleDB, especially the `ai-platform` migrations.

## Security Model

binsql is an allowlisted compiler, not a PostgreSQL firewall.

Accepted SQL must be representable in a small AST. Anything outside the AST is rejected before serialization. The serializer owns all quoting, schema qualification, and normalization.

Execution context provides:

```ts
interface BinSqlContext {
  projectSchema: string;
  extensionSchema: string; // default "public" for current Build it Now deployments
  mode: "runtime" | "migration" | "timescaleMigration";
  parameters: readonly unknown[];
}
```

All project table references serialize as `"${projectSchema}"."<table>"`. User input cannot select a schema. Unqualified table names are always project tables. Explicit project-schema qualification may be accepted and normalized to the configured project schema, but every other schema is rejected except approved extension symbols.

Approved extension symbols are not general table references. They are only allowed where the grammar expects an extension type, function, operator, or storage option.

Hard rejects in every mode:

- Any catalog or metadata relation: `pg_catalog`, `information_schema`, `pg_*` relations, `pg_class`, `pg_constraint`, `pg_database`, `pg_user`, etc.
- Dynamic SQL or procedural execution: `DO`, `CALL`, `EXECUTE`, `PREPARE`, `COPY`, `LISTEN`, `NOTIFY`, `SET`, `RESET`, `CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE EXTENSION`.
- Security-relevant functions: file access, advisory locks, backend/role/session functions, `to_reg*`, `has_*_privilege`, `pg_get_*`, `current_database`, `current_schemas`, `version`, and `format_type`.
- Direct references to `public` tables, platform tables, cross-project schemas, FDWs, large objects, casts to `reg*` types, and arbitrary operators from non-project schemas.

## Supported Syntax

### Scripts

Migration input is a script of statements. Split statements with PostgreSQL-aware lexing that ignores semicolons in strings, comments, dollar strings, and parenthesized expressions.

Allowed comments:

- Line comments.
- Block comments.
- Drizzle statement markers such as `--> statement-breakpoint`.
- Build it Now metadata comments such as `-- build-it-now:migration-class=timescale`.

Comments are not serialized except optional normalized migration markers if the caller requests them.

### Identifiers

Support:

- Unquoted identifiers: `users`, `created_at`.
- Double-quoted identifiers with escaped quotes.
- Table aliases: `credit_events ce`, `"models" a`.
- Column references: `column`, `table.column`, `alias.column`.
- System column `ctid` only when qualified or resolved against a project table.

Normalization:

- Serializer always emits double-quoted project table and column identifiers.
- Keyword-like table names such as `"user"` remain valid.
- No user-provided schema is preserved except an exact project schema alias that normalizes to `projectSchema`.

### Literals and Parameters

Support:

- String, integer, decimal, boolean, `NULL`.
- PostgreSQL interval literals: `INTERVAL '5 minutes'`.
- Parameter placeholders:
  - `$1`, `$2`, etc. for raw parameterized SQL.
  - Internal placeholders produced by Drizzle fragments.
- Array literal support can be added later; v1 should prefer parameter arrays and `IN ($1, $2, ...)`.

Allowed casts:

- `::text`, `::int`, `::integer`, `::bigint`, `::real`, `::double precision`, `::boolean`, `::timestamp`, `::timestamptz`, `::jsonb`, `::uuid`, and supported array forms where needed.

Rejected casts:

- `::regclass`, `::regnamespace`, `::regrole`, `::regtype`, `::regproc`, `::regprocedure`, `::regoperator`, and other catalog lookup types.

### Expressions

Support:

- Arithmetic: `+`, `-`, `*`, `/`.
- Comparisons: `=`, `<>`, `!=`, `<`, `<=`, `>`, `>=`.
- Boolean logic: `AND`, `OR`, `NOT`.
- Null checks: `IS NULL`, `IS NOT NULL`.
- List predicates: `IN (...)`, `NOT IN (...)`.
- Pattern predicates: `LIKE`, `ILIKE` if needed by runtime queries.
- Parenthesized expressions.
- `CASE WHEN ... THEN ... ELSE ... END`.
- `COALESCE(...)`.
- Aggregate functions: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`.
- `COUNT(DISTINCT expr)`.
- `DATE(expr)`.
- `NOW()` and `gen_random_uuid()`.
- Window functions with `OVER (...)` for observed usage-log queries:
  - `PARTITION BY`
  - `ORDER BY`
  - `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`

Function allowlist is mode-aware. Unknown functions are rejected.

### SELECT

Support:

- `SELECT` lists with aliases.
- `SELECT *` only from project tables or CTEs.
- `FROM` project table, CTE, or supported materialized view.
- `JOIN`, `INNER JOIN`, `LEFT JOIN`.
- `WHERE`.
- `GROUP BY` by expression, ordinal, or alias when emitted safely.
- `ORDER BY` expression or alias with `ASC`/`DESC` and optional `NULLS FIRST/LAST`.
- `LIMIT` and `OFFSET` as literal or parameter.
- CTEs: `WITH name AS (SELECT ...) SELECT ...`.
- Subqueries in `IN (...)`, `EXISTS (...)`, and scalar positions when their `FROM` items obey the same rules.

Runtime examples that must parse and serialize:

```sql
SELECT COUNT(*)::int AS total_count FROM credit_events WHERE user_id = $1;

WITH events AS (
  SELECT *,
    SUM(credits_added - credits_consumed) OVER (
      PARTITION BY user_id ORDER BY time
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS balance_after
  FROM credit_events
  WHERE user_id = $1
)
SELECT credits_added, credits_consumed, balance_after, time
FROM events
ORDER BY time DESC
LIMIT $2 OFFSET $3;
```

### INSERT

Support:

- `INSERT INTO table (columns...) VALUES (...)`.
- Multi-row `VALUES`.
- `RETURNING`.
- `ON CONFLICT (columns...) DO NOTHING`.
- `ON CONFLICT (columns...) DO UPDATE SET column = EXCLUDED.column, ...`.

Observed seed-data examples require `gen_random_uuid()`, `NOW()`, booleans, decimals, and JSON stored as text or jsonb-compatible values.

### UPDATE

Support:

- `UPDATE table SET column = expr, ... WHERE ...`.
- `RETURNING`.

No `UPDATE ... FROM` in v1 unless observed runtime need appears.

### DELETE

Support:

- `DELETE FROM table WHERE ...`.
- `DELETE FROM table alias USING table alias WHERE ...`.
- `RETURNING`.

Observed migration example:

```sql
DELETE FROM "models" a
USING "models" b
WHERE a.model_id = b.model_id
  AND a.ctid < b.ctid;
```

### DDL: Migration Mode

Supported in `migration` mode only.

`CREATE TABLE`:

- Columns with type, `PRIMARY KEY`, `NOT NULL`, `DEFAULT`, inline `UNIQUE`.
- Table constraints: named `UNIQUE`, `PRIMARY KEY`, and `FOREIGN KEY`.
- Foreign keys with `REFERENCES table (columns) ON UPDATE ... ON DELETE ...`.

`ALTER TABLE`:

- `ADD COLUMN`.
- `ADD CONSTRAINT ... FOREIGN KEY`.
- `ADD CONSTRAINT ... UNIQUE`.
- `DROP COLUMN` if generated by Drizzle.
- `SET (...)` only for allowlisted Timescale table options in `timescaleMigration` mode.

`CREATE INDEX`:

- `CREATE INDEX` and `CREATE UNIQUE INDEX`.
- `IF NOT EXISTS`.
- Column list with optional `ASC`/`DESC` and `NULLS FIRST/LAST`.
- Partial indexes with `WHERE` over project-table columns.

`DROP TABLE`:

- `DROP TABLE IF EXISTS table`.
- Optional `CASCADE` only in migration mode.

Unsupported PostgreSQL block observed in `ai-platform`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'models'::regclass
      AND conname = 'models_model_id_unique'
      AND contype = 'u'
  ) THEN
    ALTER TABLE "models"
      ADD CONSTRAINT "models_model_id_unique" UNIQUE USING INDEX "models_model_id_unique";
  END IF;
END $$;
```

Do not support raw `DO` or catalog checks. Instead add a binsql-native migration statement:

```sql
ALTER TABLE models ADD CONSTRAINT IF NOT EXISTS models_model_id_unique
  UNIQUE USING INDEX models_model_id_unique;
```

The serializer may emit one or more host-generated PostgreSQL statements for this construct, but those statements must be generated from structured names, never from user text.

## Extensions

### pgvector

Observed forms:

- Column type: `vector(1536)`, `vector(1024)`.
- Drizzle schema currently treats `vector` as an extension type reachable through `public.vector`.
- Runtime vector search uses Drizzle `cosineDistance`, which emits vector distance operators such as `<=>`.

binsql normalization:

- Accept `vector(n)` as a binsql type.
- Serialize it as `"${extensionSchema}"."vector"(n)` or the exact PostgreSQL spelling required by the runtime once verified.
- Reject user-written `public.vector`; callers write `vector(n)` and binsql chooses the extension schema.
- Support vector distance operators only for project vector columns and parameter/literal vectors:
  - `<=>` cosine distance
  - `<->` L2 distance, if needed
  - `<#>` inner product, if needed
- Do not allow arbitrary extension-schema table or function references through this rule.

### TimescaleDB

Timescale support is allowed only in `timescaleMigration` mode or in runtime analytics functions explicitly allowlisted below.

Migration functions:

- `create_hypertable(table_name, by_range(column_name), if_not_exists => TRUE)`.
- `add_continuous_aggregate_policy(view_name, start_offset => INTERVAL ..., end_offset => INTERVAL ..., schedule_interval => INTERVAL ..., if_not_exists => TRUE)`.
- `add_compression_policy(table_name, compress_after => INTERVAL ..., if_not_exists => TRUE)`.

DDL/storage:

- `CREATE MATERIALIZED VIEW name WITH (timescaledb.continuous) AS SELECT ... WITH NO DATA`.
- `ALTER TABLE table SET (timescaledb.compress, timescaledb.compress_segmentby = 'column', timescaledb.compress_orderby = 'column DESC')`.

Runtime analytics functions:

- `time_bucket(INTERVAL ..., timestamp_expr)`.
- `time_bucket_gapfill(INTERVAL ..., timestamp_expr, start_expr, end_expr)`.

All Timescale table/view names must resolve to project objects. All Timescale options must be parsed as named structured options, not passed through as arbitrary option text.

## Serializer Rules

The serializer must produce stable canonical SQL.

Rules:

- Quote every project table, materialized view, column, index, and constraint identifier.
- Schema-qualify project relations with `projectSchema`.
- Do not schema-qualify CTE names or aliases.
- Use positional placeholders for values. Do not inline parameter values.
- Preserve literal values only when they are part of migration SQL or explicit binsql literals.
- Normalize function names to lower case.
- Normalize allowed extension types/functions/operators from `extensionSchema`.
- Emit no comments by default.

Example:

```sql
-- input
select id from users where email = $1

-- output
SELECT "project_abc_main"."users"."id"
FROM "project_abc_main"."users"
WHERE "project_abc_main"."users"."email" = $1
```

Serializer output is not intended to preserve formatting. It is intended to be safe, deterministic, and easy to snapshot-test.

## API Shape

Initial public API:

```ts
export type BinSqlMode = "runtime" | "migration" | "timescaleMigration";

export interface ParseOptions {
  mode: BinSqlMode;
}

export interface SerializeOptions {
  projectSchema: string;
  extensionSchema?: string;
  parameters?: readonly unknown[];
}

export interface BinSqlDiagnostic {
  code: string;
  message: string;
  position?: { offset: number; line: number; column: number };
}

export interface CompileResult {
  sql: string;
  parameters: readonly unknown[];
  warnings: BinSqlDiagnostic[];
}

export function parse(input: string, options: ParseOptions): BinSqlAst;
export function serialize(ast: BinSqlAst, options: SerializeOptions): CompileResult;
export function compile(input: string, options: ParseOptions & SerializeOptions): CompileResult;
```

Errors should be typed and include a stable code:

- `E_PARSE`
- `E_UNSUPPORTED_STATEMENT`
- `E_UNSUPPORTED_EXPRESSION`
- `E_FORBIDDEN_SCHEMA`
- `E_FORBIDDEN_CATALOG`
- `E_FORBIDDEN_FUNCTION`
- `E_FORBIDDEN_TYPE`
- `E_FORBIDDEN_OPERATOR`
- `E_MODE_REQUIRED`

## Implementation Phases

### Phase 1: Runtime query compiler

Support project-safe `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.

Must cover:

- Basic Drizzle-generated runtime SQL.
- CTE usage-log query.
- Aggregates, grouping, ordering, limit/offset.
- `COUNT(*)::int`.
- Runtime Timescale analytics functions.
- Vector distance operators used by pgvector search.

### Phase 2: Drizzle migration compiler

Support generated migration scripts from templates and local projects:

- `CREATE TABLE`.
- `ALTER TABLE ADD CONSTRAINT`.
- `CREATE INDEX` / `CREATE UNIQUE INDEX`.
- `DROP TABLE IF EXISTS`.
- `INSERT ... ON CONFLICT`.
- `DELETE ... USING`.
- `vector(n)` type normalization.

### Phase 3: Custom migration helpers

Support structured replacements for current raw custom SQL:

- Timescale hypertables, continuous aggregates, compression settings, and policies.
- `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS ... UNIQUE USING INDEX ...` as a binsql-native construct.

Do not support raw `DO` blocks.

## Corpus-Derived Acceptance Tests

Create fixtures from these sources:

- `templates/*/code/backend/migrations/**/migration.sql`.
- `~/Library/Application Support/build-it-now/projects-data/**/backend/migrations/**/migration.sql`.
- `/Users/richard.samuelsson/projects/ai-platform/backend/migrations/**/migration.sql`.
- Raw SQL snippets from `/Users/richard.samuelsson/projects/ai-platform/backend/analytics-service.ts` and `router.ts`.

Test categories:

- Parse and serialize every supported fixture statement.
- Snapshot canonical SQL for representative statements.
- Reject unsupported raw `DO $$` with `E_UNSUPPORTED_STATEMENT` and guidance for the binsql-native replacement.
- Reject catalog lookup variants:
  - `FROM pg_tables`
  - `FROM pg_catalog.pg_class`
  - `FROM information_schema.tables`
  - `'models'::regclass`
  - `to_regclass('models')`
  - computed lookup strings passed to metadata functions.
- Prove comments and string literals mentioning catalog names do not matter.
- Prove all project table references serialize with `projectSchema`.
- Prove `vector(n)` serializes through `extensionSchema` and user-authored `public.vector` is rejected.
- Prove Timescale functions reject non-project table/view names.

## Non-goals for v1

- Full PostgreSQL grammar compatibility.
- Arbitrary user-defined functions.
- Arbitrary extension support.
- Stored procedures, triggers, raw `DO`, `CALL`, or dynamic SQL.
- Direct catalog introspection. Use Build it Now host APIs such as `@/db-utils` for table/column inspection.
- Preserving user formatting or comments.

## Open Decisions

- Whether runtime `SELECT *` should be allowed for project tables or normalized only after schema-aware column expansion.
- Whether extension schema should remain `public` or move to a dedicated schema such as `extensions`.
- Whether binsql should own a schema registry so it can validate column names and expand stars before serialization.
- Whether migrations should be compiled to one SQL string or a list of PostgreSQL statements with structured execution metadata.
