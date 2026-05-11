import { CstParser, type CstNode, type IToken } from "chevrotain";
import type {
  AlterTableAction,
  AlterTableStatement,
  Assignment,
  BinSqlAst,
  BinSqlMode,
  BinSqlStatement,
  CaseExpression,
  ColumnConstraint,
  ColumnDef,
  CreateIndexStatement,
  CreateTableStatement,
  DeleteStatement,
  DropTableStatement,
  Expression,
  FromClause,
  FromItem,
  FunctionArg,
  FunctionCallExpression,
  IndexColumn,
  InsertStatement,
  JoinClause,
  OrderByItem,
  ParseOptions,
  RelationName,
  SelectStatement,
  SelectTarget,
  SqlType,
  TableConstraint,
  TableOption,
  TableRef,
  UpdateStatement,
  WindowSpec,
} from "./ast";
import { binSqlError } from "./errors";
import {
  allTokens,
  Alter,
  As,
  Cast,
  Comma,
  Create,
  Delete,
  Dot,
  Drop,
  Identifier,
  Insert,
  LParen,
  QuotedIdentifier,
  RParen,
  Select,
  Semicolon,
  StringLiteral,
  Table,
  Update,
  With,
  sqlLexer,
} from "./lexer";

type StopPredicate = (token: IToken) => boolean;

const tokenBodyTypes = allTokens.filter(
  (tokenType) =>
    !["WhiteSpace", "LineComment", "BlockComment", "Semicolon"].includes(tokenType.name),
);

class ChevrotainStatementGrammar extends CstParser {
  script!: () => CstNode;
  statement!: () => CstNode;
  statementToken!: () => CstNode;

  constructor() {
    super(allTokens);
    const $ = this;

    $.RULE("script", () => {
      $.MANY(() => {
        $.OR([
          { ALT: () => $.SUBRULE($.statement) },
          { ALT: () => $.CONSUME(Semicolon) },
        ]);
      });
    });

    $.RULE("statement", () => {
      $.OR([
        { ALT: () => $.CONSUME(Select) },
        { ALT: () => $.CONSUME(With) },
        { ALT: () => $.CONSUME(Insert) },
        { ALT: () => $.CONSUME(Update) },
        { ALT: () => $.CONSUME(Delete) },
        { ALT: () => $.CONSUME(Create) },
        { ALT: () => $.CONSUME(Alter) },
        { ALT: () => $.CONSUME(Drop) },
      ]);
      $.MANY(() => {
        $.SUBRULE($.statementToken);
      });
    });

    $.RULE("statementToken", () => {
      $.OR(tokenBodyTypes.map((tokenType) => ({ ALT: () => $.CONSUME(tokenType) })));
    });

    this.performSelfAnalysis();
  }
}

const statementGrammar = new ChevrotainStatementGrammar();

export function parse(input: string, options: ParseOptions): BinSqlAst {
  if (!["runtime", "migration", "timescaleMigration"].includes(options.mode)) {
    binSqlError({ code: "E_MODE_REQUIRED", message: "A binsql mode is required" });
  }

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

  statementGrammar.input = lexResult.tokens;
  statementGrammar.script();
  if (statementGrammar.errors.length > 0) {
    const first = statementGrammar.errors[0]!;
    const token = first.token;
    binSqlError({
      code: "E_UNSUPPORTED_STATEMENT",
      message: first.message,
      position: tokenPosition(token),
    });
  }

  const parser = new AstParser(lexResult.tokens, options.mode);
  return parser.parseScript();
}

function parseSelectFromTokens(tokens: IToken[], mode: BinSqlMode): SelectStatement {
  const parser = new AstParser(tokens, mode);
  const statement = parser.parseStatement();
  if (statement.kind !== "select") {
    parser.fail(tokens[0], "E_PARSE", "Expected SELECT subquery");
  }
  if (!parser.isAtEnd()) {
    parser.fail(parser.peek(), "E_PARSE", "Unexpected token after SELECT subquery");
  }
  return statement as SelectStatement;
}

class AstParser {
  private index = 0;

  constructor(
    private readonly tokens: IToken[],
    private readonly mode: BinSqlMode,
  ) {}

  parseScript(): BinSqlAst {
    const statements: BinSqlStatement[] = [];
    while (!this.isAtEnd()) {
      this.skipSemicolons();
      if (this.isAtEnd()) {
        break;
      }
      statements.push(this.parseStatement());
      this.skipSemicolons();
    }
    return { kind: "script", mode: this.mode, statements };
  }

  parseStatement(): BinSqlStatement {
    if (this.keyword("WITH") || this.keyword("SELECT")) {
      return this.parseSelectStatement();
    }
    if (this.keyword("INSERT")) {
      return this.parseInsertStatement();
    }
    if (this.keyword("UPDATE")) {
      return this.parseUpdateStatement();
    }
    if (this.keyword("DELETE")) {
      return this.parseDeleteStatement();
    }
    if (this.keyword("CREATE")) {
      return this.parseCreateStatement();
    }
    if (this.keyword("ALTER")) {
      return this.parseAlterTableStatement();
    }
    if (this.keyword("DROP")) {
      return this.parseDropTableStatement();
    }
    if (this.keyword("DO")) {
      this.fail(
        this.peek(),
        "E_UNSUPPORTED_STATEMENT",
        "DO blocks are not supported. Use a structured binsql migration statement instead.",
      );
    }
    this.fail(this.peek(), "E_UNSUPPORTED_STATEMENT", "Unsupported SQL statement");
  }

  parseSelectStatement(): SelectStatement {
    const ctes = [];
    if (this.optionalKeyword("WITH")) {
      do {
        const name = this.consumeIdentifier("Expected CTE name");
        this.consumeKeyword("AS");
        this.consumeToken("LParen", "Expected '(' before CTE query");
        const inner = this.collectParenthesizedTokens();
        ctes.push({ name, select: parseSelectFromTokens(inner, this.mode) });
      } while (this.optionalToken("Comma"));
    }

    this.consumeKeyword("SELECT");
    const distinct = this.optionalKeyword("DISTINCT");
    const targets = this.parseSelectTargets(() =>
      this.keyword("FROM") ||
      this.keyword("WHERE") ||
      this.keyword("GROUP") ||
      this.keyword("ORDER") ||
      this.keyword("LIMIT") ||
      this.keyword("OFFSET") ||
      this.statementBoundary(),
    );

    let from: FromClause | undefined;
    if (this.optionalKeyword("FROM")) {
      from = this.parseFromClause();
    }

    const where = this.optionalKeyword("WHERE")
      ? this.parseExpressionUntil(() =>
          this.keyword("GROUP") ||
          this.keyword("ORDER") ||
          this.keyword("LIMIT") ||
          this.keyword("OFFSET") ||
          this.statementBoundary(),
        )
      : undefined;

    const groupBy = this.optionalKeyword("GROUP")
      ? (this.consumeKeyword("BY"),
        this.parseExpressionListUntil(() =>
          this.keyword("ORDER") ||
          this.keyword("LIMIT") ||
          this.keyword("OFFSET") ||
          this.statementBoundary(),
        ))
      : [];

    const orderBy = this.optionalKeyword("ORDER")
      ? (this.consumeKeyword("BY"),
        this.parseOrderByUntil(() =>
          this.keyword("LIMIT") || this.keyword("OFFSET") || this.statementBoundary(),
        ))
      : [];

    const limit = this.optionalKeyword("LIMIT")
      ? this.parseExpressionUntil(() => this.keyword("OFFSET") || this.statementBoundary())
      : undefined;

    const offset = this.optionalKeyword("OFFSET")
      ? this.parseExpressionUntil(() => this.statementBoundary())
      : undefined;

    return { kind: "select", ctes, distinct, targets, from, where, groupBy, orderBy, limit, offset };
  }

