import { describe, expect, test } from "bun:test";
import { parse as parsePg } from "libpg-query";
import type { BinSqlDiagnostic, BinSqlMode } from "../index";
import { BinSqlError, compile, splitStatements } from "../index";

interface CorpusExpectations {
  expectedFailures: {
    code: BinSqlDiagnostic["code"];
    statementPattern: string;
    reason: string;
  }[];
}

const fixtureRoot = `${import.meta.dir}/fixtures/corpus`;
const projectSchema = "project_corpus_main";
const extensionSchema = "extensions";
const runtimeFixtures = new Set(["analytics-runtime-queries.sql", "usage-log-runtime-queries.sql"]);

const expectations = (await Bun.file(`${fixtureRoot}/expectations.json`).json()) as CorpusExpectations;
const expectedFailures = expectations.expectedFailures.map((entry) => ({
  ...entry,
  regex: new RegExp(entry.statementPattern, "i"),
  hits: 0,
}));

describe("corpus fixtures", () => {
  test("keep SQL fixtures flat and descriptively named", () => {
    const nestedOrTimestampedFixtures = sqlFixturePaths()
      .map(relativeFixturePath)
      .filter((fixturePath) => fixturePath.includes("/") || /^\d{8,}/.test(fixturePath));

    expect(
      nestedOrTimestampedFixtures,
      `Corpus SQL fixtures should live directly under fixtures/corpus with timestamp-free names:\n${nestedOrTimestampedFixtures
        .map((fixturePath) => `- ${fixturePath}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("do not keep duplicate SQL fixture copies", async () => {
    const fixturesBySql = new Map<string, string[]>();

    for (const fixturePath of sqlFixturePaths()) {
      const normalizedSql = (await Bun.file(fixturePath).text()).replace(/\r\n/g, "\n").trim();
      const fixtures = fixturesBySql.get(normalizedSql) ?? [];
      fixtures.push(relativeFixturePath(fixturePath));
      fixturesBySql.set(normalizedSql, fixtures);
    }

    const duplicateGroups = [...fixturesBySql.values()].filter((fixtures) => fixtures.length > 1);
    expect(
      duplicateGroups,
      `Duplicate corpus fixtures should be collapsed to a single representative copy:\n${duplicateGroups
        .map((fixtures) => `- ${fixtures.join("\n  ")}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("compile curated SQL fixtures and validate emitted PostgreSQL", async () => {
    const fixturePaths = sqlFixturePaths();
    expect(fixturePaths.length).toBeGreaterThan(0);

    let compiledStatements = 0;
    let expectedFailureStatements = 0;

    for (const fixturePath of fixturePaths) {
      const sql = await Bun.file(fixturePath).text();
      const mode = modeForFixture(fixturePath, sql);
      const statements = splitStatements(sql);
      expect(statements.length, fixturePath).toBeGreaterThan(0);

      for (const statement of statements) {
        try {
          const result = compile(statement, { mode, projectSchema, extensionSchema });
          await expect(parsePg(result.sql), statementLabel(fixturePath, statement)).resolves.toBeTruthy();
          compiledStatements++;
        } catch (error) {
          const diagnostic = error instanceof BinSqlError ? error.diagnostic : undefined;
          const expectedFailure = expectedFailures.find(
            (entry) => diagnostic?.code === entry.code && entry.regex.test(statement),
          );
          if (!expectedFailure) {
            throw new Error(
              [
                `Unexpected corpus failure in ${fixturePath}`,
                `mode: ${mode}`,
                `diagnostic: ${diagnostic ? `${diagnostic.code}: ${diagnostic.message}` : String(error)}`,
                `statement:`,
                statement,
              ].join("\n"),
            );
          }
          expectedFailure.hits++;
          expectedFailureStatements++;
        }
      }
    }

    expect(compiledStatements).toBeGreaterThan(0);
    expect(expectedFailureStatements).toBeGreaterThan(0);
    for (const expectedFailure of expectedFailures) {
      expect(expectedFailure.hits, expectedFailure.reason).toBeGreaterThan(0);
    }
  });
});

function modeForFixture(fixturePath: string, sql: string): BinSqlMode {
  if (runtimeFixtures.has(relativeFixturePath(fixturePath))) {
    return "runtime";
  }
  if (
    sql.includes("build-it-now:migration-class=timescale") ||
    /\btimescaledb\./i.test(sql) ||
    /\bcreate_hypertable\s*\(/i.test(sql)
  ) {
    return "timescaleMigration";
  }
  return "migration";
}

function sqlFixturePaths(): string[] {
  return [...new Bun.Glob("**/*.sql").scanSync({ cwd: fixtureRoot, absolute: true })].sort();
}

function relativeFixturePath(fixturePath: string): string {
  return fixturePath.slice(fixtureRoot.length + 1);
}

function statementLabel(fixturePath: string, statement: string): string {
  const firstLine = statement.split(/\r?\n/, 1)[0]?.slice(0, 120) ?? "";
  return `${fixturePath}: ${firstLine}`;
}
