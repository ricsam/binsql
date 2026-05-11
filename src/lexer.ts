import { createToken, Lexer } from "chevrotain";

const kw = (name: string, pattern: RegExp) =>
  createToken({
    name,
    pattern,
    longer_alt: Identifier,
  });

export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /[ \t\r\n]+/,
  group: Lexer.SKIPPED,
});

export const LineComment = createToken({
  name: "LineComment",
  pattern: /--[^\n\r]*/,
  group: Lexer.SKIPPED,
});

export const BlockComment = createToken({
  name: "BlockComment",
  pattern: /\/\*[\s\S]*?\*\//,
  group: Lexer.SKIPPED,
});

export const DollarQuotedString = createToken({
  name: "DollarQuotedString",
  pattern: /\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$[\s\S]*?\$\$/,
});

export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /[eE]?'(?:''|[^'])*'/,
});

export const QuotedIdentifier = createToken({
  name: "QuotedIdentifier",
  pattern: /"(?:""|[^"])*"/,
});

export const DecimalLiteral = createToken({
  name: "DecimalLiteral",
  pattern: /\d+\.\d+(?:[eE][+-]?\d+)?/,
});

export const IntegerLiteral = createToken({
  name: "IntegerLiteral",
  pattern: /\d+/,
});

export const Parameter = createToken({
  name: "Parameter",
  pattern: /\$[1-9]\d*/,
});

export const Identifier = createToken({
  name: "Identifier",
  pattern: /[A-Za-z_][A-Za-z0-9_$]*/,
});

export const Select = kw("Select", /SELECT/i);
export const With = kw("With", /WITH/i);
export const Insert = kw("Insert", /INSERT/i);
export const Into = kw("Into", /INTO/i);
export const Values = kw("Values", /VALUES/i);
export const Update = kw("Update", /UPDATE/i);
export const Delete = kw("Delete", /DELETE/i);
export const From = kw("From", /FROM/i);
export const Using = kw("Using", /USING/i);
export const Where = kw("Where", /WHERE/i);
export const Returning = kw("Returning", /RETURNING/i);
export const As = kw("As", /AS/i);
export const Distinct = kw("Distinct", /DISTINCT/i);
export const Group = kw("Group", /GROUP/i);
export const Order = kw("Order", /ORDER/i);
export const By = kw("By", /BY/i);
export const Limit = kw("Limit", /LIMIT/i);
export const Offset = kw("Offset", /OFFSET/i);
export const Asc = kw("Asc", /ASC/i);
export const Desc = kw("Desc", /DESC/i);
export const Nulls = kw("Nulls", /NULLS/i);
export const First = kw("First", /FIRST/i);
export const Last = kw("Last", /LAST/i);
export const Join = kw("Join", /JOIN/i);
export const Inner = kw("Inner", /INNER/i);
export const Left = kw("Left", /LEFT/i);
export const On = kw("On", /ON/i);
export const Conflict = kw("Conflict", /CONFLICT/i);
export const Do = kw("Do", /DO/i);
export const Nothing = kw("Nothing", /NOTHING/i);
export const Set = kw("Set", /SET/i);
export const Create = kw("Create", /CREATE/i);
export const Table = kw("Table", /TABLE/i);
export const Alter = kw("Alter", /ALTER/i);
export const Add = kw("Add", /ADD/i);
export const Drop = kw("Drop", /DROP/i);
export const Column = kw("Column", /COLUMN/i);
export const Constraint = kw("Constraint", /CONSTRAINT/i);
export const Unique = kw("Unique", /UNIQUE/i);
export const Primary = kw("Primary", /PRIMARY/i);
export const Key = kw("Key", /KEY/i);
export const Foreign = kw("Foreign", /FOREIGN/i);
export const References = kw("References", /REFERENCES/i);
export const Default = kw("Default", /DEFAULT/i);
export const If = kw("If", /IF/i);
export const Exists = kw("Exists", /EXISTS/i);
export const Not = kw("Not", /NOT/i);
export const Index = kw("Index", /INDEX/i);
export const Cascade = kw("Cascade", /CASCADE/i);
export const Materialized = kw("Materialized", /MATERIALIZED/i);
export const View = kw("View", /VIEW/i);
export const No = kw("No", /NO/i);
export const Data = kw("Data", /DATA/i);
export const And = kw("And", /AND/i);
export const Or = kw("Or", /OR/i);
export const Is = kw("Is", /IS/i);
export const Null = kw("Null", /NULL/i);
export const True = kw("True", /TRUE/i);
export const False = kw("False", /FALSE/i);
export const In = kw("In", /IN/i);
export const Like = kw("Like", /LIKE/i);
export const ILike = kw("ILike", /ILIKE/i);
export const Case = kw("Case", /CASE/i);
export const When = kw("When", /WHEN/i);
export const Then = kw("Then", /THEN/i);
export const Else = kw("Else", /ELSE/i);
export const End = kw("End", /END/i);
export const Interval = kw("Interval", /INTERVAL/i);
export const Over = kw("Over", /OVER/i);
export const Partition = kw("Partition", /PARTITION/i);
export const Rows = kw("Rows", /ROWS/i);
export const Between = kw("Between", /BETWEEN/i);
export const Unbounded = kw("Unbounded", /UNBOUNDED/i);
export const Preceding = kw("Preceding", /PRECEDING/i);
export const Current = kw("Current", /CURRENT/i);
export const Row = kw("Row", /ROW/i);
export const Call = kw("Call", /CALL/i);
export const Execute = kw("Execute", /EXECUTE/i);
export const Prepare = kw("Prepare", /PREPARE/i);
export const Copy = kw("Copy", /COPY/i);
export const Listen = kw("Listen", /LISTEN/i);
export const Notify = kw("Notify", /NOTIFY/i);
export const Reset = kw("Reset", /RESET/i);
export const FunctionKw = kw("FunctionKw", /FUNCTION/i);
export const Trigger = kw("Trigger", /TRIGGER/i);
export const Extension = kw("Extension", /EXTENSION/i);