  private parseInsertStatement(): InsertStatement {
    this.consumeKeyword("INSERT");
    this.consumeKeyword("INTO");
    const into = this.parseRelationName();
    const columns = this.optionalToken("LParen") ? this.parseIdentifierListInParensBody() : [];
    this.consumeKeyword("VALUES");
    const values: Expression[][] = [];
    do {
      this.consumeToken("LParen", "Expected '(' before VALUES row");
      const rowTokens = this.collectParenthesizedTokens();
      values.push(this.parseExpressionListFromTokens(rowTokens));
    } while (this.optionalToken("Comma"));

    let onConflict;
    if (this.optionalKeyword("ON")) {
      this.consumeKeyword("CONFLICT");
      const columnsForConflict = this.optionalToken("LParen")
        ? this.parseIdentifierListInParensBody()
        : [];
      this.consumeKeyword("DO");
      if (this.optionalKeyword("NOTHING")) {
        onConflict = { kind: "nothing" as const, columns: columnsForConflict };
      } else {
        this.consumeKeyword("UPDATE");
        this.consumeKeyword("SET");
        const assignments = this.parseAssignmentsUntil(() =>
          this.keyword("RETURNING") || this.statementBoundary(),
        );
        onConflict = { kind: "update" as const, columns: columnsForConflict, assignments };
      }
    }

    const returning = this.optionalKeyword("RETURNING")
      ? this.parseSelectTargets(() => this.statementBoundary())
      : [];
    return { kind: "insert", into, columns, values, onConflict, returning };
  }

  private parseUpdateStatement(): UpdateStatement {
    this.consumeKeyword("UPDATE");
    const table = this.parseTableRef();
    this.consumeKeyword("SET");
    const assignments = this.parseAssignmentsUntil(() =>
      this.keyword("WHERE") || this.keyword("RETURNING") || this.statementBoundary(),
    );
    const where = this.optionalKeyword("WHERE")
      ? this.parseExpressionUntil(() => this.keyword("RETURNING") || this.statementBoundary())
      : undefined;
    const returning = this.optionalKeyword("RETURNING")
      ? this.parseSelectTargets(() => this.statementBoundary())
      : [];
    return { kind: "update", table, assignments, where, returning };
  }

  private parseDeleteStatement(): DeleteStatement {
    this.consumeKeyword("DELETE");
    this.consumeKeyword("FROM");
    const from = this.parseTableRef();
    const using: TableRef[] = [];
    if (this.optionalKeyword("USING")) {
      do {
        using.push(this.parseTableRef());
      } while (this.optionalToken("Comma"));
    }
    const where = this.optionalKeyword("WHERE")
      ? this.parseExpressionUntil(() => this.keyword("RETURNING") || this.statementBoundary())
      : undefined;
    const returning = this.optionalKeyword("RETURNING")
      ? this.parseSelectTargets(() => this.statementBoundary())
      : [];
    return { kind: "delete", from, using, where, returning };
  }

  private parseCreateStatement(): CreateTableStatement | CreateIndexStatement {
    this.consumeKeyword("CREATE");
    const unique = this.optionalKeyword("UNIQUE");
    if (this.keyword("TABLE")) {
      return this.parseCreateTableStatement();
    }
    if (this.keyword("INDEX")) {
      return this.parseCreateIndexStatement(unique);
    }
    this.fail(this.peek(), "E_UNSUPPORTED_STATEMENT", "Only CREATE TABLE and CREATE INDEX are supported");
  }

  private parseCreateTableStatement(): CreateTableStatement {
    this.requireMigrationMode(this.peek());
    this.consumeKeyword("TABLE");
    const ifNotExists = this.parseIfNotExists();
    const table = this.parseRelationName();
    this.consumeToken("LParen", "Expected '(' before CREATE TABLE body");
    const bodyTokens = this.collectParenthesizedTokens();
    const columns: ColumnDef[] = [];
    const constraints: TableConstraint[] = [];
    for (const itemTokens of splitTopLevel(bodyTokens, (token) => tokenName(token) === "Comma")) {
      if (itemTokens.length === 0) continue;
      if (keywordImage(itemTokens[0], "CONSTRAINT") || isTableConstraintStart(itemTokens[0]!)) {
        constraints.push(parseTableConstraintTokens(itemTokens, this.mode));
      } else {
        columns.push(parseColumnDefTokens(itemTokens, this.mode));
      }
    }
    return { kind: "createTable", ifNotExists, table, columns, constraints };
  }

  private parseCreateIndexStatement(unique: boolean): CreateIndexStatement {
    this.requireMigrationMode(this.peek());
    this.consumeKeyword("INDEX");
    const ifNotExists = this.parseIfNotExists();
    const name = this.consumeIdentifier("Expected index name");
    this.consumeKeyword("ON");
    const table = this.parseRelationName();
    const method = this.optionalKeyword("USING") ? this.consumeIdentifier("Expected index method") : undefined;
    this.consumeToken("LParen", "Expected '(' before index columns");
    const columnTokens = this.collectParenthesizedTokens();
    const columns = splitTopLevel(columnTokens, (token) => tokenName(token) === "Comma").map((tokens) =>
      parseIndexColumnTokens(tokens, this.mode),
    );
    const where = this.optionalKeyword("WHERE")
      ? this.parseExpressionUntil(() => this.statementBoundary())
      : undefined;
    return { kind: "createIndex", unique, ifNotExists, name, table, method, columns, where };
  }

