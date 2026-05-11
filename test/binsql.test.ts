import { describe, expect, test } from "bun:test";
import { parse as parsePg } from "libpg-query";
import { BinSqlError, compile } from "../index";

const projectSchema = "project_abc_main";
const extensionSchema = "extensions";

async function expectPostgresParses(sql: string) {
  await expect(parsePg(sql)).resolves.toBeTruthy();
}

function expectDiagnostic(fn: () => unknown, code: BinSqlError["diagnostic"]["code"]) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BinSqlError);
    expect((error as BinSqlError).diagnostic.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("runtime compiler", () => {
  test("normalizes a parameterized SELECT", async () => {
    const result = compile("select id from users where email = $1", {
      mode: "runtime",
      projectSchema,
      parameters: ["a@example.com"],
    });

    expect(result.parameters).toEqual(["a@example.com"]);
    expect(result.sql).toBe(
      'SELECT "project_abc_main"."users"."id" FROM "project_abc_main"."users" WHERE "project_abc_main"."users"."email" = $1;',
    );
    await expectPostgresParses(result.sql);
  });

  test("supports COUNT casts", async () => {
    const result = compile("SELECT COUNT(*)::int AS total_count FROM credit_events WHERE user_id = $1;", {
      mode: "runtime",
      projectSchema,
    });

    expect(result.sql).toBe(
      'SELECT count(*)::integer AS "total_count" FROM "project_abc_main"."credit_events" WHERE "project_abc_main"."credit_events"."user_id" = $1;',
    );
    await expectPostgresParses(result.sql);
  });

  test("supports CTEs and window functions", async () => {
    const result = compile(
      `
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
    `,
      { mode: "runtime", projectSchema },
    );

    expect(result.sql).toContain('WITH "events" AS');
    expect(result.sql).toContain("ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW");
    await expectPostgresParses(result.sql);
  });

  test("supports INSERT, UPDATE, and DELETE", async () => {
    const statements = [
      "INSERT INTO users (id, email, active) VALUES (gen_random_uuid(), $1, true) RETURNING id;",
      "UPDATE users SET email = $1 WHERE id = $2 RETURNING id;",
      'DELETE FROM "models" a USING "models" b WHERE a.model_id = b.model_id AND a.ctid < b.ctid;',
    ];

    for (const input of statements) {
      const result = compile(input, { mode: "runtime", projectSchema });
      await expectPostgresParses(result.sql);
    }
  });

  test("supports runtime vector distance operators", async () => {
    const result = compile(
      "SELECT id FROM documents ORDER BY embedding <=> $1 LIMIT $2;",
      { mode: "runtime", projectSchema },
    );

    expect(result.sql).toContain("<=>");
    await expectPostgresParses(result.sql);
  });
});

describe("migration compiler", () => {
  test("normalizes vector column types through the extension schema", async () => {
    const result = compile(
      "CREATE TABLE embeddings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), embedding vector(1536) NOT NULL);",
      { mode: "migration", projectSchema, extensionSchema },
    );

    expect(result.sql).toContain('"extensions"."vector"(1536)');
    await expectPostgresParses(result.sql);
  });

  test("supports CREATE INDEX with partial predicates", async () => {
    const result = compile(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email ASC NULLS LAST) WHERE email IS NOT NULL;",
      { mode: "migration", projectSchema },
    );

    expect(result.sql).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "project_abc_main"."users" ("email" ASC NULLS LAST) WHERE "email" IS NOT NULL;',
    );
    await expectPostgresParses(result.sql);
  });

  test("supports DROP TABLE and ALTER TABLE helpers", async () => {
    const statements = [
      "DROP TABLE IF EXISTS old_events CASCADE;",
      "ALTER TABLE models ADD CONSTRAINT IF NOT EXISTS models_model_id_unique UNIQUE USING INDEX models_model_id_unique;",
    ];

    for (const input of statements) {
      const result = compile(input, { mode: "migration", projectSchema });
      await expectPostgresParses(result.sql);
    }
  });
});

describe("policy rejects", () => {
  test("rejects unsupported raw DO blocks with a stable diagnostic", () => {
    expectDiagnostic(
      () => compile("DO $$ BEGIN RAISE NOTICE 'nope'; END $$;", { mode: "migration", projectSchema }),
      "E_UNSUPPORTED_STATEMENT",
    );
  });

  test("rejects catalog relations and lookup casts", () => {
    expectDiagnostic(() => compile("SELECT * FROM pg_tables;", { mode: "runtime", projectSchema }), "E_FORBIDDEN_CATALOG");
    expectDiagnostic(
      () => compile("SELECT * FROM pg_catalog.pg_class;", { mode: "runtime", projectSchema }),
      "E_FORBIDDEN_SCHEMA",
    );
    expectDiagnostic(
      () => compile("SELECT 'models'::regclass FROM models;", { mode: "runtime", projectSchema }),
      "E_FORBIDDEN_TYPE",
    );
    expectDiagnostic(
      () => compile("SELECT to_regclass('models') FROM models;", { mode: "runtime", projectSchema }),
      "E_FORBIDDEN_FUNCTION",
    );
  });

  test("comments and string literals mentioning catalogs do not matter", async () => {
    const result = compile(
      `
      -- FROM pg_tables
      SELECT 'pg_catalog.pg_class' AS note FROM users;
    `,
      { mode: "runtime", projectSchema },
    );

    await expectPostgresParses(result.sql);
  });

  test("rejects user-authored extension schemas for vector", () => {
    expectDiagnostic(
      () => compile("CREATE TABLE embeddings (embedding public.vector(1536));", { mode: "migration", projectSchema }),
      "E_FORBIDDEN_SCHEMA",
    );
  });

  test("requires migration mode for DDL", () => {
    expectDiagnostic(
      () => compile("CREATE TABLE users (id uuid PRIMARY KEY);", { mode: "runtime", projectSchema }),
      "E_MODE_REQUIRED",
    );
  });
});
