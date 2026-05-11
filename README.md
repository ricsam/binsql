# binsql

`binsql` parses an allowlisted SQL dialect into its own AST and serializes that
AST into canonical PostgreSQL SQL. The original input string is never forwarded
to PostgreSQL.

The current implementation includes the first runtime slice plus early migration
support:

- Chevrotain-backed lexing and statement admission.
- Pratt expression parsing for arithmetic, predicates, casts, functions, CTEs,
  joins, window functions, and pgvector distance operators.
- Project-schema normalization for table references.
- Migration DDL for `CREATE TABLE`, `CREATE INDEX`, `DROP TABLE`, and selected
  `ALTER TABLE` helpers.
- Bun tests that validate serialized SQL with `libpg-query`, including curated
  corpus fixtures under `test/fixtures/corpus`.

## API

```ts
import { compile, parse, serialize } from "binsql";

const result = compile("select id from users where email = $1", {
  mode: "runtime",
  projectSchema: "project_abc_main",
  parameters: ["a@example.com"],
});

console.log(result.sql);
```

## Development

To install dependencies:

```bash
bun install
```

To test:

```bash
bun test
```

To typecheck:

```bash
bun run typecheck
```

To prepare a release:

```bash
bun run changeset
bun run version-packages
```

To build the npm package locally:

```bash
bun run build:npm
```