  private parseAlterTableStatement(): AlterTableStatement {
    this.requireMigrationMode(this.peek());
    this.consumeKeyword("ALTER");
    this.consumeKeyword("TABLE");
    const table = this.parseRelationName();
    let action: AlterTableAction;
    if (this.optionalKeyword("ADD")) {
      if (this.optionalKeyword("COLUMN")) {
        const ifNotExists = this.parseIfNotExists();
        const tokens = this.collectUntilTopLevel(() => this.statementBoundary());
        action = { kind: "addColumn", ifNotExists, column: parseColumnDefTokens(tokens, this.mode) };
      } else {
        this.consumeKeyword("CONSTRAINT");
        const ifNotExists = this.parseIfNotExists();
        const name = this.consumeIdentifier("Expected constraint name");
        const remaining = this.collectUntilTopLevel(() => this.statementBoundary());
        if (
          keywordImage(remaining[0], "UNIQUE") &&
          keywordImage(remaining[1], "USING") &&
          keywordImage(remaining[2], "INDEX") &&
          isIdentifierLike(remaining[3])
        ) {
          const index = identifierText(remaining[3]);
          action = { kind: "addUniqueUsingIndex", ifNotExists, name, index };
        } else {
          action = {
            kind: "addConstraint",
            ifNotExists,
            constraint: parseTableConstraintTokens(
              [syntheticIdentifier("CONSTRAINT"), syntheticIdentifier(name), ...remaining],
              this.mode,
            ),
          };
        }
      }
    } else if (this.optionalKeyword("DROP")) {
      this.consumeKeyword("COLUMN");
      const ifExists = this.optionalKeyword("IF") ? (this.consumeKeyword("EXISTS"), true) : false;
      const column = this.consumeIdentifier("Expected column name");
      action = { kind: "dropColumn", ifExists, column };
    } else if (this.optionalKeyword("RENAME")) {
      if (this.optionalKeyword("COLUMN")) {
        const from = this.consumeIdentifier("Expected column name");
        this.consumeKeyword("TO");
        const to = this.consumeIdentifier("Expected new column name");
        action = { kind: "renameColumn", from, to };
      } else {
        this.consumeKeyword("TO");
        const name = this.consumeIdentifier("Expected new table name");
        action = { kind: "renameTable", name };
      }
    } else if (this.optionalKeyword("SET")) {
      if (this.mode !== "timescaleMigration") {
        this.fail(this.peek(-1), "E_MODE_REQUIRED", "ALTER TABLE SET options require timescaleMigration mode");
      }
      this.consumeToken("LParen", "Expected '(' before ALTER TABLE options");
      const optionTokens = this.collectParenthesizedTokens();
      action = { kind: "setOptions", options: parseTableOptions(optionTokens) };
    } else {
      this.fail(this.peek(), "E_UNSUPPORTED_STATEMENT", "Unsupported ALTER TABLE action");
    }
    return { kind: "alterTable", table, action };
  }

  private parseDropTableStatement(): DropTableStatement {
    this.requireMigrationMode(this.peek());
    this.consumeKeyword("DROP");
    this.consumeKeyword("TABLE");
    const ifExists = this.optionalKeyword("IF") ? (this.consumeKeyword("EXISTS"), true) : false;
    const table = this.parseRelationName();
    const cascade = this.optionalKeyword("CASCADE");
    return { kind: "dropTable", ifExists, table, cascade };
  }

  private parseFromClause(): FromClause {
    const base = this.parseFromItem();
    const joins: JoinClause[] = [];
    while (this.isJoinStart()) {
      let type: JoinClause["type"] = "join";
      if (this.optionalKeyword("INNER")) {
        type = "inner";
      } else if (this.optionalKeyword("LEFT")) {
        type = "left";
      }
      this.consumeKeyword("JOIN");
      const item = this.parseFromItem();
      let on: Expression | undefined;
      let using: string[] | undefined;
      if (this.optionalKeyword("ON")) {
        on = this.parseExpressionUntil(() =>
          this.isJoinStart() ||
          this.keyword("WHERE") ||
          this.keyword("GROUP") ||
          this.keyword("ORDER") ||
          this.keyword("LIMIT") ||
          this.keyword("OFFSET") ||
          this.statementBoundary(),
        );
      } else if (this.optionalKeyword("USING")) {
        this.consumeToken("LParen", "Expected '(' after USING");
        using = this.parseIdentifierListInParensBody();
      } else {
        this.fail(this.peek(), "E_PARSE", "Expected ON or USING after JOIN target");
      }
      joins.push({ type, item, on, using });
    }
    return { base, joins };
  }

  private parseFromItem(): FromItem {
    if (this.optionalToken("LParen")) {
      const inner = this.collectParenthesizedTokens();
      const alias = this.consumeIdentifier("Expected alias after subquery");
      return { kind: "subquery", select: parseSelectFromTokens(inner, this.mode), alias };
    }
    return this.parseTableRef();
  }

  private parseTableRef(): TableRef {
    const name = this.parseRelationName();
    let alias: string | undefined;
    if (this.optionalKeyword("AS")) {
      alias = this.consumeIdentifier("Expected table alias");
    } else if (this.nextIsIdentifierLike() && !this.nextStartsClause()) {
      alias = this.consumeIdentifier("Expected table alias");
    }
    return { kind: "table", name, alias };
  }

  private parseRelationName(): RelationName {
    const first = this.consumeIdentifier("Expected relation name");
    if (this.optionalToken("Dot")) {
      const second = this.consumeIdentifier("Expected relation name after schema");
      return { schema: first, name: second };
    }
    return { name: first };
  }

  private parseSelectTargets(stop: StopPredicate): SelectTarget[] {
    const segments = this.collectCommaSeparatedUntil(stop);
    return segments.map((tokens) => parseSelectTargetTokens(tokens, this.mode));
  }

  parseOrderByUntil(stop: StopPredicate): OrderByItem[] {
    return this.collectCommaSeparatedUntil(stop).map((tokens) => parseOrderByTokens(tokens, this.mode));
  }

  private parseAssignmentsUntil(stop: StopPredicate): Assignment[] {
    return this.collectCommaSeparatedUntil(stop).map((tokens) => {
      const equalsIndex = findTopLevelToken(tokens, (token) => tokenName(token) === "Equals");
      if (equalsIndex <= 0) {
        this.fail(tokens[0], "E_PARSE", "Expected assignment");
      }
      const columnTokens = tokens.slice(0, equalsIndex);
      const valueTokens = tokens.slice(equalsIndex + 1);
      if (columnTokens.length !== 1 || !isIdentifierLike(columnTokens[0]!)) {
        this.fail(columnTokens[0], "E_PARSE", "Expected assignment column");
      }
      return {
        column: identifierText(columnTokens[0]!),
        value: parseExpressionTokens(valueTokens, this.mode),
      };
    });
  }