export const VectorCosine = createToken({ name: "VectorCosine", pattern: /<=>/ });
export const VectorL2 = createToken({ name: "VectorL2", pattern: /<->/ });
export const VectorInner = createToken({ name: "VectorInner", pattern: /<#>/ });
export const LessEquals = createToken({ name: "LessEquals", pattern: /<=/ });
export const GreaterEquals = createToken({ name: "GreaterEquals", pattern: />=/ });
export const NotEquals = createToken({ name: "NotEquals", pattern: /<>/ });
export const BangEquals = createToken({ name: "BangEquals", pattern: /!=/ });
export const Cast = createToken({ name: "Cast", pattern: /::/ });
export const FatArrow = createToken({ name: "FatArrow", pattern: /=>/ });
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
export const LBracket = createToken({ name: "LBracket", pattern: /\[/ });
export const RBracket = createToken({ name: "RBracket", pattern: /\]/ });
export const Comma = createToken({ name: "Comma", pattern: /,/ });
export const Dot = createToken({ name: "Dot", pattern: /\./ });
export const Semicolon = createToken({ name: "Semicolon", pattern: /;/ });
export const Plus = createToken({ name: "Plus", pattern: /\+/ });
export const Minus = createToken({ name: "Minus", pattern: /-/ });
export const Star = createToken({ name: "Star", pattern: /\*/ });
export const Slash = createToken({ name: "Slash", pattern: /\// });
export const Equals = createToken({ name: "Equals", pattern: /=/ });
export const LessThan = createToken({ name: "LessThan", pattern: /</ });
export const GreaterThan = createToken({ name: "GreaterThan", pattern: />/ });

export const allTokens = [
  WhiteSpace,
  LineComment,
  BlockComment,
  DollarQuotedString,
  StringLiteral,
  QuotedIdentifier,
  DecimalLiteral,
  IntegerLiteral,
  Select,
  With,
  Insert,
  Into,
  Values,
  Update,
  Delete,
  From,
  Using,
  Where,
  Returning,
  Asc,
  As,
  Distinct,
  Group,
  Order,
  By,
  Limit,
  Offset,
  Desc,
  Nulls,
  First,
  Last,
  Join,
  Inner,
  Left,
  On,
  Conflict,
  Do,
  Nothing,
  Notify,
  Set,
  Create,
  Table,
  Alter,
  Add,
  Drop,
  Column,
  Constraint,
  Unique,
  Primary,
  Key,
  Foreign,
  References,
  Default,
  If,
  Exists,
  Not,
  Index,
  Cascade,
  Materialized,
  View,
  No,
  Data,
  And,
  Or,
  Is,
  Null,
  True,
  False,
  Interval,
  In,
  Like,
  ILike,
  Case,
  When,
  Then,
  Else,
  End,
  Over,
  Partition,
  Rows,
  Between,
  Unbounded,
  Preceding,
  Current,
  Row,
  Call,
  Execute,
  Prepare,
  Copy,
  Listen,
  Reset,
  FunctionKw,
  Trigger,
  Extension,
  Parameter,
  VectorCosine,
  VectorL2,
  VectorInner,
  LessEquals,
  GreaterEquals,
  NotEquals,
  BangEquals,
  Cast,
  FatArrow,
  LParen,
  RParen,
  LBracket,
  RBracket,
  Comma,
  Dot,
  Semicolon,
  Plus,
  Minus,
  Star,
  Slash,
  Equals,
  LessThan,
  GreaterThan,
  Identifier,
];

export const sqlLexer = new Lexer(allTokens, {
  ensureOptimizations: false,
});