  private parseExpressionUntil(stop: StopPredicate): Expression {
    const tokens = this.collectUntilTopLevel(stop);
    return parseExpressionTokens(tokens, this.mode);
  }

  parseExpressionListUntil(stop: StopPredicate): Expression[] {
    return this.collectCommaSeparatedUntil(stop).map((tokens) => parseExpressionTokens(tokens, this.mode));
  }

  private parseExpressionListFromTokens(tokens: IToken[]): Expression[] {
    return splitTopLevel(tokens, (token) => tokenName(token) === "Comma").map((segment) =>
      parseExpressionTokens(segment, this.mode),
    );
  }

  private collectCommaSeparatedUntil(stop: StopPredicate): IToken[][] {
    const groups: IToken[][] = [];
    let current: IToken[] = [];
    let depth = 0;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (depth === 0 && stop(token)) {
        break;
      }
      if (depth === 0 && tokenName(token) === "Comma") {
        this.advance();
        groups.push(current);
        current = [];
        continue;
      }
      if (tokenName(token) === "LParen") depth++;
      if (tokenName(token) === "RParen") {
        if (depth === 0) break;
        depth--;
      }
      current.push(this.advance());
    }
    if (current.length > 0 || groups.length > 0) {
      groups.push(current);
    }
    return groups.filter((group) => group.length > 0);
  }

  private collectUntilTopLevel(stop: StopPredicate): IToken[] {
    const result: IToken[] = [];
    let depth = 0;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (depth === 0 && stop(token)) {
        break;
      }
      if (tokenName(token) === "LParen") depth++;
      if (tokenName(token) === "RParen") {
        if (depth === 0) {
          break;
        }
        depth--;
      }
      result.push(this.advance());
    }
    return result;
  }

  private collectParenthesizedTokens(): IToken[] {
    const result: IToken[] = [];
    let depth = 1;
    while (!this.isAtEnd()) {
      const token = this.advance();
      if (tokenName(token) === "LParen") {
        depth++;
      } else if (tokenName(token) === "RParen") {
        depth--;
        if (depth === 0) {
          return result;
        }
      }
      result.push(token);
    }
    this.fail(this.peek(-1), "E_PARSE", "Unclosed parenthesized expression");
  }

  private parseIdentifierListInParensBody(): string[] {
    const tokens = this.collectParenthesizedTokens();
    return splitTopLevel(tokens, (token) => tokenName(token) === "Comma").map((segment) => {
      if (segment.length !== 1 || !isIdentifierLike(segment[0]!)) {
        this.fail(segment[0], "E_PARSE", "Expected identifier list");
      }
      return identifierText(segment[0]!);
    });
  }

  private parseIfNotExists(): boolean {
    if (!this.optionalKeyword("IF")) return false;
    this.consumeKeyword("NOT");
    this.consumeKeyword("EXISTS");
    return true;
  }

  isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  peek(relative = 0): IToken {
    const token = this.tokens[this.index + relative];
    if (!token) {
      return this.tokens[this.tokens.length - 1] ?? syntheticIdentifier("<eof>");
    }
    return token;
  }

  private advance(): IToken {
    const token = this.peek();
    this.index++;
    return token;
  }

  private skipSemicolons(): void {
    while (this.optionalToken("Semicolon")) {
      // Keep consuming statement separators.
    }
  }

  keyword(name: string, relative = 0): boolean {
    const token = this.tokens[this.index + relative];
    return keywordImage(token, name);
  }

  optionalKeyword(name: string): boolean {
    if (!this.keyword(name)) return false;
    this.index++;
    return true;
  }

  consumeKeyword(name: string): void {
    if (!this.optionalKeyword(name)) {
      this.fail(this.peek(), "E_PARSE", `Expected ${name}`);
    }
  }

  private optionalToken(name: string): boolean {
    if (this.isAtEnd()) return false;
    if (tokenName(this.peek()) !== name) return false;
    this.index++;
    return true;
  }

  private consumeToken(name: string, message: string): void {
    if (!this.optionalToken(name)) {
      this.fail(this.peek(), "E_PARSE", message);
    }
  }

  private consumeIdentifier(message: string): string {
    const token = this.peek();
    if (!isIdentifierLike(token)) {
      this.fail(token, "E_PARSE", message);
    }
    this.index++;
    return identifierText(token);
  }

  private nextIsIdentifierLike(): boolean {
    return isIdentifierLike(this.peek());
  }

  private nextStartsClause(): boolean {
    return [
      "WHERE",
      "GROUP",
      "ORDER",
      "LIMIT",
      "OFFSET",
      "JOIN",
      "INNER",
      "LEFT",
      "ON",
      "USING",
      "RETURNING",
      "SET",
      "VALUES",
      "ON",
    ].some((word) => this.keyword(word));
  }

  private isJoinStart(): boolean {
    return this.keyword("JOIN") || this.keyword("INNER") || this.keyword("LEFT");
  }

  private statementBoundary(): boolean {
    return this.isAtEnd() || tokenName(this.peek()) === "Semicolon" || tokenName(this.peek()) === "RParen";
  }

  private requireMigrationMode(token: IToken): void {
    if (this.mode === "runtime") {
      this.fail(token, "E_MODE_REQUIRED", "DDL statements require migration mode");
    }
  }

  fail(token: IToken | undefined, code: Parameters<typeof binSqlError>[0]["code"], message: string): never {
    binSqlError({
      code,
      message,
      position: token ? tokenPosition(token) : undefined,
    });
  }
}

class PrattParser {
  private index = 0;

  constructor(
    private readonly tokens: IToken[],
    private readonly mode: BinSqlMode,
  ) {}

  parse(): Expression {
    if (this.tokens.length === 0) {
      this.fail(undefined, "E_PARSE", "Expected expression");
    }
    const expression = this.parseExpression(0);
    if (!this.isAtEnd()) {
      this.fail(this.peek(), "E_PARSE", "Unexpected token in expression");
    }
    return expression;
  }

  private parseExpression(minPrecedence: number): Expression {
    let left = this.parsePrefix();
    while (!this.isAtEnd()) {
      if (this.optionalToken("Cast")) {
        left = { kind: "cast", expression: left, type: this.parseType() };
        continue;
      }
      if (this.keyword("OVER")) {
        if (left.kind !== "call") {
          this.fail(this.peek(), "E_UNSUPPORTED_EXPRESSION", "OVER is only supported on function calls");
        }
        this.advance();
        left = { kind: "window", call: left, spec: this.parseWindowSpec() };
        continue;
      }
      if (this.optionalKeyword("IS")) {
        const not = this.optionalKeyword("NOT");
        this.consumeKeyword("NULL");
        left = { kind: "isNull", expression: left, not };
        continue;
      }

      const not = this.keyword("NOT") && (this.keyword("IN", 1) || this.keyword("LIKE", 1) || this.keyword("ILIKE", 1));
      if (not) {
        this.advance();
      }
      if (this.keyword("IN")) {
        const precedence = 40;
        if (precedence < minPrecedence) break;
        this.advance();
        left = { kind: "in", expression: left, not, values: this.parseInValues() };
        continue;
      }
      if (this.keyword("LIKE") || this.keyword("ILIKE")) {
        const precedence = 40;
        if (precedence < minPrecedence) break;
        const operator = this.advance().image.toUpperCase() as "LIKE" | "ILIKE";
        const pattern = this.parseExpression(precedence + 1);
        left = { kind: "like", expression: left, not, operator, pattern };
        continue;
      }
      if (not) {
        this.fail(this.peek(-1), "E_PARSE", "Expected IN, LIKE, or ILIKE after NOT");
      }

      const operator = this.currentBinaryOperator();
      if (!operator) {
        break;
      }
      const precedence = binaryPrecedence(operator);
      if (precedence < minPrecedence) {
        break;
      }
      this.advance();
      const right = this.parseExpression(precedence + 1);
      left = { kind: "binary", left, operator, right };
    }
    return left;
  }

  private parsePrefix(): Expression {
    if (this.optionalKeyword("NOT")) {
      return { kind: "unary", operator: "NOT", expression: this.parseExpression(55) };
    }
    if (this.optionalToken("Plus")) {
      return { kind: "unary", operator: "+", expression: this.parseExpression(65) };
    }
    if (this.optionalToken("Minus")) {
      return { kind: "unary", operator: "-", expression: this.parseExpression(65) };
    }
    if (this.optionalKeyword("EXISTS")) {
      this.consumeToken("LParen", "Expected '(' after EXISTS");
      const tokens = this.collectParenthesizedTokens();
      return { kind: "exists", select: parseSelectFromTokens(tokens, this.mode) };
    }
    if (this.optionalKeyword("CASE")) {
      return this.parseCaseExpression();
    }
    if (this.optionalKeyword("INTERVAL")) {
      const token = this.advance();
      if (tokenName(token) !== "StringLiteral") {
        this.fail(token, "E_PARSE", "Expected string literal after INTERVAL");
      }
      return { kind: "literal", literalType: "interval", value: stringLiteralValue(token.image) };
    }
    if (this.optionalToken("LParen")) {
      const tokens = this.collectParenthesizedTokens();
      if (tokens.length > 0 && (keywordImage(tokens[0], "SELECT") || keywordImage(tokens[0], "WITH"))) {
        return { kind: "subquery", select: parseSelectFromTokens(tokens, this.mode) };
      }
      return parseExpressionTokens(tokens, this.mode);
    }
    if (this.optionalToken("Star")) {
      return { kind: "star" };
    }
    const token = this.advance();
    switch (tokenName(token)) {
      case "StringLiteral":
        return { kind: "literal", literalType: "string", value: stringLiteralValue(token.image) };
      case "DecimalLiteral":
      case "IntegerLiteral":
        return { kind: "literal", literalType: "number", value: token.image };
      case "Parameter":
        return { kind: "parameter", index: Number(token.image.slice(1)) };
      default:
        break;
    }
    if (keywordImage(token, "NULL")) {
      return { kind: "literal", literalType: "null", value: null };
    }
    if (keywordImage(token, "TRUE") || keywordImage(token, "FALSE")) {
      return { kind: "literal", literalType: "boolean", value: keywordImage(token, "TRUE") };
    }
    if (isIdentifierLike(token)) {
      const parts = [identifierText(token)];
      while (this.optionalToken("Dot")) {
        parts.push(this.consumeIdentifier("Expected identifier after '.'"));
      }
      if (this.optionalToken("LParen")) {
        const argTokens = this.collectParenthesizedTokens();
        return parseFunctionCall(parts, argTokens, this.mode);
      }
      return { kind: "column", parts };
    }
    this.fail(token, "E_UNSUPPORTED_EXPRESSION", "Unsupported expression");
  }

  private parseCaseExpression(): CaseExpression {
    const cases: CaseExpression["cases"] = [];
    while (this.optionalKeyword("WHEN")) {
      const whenTokens = this.collectUntilTopLevel((token) => keywordImage(token, "THEN"));
      this.consumeKeyword("THEN");
      const thenTokens = this.collectUntilTopLevel(
        (token) => keywordImage(token, "WHEN") || keywordImage(token, "ELSE") || keywordImage(token, "END"),
      );
      cases.push({
        when: parseExpressionTokens(whenTokens, this.mode),
        then: parseExpressionTokens(thenTokens, this.mode),
      });
    }
    const elseExpression = this.optionalKeyword("ELSE")
      ? parseExpressionTokens(this.collectUntilTopLevel((token) => keywordImage(token, "END")), this.mode)
      : undefined;
    this.consumeKeyword("END");
    return elseExpression ? { kind: "case", cases, else: elseExpression } : { kind: "case", cases };
  }

  private parseInValues(): Expression[] | SelectStatement {
    this.consumeToken("LParen", "Expected '(' after IN");
    const tokens = this.collectParenthesizedTokens();
    if (tokens.length > 0 && (keywordImage(tokens[0], "SELECT") || keywordImage(tokens[0], "WITH"))) {
      return parseSelectFromTokens(tokens, this.mode);
    }
    return splitTopLevel(tokens, (token) => tokenName(token) === "Comma").map((segment) =>
      parseExpressionTokens(segment, this.mode),
    );
  }

  private parseWindowSpec(): WindowSpec {
    this.consumeToken("LParen", "Expected '(' after OVER");
    const tokens = this.collectParenthesizedTokens();
    const cursor = new AstParser(tokens, this.mode);
    const partitionBy: Expression[] = [];
    const orderBy: OrderByItem[] = [];
    let rows: WindowSpec["rows"];
    if (cursor.optionalKeyword("PARTITION")) {
      cursor.consumeKeyword("BY");
      partitionBy.push(
        ...cursor.parseExpressionListUntil(() => cursor.keyword("ORDER") || cursor.keyword("ROWS") || cursor.isAtEnd()),
      );
    }
    if (cursor.optionalKeyword("ORDER")) {
      cursor.consumeKeyword("BY");
      orderBy.push(...cursor.parseOrderByUntil(() => cursor.keyword("ROWS") || cursor.isAtEnd()));
    }
    if (cursor.optionalKeyword("ROWS")) {
      cursor.consumeKeyword("BETWEEN");
      cursor.consumeKeyword("UNBOUNDED");
      cursor.consumeKeyword("PRECEDING");
      cursor.consumeKeyword("AND");
      cursor.consumeKeyword("CURRENT");
      cursor.consumeKeyword("ROW");
      rows = "UNBOUNDED_PRECEDING_TO_CURRENT_ROW";
    }
    if (!cursor.isAtEnd()) {
      cursor.fail(cursor.peek(), "E_PARSE", "Unexpected token in window specification");
    }
    return { partitionBy, orderBy, rows };
  }

  private parseType(): SqlType {
    const tokens: IToken[] = [];
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (
        tokenName(token) === "LBracket" ||
        tokenName(token) === "RBracket" ||
        tokenName(token) === "Dot" ||
        tokenName(token) === "LParen" ||
        tokenName(token) === "RParen" ||
        isIdentifierLike(token)
      ) {
        tokens.push(this.advance());
        if (tokens.length > 0 && !this.nextContinuesType()) {
          break;
        }
      } else {
        break;
      }
    }
    return parseSqlTypeTokens(tokens);
  }

  private nextContinuesType(): boolean {
    const token = this.peek();
    if (!token) return false;
    if (["LBracket", "RBracket", "Dot", "LParen", "RParen"].includes(tokenName(token) ?? "")) return true;
    if (!isIdentifierLike(token)) return false;
    if (["AND", "OR", "IN", "IS", "LIKE", "ILIKE", "NOT", "WHEN", "THEN", "ELSE", "END"].some((word) => keywordImage(token, word))) {
      return false;
    }
    const previous = this.peek(-1);
    return keywordImage(previous, "DOUBLE") || keywordImage(previous, "TIMESTAMP") || keywordImage(previous, "WITH");
  }

  private currentBinaryOperator(): string | undefined {
    const token = this.peek();
    if (keywordImage(token, "AND")) return "AND";
    if (keywordImage(token, "OR")) return "OR";
    switch (tokenName(token)) {
      case "Equals":
        return "=";
      case "NotEquals":
      case "BangEquals":
        return "<>";
      case "LessThan":
        return "<";
      case "LessEquals":
        return "<=";
      case "GreaterThan":
        return ">";
      case "GreaterEquals":
        return ">=";
      case "Plus":
        return "+";
      case "Minus":
        return "-";
      case "Star":
        return "*";
      case "Slash":
        return "/";
      case "VectorCosine":
        return "<=>";
      case "VectorL2":
        return "<->";
      case "VectorInner":
        return "<#>";
      default:
        return undefined;
    }
  }

  private collectUntilTopLevel(stop: StopPredicate): IToken[] {
    const result: IToken[] = [];
    let depth = 0;
    while (!this.isAtEnd()) {
      const token = this.peek();
      if (depth === 0 && stop(token)) break;
      if (tokenName(token) === "LParen") depth++;
      if (tokenName(token) === "RParen") {
        if (depth === 0) break;
        depth--;
      }
      result.push(this.advance());
    }
    return result;
  }

  private collectParenthesizedTokens(): IToken[] {
    const result: IToken[] = [];
    let depth = 1;
    while (!this.isAtEnd()) {
      const token = this.advance();
      if (tokenName(token) === "LParen") {
        depth++;
      } else if (tokenName(token) === "RParen") {
        depth--;
        if (depth === 0) {
          return result;
        }
      }
      result.push(token);
    }
    this.fail(this.peek(-1), "E_PARSE", "Unclosed parenthesized expression");
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private peek(relative = 0): IToken {
    const token = this.tokens[this.index + relative];
    if (!token) {
      return this.tokens[this.tokens.length - 1] ?? syntheticIdentifier("<eof>");
    }
    return token;
  }

  private advance(): IToken {
    const token = this.peek();
    this.index++;
    return token;
  }

  private keyword(name: string, relative = 0): boolean {
    return keywordImage(this.tokens[this.index + relative], name);
  }

  private optionalKeyword(name: string): boolean {
    if (!this.keyword(name)) return false;
    this.index++;
    return true;
  }

  private consumeKeyword(name: string): void {
    if (!this.optionalKeyword(name)) {
      this.fail(this.peek(), "E_PARSE", `Expected ${name}`);
    }
  }

  private optionalToken(name: string): boolean {
    if (this.isAtEnd()) return false;
    if (tokenName(this.peek()) !== name) return false;
    this.index++;
    return true;
  }

  private consumeToken(name: string, message: string): void {
    if (!this.optionalToken(name)) {
      this.fail(this.peek(), "E_PARSE", message);
    }
  }

  private consumeIdentifier(message: string): string {
    const token = this.advance();
    if (!isIdentifierLike(token)) {
      this.fail(token, "E_PARSE", message);
    }
    return identifierText(token);
  }

  private fail(token: IToken | undefined, code: Parameters<typeof binSqlError>[0]["code"], message: string): never {
    binSqlError({ code, message, position: token ? tokenPosition(token) : undefined });
  }
}

function parseExpressionTokens(tokens: IToken[], mode: BinSqlMode): Expression {
  return new PrattParser(tokens, mode).parse();
}

function parseFunctionCall(parts: string[], argTokens: IToken[], mode: BinSqlMode): FunctionCallExpression {
  let distinct = false;
  const rawArgs = splitTopLevel(argTokens, (token) => tokenName(token) === "Comma");
  const args: FunctionArg[] = [];
  for (const rawArg of rawArgs) {
    if (rawArg.length === 0) continue;
    let tokens = rawArg;
    if (keywordImage(tokens[0], "DISTINCT")) {
      distinct = true;
      tokens = tokens.slice(1);
    }
    const arrow = findTopLevelToken(tokens, (token) => tokenName(token) === "FatArrow");
    if (arrow === 1 && isIdentifierLike(tokens[0]!)) {
      args.push({
        kind: "named",
        name: identifierText(tokens[0]!),
        expression: parseExpressionTokens(tokens.slice(2), mode),
      });
    } else {
      args.push({ kind: "expr", expression: parseExpressionTokens(tokens, mode) });
    }
  }
  return { kind: "call", name: { parts }, args, distinct };
}

function parseSelectTargetTokens(tokens: IToken[], mode: BinSqlMode): SelectTarget {
  const aliasIndex = findTopLevelToken(tokens, (token) => keywordImage(token, "AS"));
  if (aliasIndex >= 0) {
    const aliasToken = tokens[aliasIndex + 1];
    if (!aliasToken || !isIdentifierLike(aliasToken) || aliasIndex + 2 !== tokens.length) {
      binSqlError({ code: "E_PARSE", message: "Expected SELECT target alias", position: tokenPosition(aliasToken ?? tokens[aliasIndex]) });
    }
    return {
      expression: parseExpressionTokens(tokens.slice(0, aliasIndex), mode),
      alias: identifierText(aliasToken),
    };
  }
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!;
    const beforeLast = tokens[tokens.length - 2]!;
    if (isIdentifierLike(last) && canPrecedeImplicitAlias(beforeLast)) {
      return {
        expression: parseExpressionTokens(tokens.slice(0, -1), mode),
        alias: identifierText(last),
      };
    }
  }
  return { expression: parseExpressionTokens(tokens, mode) };
}

function parseOrderByTokens(tokens: IToken[], mode: BinSqlMode): OrderByItem {
  let direction: OrderByItem["direction"];
  let nulls: OrderByItem["nulls"];
  const working = [...tokens];
  if (working.length >= 2 && keywordImage(working[working.length - 2], "NULLS")) {
    const last = working[working.length - 1]!;
    if (keywordImage(last, "FIRST") || keywordImage(last, "LAST")) {
      nulls = last.image.toUpperCase() as "FIRST" | "LAST";
      working.splice(-2);
    }
  }
  if (working.length >= 1) {
    const last = working[working.length - 1]!;
    if (keywordImage(last, "ASC") || keywordImage(last, "DESC")) {
      direction = last.image.toUpperCase() as "ASC" | "DESC";
      working.pop();
    }
  }
  return { expression: parseExpressionTokens(working, mode), direction, nulls };
}

function parseIndexColumnTokens(tokens: IToken[], mode: BinSqlMode): IndexColumn {
  const order = parseOrderByTokens(tokens, mode);
  return { expression: order.expression, direction: order.direction, nulls: order.nulls };
}

function parseColumnDefTokens(tokens: IToken[], mode: BinSqlMode): ColumnDef {
  if (tokens.length < 2 || !isIdentifierLike(tokens[0]!)) {
    binSqlError({ code: "E_PARSE", message: "Expected column definition", position: tokenPosition(tokens[0]) });
  }
  const name = identifierText(tokens[0]!);
  let index = 1;
  const typeTokens: IToken[] = [];
  while (index < tokens.length && !isColumnConstraintStart(tokens[index]!)) {
    typeTokens.push(tokens[index++]!);
  }
  const constraints: ColumnConstraint[] = [];
  while (index < tokens.length) {
    if (keywordImage(tokens[index], "PRIMARY")) {
      index += 2;
      constraints.push({ kind: "primaryKey" });
    } else if (keywordImage(tokens[index], "NOT")) {
      index += 2;
      constraints.push({ kind: "notNull" });
    } else if (keywordImage(tokens[index], "UNIQUE")) {
      index++;
      constraints.push({ kind: "unique" });
    } else if (keywordImage(tokens[index], "DEFAULT")) {
      index++;
      const defaultTokens = tokens.slice(index);
      constraints.push({ kind: "default", expression: parseExpressionTokens(defaultTokens, mode) });
      index = tokens.length;
    } else {
      binSqlError({ code: "E_PARSE", message: "Unsupported column constraint", position: tokenPosition(tokens[index]) });
    }
  }
  return { name, type: parseSqlTypeTokens(typeTokens), constraints };
}

function parseTableConstraintTokens(tokens: IToken[], mode: BinSqlMode): TableConstraint {
  let index = 0;
  let name: string | undefined;
  if (keywordImage(tokens[index], "CONSTRAINT")) {
    index++;
    if (!isIdentifierLike(tokens[index]!)) {
      binSqlError({ code: "E_PARSE", message: "Expected constraint name", position: tokenPosition(tokens[index]) });
    }
    name = identifierText(tokens[index++]!);
  }
  if (keywordImage(tokens[index], "PRIMARY")) {
    index += 2;
    return { kind: "primaryKey", name, columns: parseColumnsAfterKeyword(tokens.slice(index)) };
  }
  if (keywordImage(tokens[index], "UNIQUE")) {
    index++;
    return { kind: "unique", name, columns: parseColumnsAfterKeyword(tokens.slice(index)) };
  }
  if (keywordImage(tokens[index], "FOREIGN")) {
    index += 2;
    const columns = parseColumnsAfterKeyword(tokens.slice(index));
    index = findTopLevelToken(tokens, (token) => keywordImage(token, "REFERENCES"));
    if (index < 0) {
      binSqlError({ code: "E_PARSE", message: "Expected REFERENCES in foreign key", position: tokenPosition(tokens[0]) });
    }
    index++;
    const relationTokens: IToken[] = [];
    while (index < tokens.length && tokenName(tokens[index]!) !== "LParen") {
      relationTokens.push(tokens[index++]!);
    }
    const references = relationFromTokens(relationTokens);
    const referencedColumns = parseColumnsAfterKeyword(tokens.slice(index));
    const constraint: TableConstraint = { kind: "foreignKey", name, columns, references, referencedColumns };
    const onUpdateIndex = findKeywordSequence(tokens, ["ON", "UPDATE"]);
    if (onUpdateIndex >= 0) {
      constraint.onUpdate = tokens
        .slice(onUpdateIndex + 2, findKeywordSequence(tokens.slice(onUpdateIndex + 2), ["ON", "DELETE"]) + onUpdateIndex + 2 || tokens.length)
        .map((token) => token.image.toUpperCase())
        .join(" ");
    }
    const onDeleteIndex = findKeywordSequence(tokens, ["ON", "DELETE"]);
    if (onDeleteIndex >= 0) {
      constraint.onDelete = tokens
        .slice(onDeleteIndex + 2)
        .map((token) => token.image.toUpperCase())
        .join(" ");
    }
    return constraint;
  }
  binSqlError({ code: "E_PARSE", message: "Unsupported table constraint", position: tokenPosition(tokens[index]) });
}

function parseColumnsAfterKeyword(tokens: IToken[]): string[] {
  const lparen = tokens.findIndex((token) => tokenName(token) === "LParen");
  if (lparen < 0) {
    binSqlError({ code: "E_PARSE", message: "Expected column list", position: tokenPosition(tokens[0]) });
  }
  const inner = collectMatchingParens(tokens, lparen);
  return splitTopLevel(inner, (token) => tokenName(token) === "Comma").map((segment) => {
    if (segment.length !== 1 || !isIdentifierLike(segment[0]!)) {
      binSqlError({ code: "E_PARSE", message: "Expected column name", position: tokenPosition(segment[0]) });
    }
    return identifierText(segment[0]!);
  });
}

function parseTableOptions(tokens: IToken[]): TableOption[] {
  return splitTopLevel(tokens, (token) => tokenName(token) === "Comma").map((segment) => {
    const equals = findTopLevelToken(segment, (token) => tokenName(token) === "Equals");
    if (equals < 0) {
      return { name: serializeDottedNameTokens(segment) };
    }
    return {
      name: serializeDottedNameTokens(segment.slice(0, equals)),
      value: segment.slice(equals + 1).map((token) => token.image).join(" "),
    };
  });
}

function serializeDottedNameTokens(tokens: IToken[]): string {
  return tokens.map((token) => (tokenName(token) === "Dot" ? "." : identifierText(token))).join("");
}

function parseSqlTypeTokens(tokens: IToken[]): SqlType {
  if (tokens.length === 0) {
    binSqlError({ code: "E_PARSE", message: "Expected SQL type" });
  }
  const withoutArrays = [...tokens];
  let arrayDepth = 0;
  while (
    withoutArrays.length >= 2 &&
    tokenName(withoutArrays[withoutArrays.length - 2]) === "LBracket" &&
    tokenName(withoutArrays[withoutArrays.length - 1]) === "RBracket"
  ) {
    withoutArrays.splice(-2);
    arrayDepth++;
  }
  let args: number[] = [];
  const lparen = withoutArrays.findIndex((token) => tokenName(token) === "LParen");
  let nameTokens = withoutArrays;
  if (lparen >= 0) {
    const inner = collectMatchingParens(withoutArrays, lparen);
    args = splitTopLevel(inner, (token) => tokenName(token) === "Comma").map((segment) => Number(segment[0]?.image));
    nameTokens = withoutArrays.slice(0, lparen);
  }
  const parts: string[] = [];
  let current = "";
  for (const token of nameTokens) {
    if (tokenName(token) === "Dot") {
      if (!current) binSqlError({ code: "E_PARSE", message: "Invalid SQL type", position: tokenPosition(token) });
      parts.push(current);
      current = "";
    } else if (isIdentifierLike(token)) {
      current = current ? `${current} ${identifierText(token)}` : identifierText(token);
    } else {
      binSqlError({ code: "E_PARSE", message: "Invalid SQL type", position: tokenPosition(token) });
    }
  }
  if (current) parts.push(current);
  if (parts.length > 1) {
    binSqlError({
      code: "E_FORBIDDEN_SCHEMA",
      message: "Schema-qualified types are not accepted; binsql chooses extension schemas",
      position: tokenPosition(tokens[0]),
    });
  }
  return { name: parts, args, arrayDepth };
}

function relationFromTokens(tokens: IToken[]): RelationName {
  const parts = tokens.filter((token) => tokenName(token) !== "Dot").map((token) => identifierText(token));
  if (parts.length === 1) return { name: parts[0]! };
  if (parts.length === 2) return { schema: parts[0], name: parts[1]! };
  binSqlError({ code: "E_PARSE", message: "Invalid relation name", position: tokenPosition(tokens[0]) });
}

function splitTopLevel(tokens: IToken[], separator: StopPredicate): IToken[][] {
  const result: IToken[][] = [];
  let current: IToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (depth === 0 && separator(token)) {
      result.push(current);
      current = [];
      continue;
    }
    if (tokenName(token) === "LParen") depth++;
    if (tokenName(token) === "RParen") depth--;
    current.push(token);
  }
  result.push(current);
  return result.filter((group) => group.length > 0);
}

function collectMatchingParens(tokens: IToken[], lparenIndex: number): IToken[] {
  const result: IToken[] = [];
  let depth = 0;
  for (let i = lparenIndex; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (tokenName(token) === "LParen") {
      depth++;
      if (depth === 1) continue;
    }
    if (tokenName(token) === "RParen") {
      depth--;
      if (depth === 0) return result;
    }
    result.push(token);
  }
  binSqlError({ code: "E_PARSE", message: "Unclosed parenthesized list", position: tokenPosition(tokens[lparenIndex]) });
}

function findTopLevelToken(tokens: IToken[], predicate: StopPredicate): number {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (depth === 0 && predicate(token)) return i;
    if (tokenName(token) === "LParen") depth++;
    if (tokenName(token) === "RParen") depth--;
  }
  return -1;
}

function findKeywordSequence(tokens: IToken[], words: string[]): number {
  for (let i = 0; i <= tokens.length - words.length; i++) {
    if (words.every((word, offset) => keywordImage(tokens[i + offset], word))) {
      return i;
    }
  }
  return -1;
}

function isColumnConstraintStart(token: IToken): boolean {
  return ["PRIMARY", "NOT", "DEFAULT", "UNIQUE", "REFERENCES"].some((word) => keywordImage(token, word));
}

function isTableConstraintStart(token: IToken): boolean {
  return ["PRIMARY", "UNIQUE", "FOREIGN"].some((word) => keywordImage(token, word));
}

function canPrecedeImplicitAlias(token: IToken): boolean {
  if (tokenName(token) === "Dot" || tokenName(token) === "Cast") return false;
  if (
    [
      "Plus",
      "Minus",
      "Star",
      "Slash",
      "Equals",
      "NotEquals",
      "BangEquals",
      "LessThan",
      "LessEquals",
      "GreaterThan",
      "GreaterEquals",
      "VectorCosine",
      "VectorL2",
      "VectorInner",
    ].includes(tokenName(token) ?? "")
  ) {
    return false;
  }
  return !["AND", "OR", "NOT", "IS", "IN", "LIKE", "ILIKE", "NULLS"].some((word) => keywordImage(token, word));
}

function binaryPrecedence(operator: string): number {
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
      return 0;
  }
}

function isIdentifierLike(token: IToken | undefined): token is IToken {
  if (!token) return false;
  if (tokenName(token) === "Identifier" || tokenName(token) === "QuotedIdentifier") return true;
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(token.image);
}

function identifierText(token: IToken): string {
  if (tokenName(token) === "QuotedIdentifier") {
    return token.image.slice(1, -1).replace(/""/g, '"');
  }
  return token.image.toLowerCase();
}

function stringLiteralValue(image: string): string {
  const body = image[0]?.toLowerCase() === "e" ? image.slice(2, -1) : image.slice(1, -1);
  return body.replace(/''/g, "'");
}

function keywordImage(token: IToken | undefined, word: string): boolean {
  return token?.image.toUpperCase() === word;
}

function tokenName(token: IToken | undefined): string | undefined {
  return token?.tokenType.name;
}

function tokenPosition(token: IToken | undefined): { offset: number; line: number; column: number } | undefined {
  if (!token) return undefined;
  return {
    offset: token.startOffset ?? 0,
    line: token.startLine ?? 1,
    column: token.startColumn ?? 1,
  };
}

function syntheticIdentifier(image: string): IToken {
  return {
    image,
    startOffset: 0,
    endOffset: image.length,
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: image.length + 1,
    tokenType: Identifier,
    tokenTypeIdx: Identifier.tokenTypeIdx ?? 0,
  };
}
