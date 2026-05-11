# Corpus Fixtures

This directory is intentionally curated rather than a raw project-data dump. All
SQL fixtures live directly in this folder:

- Migration fixtures cover representative generated DDL, seed data, Timescale
  helpers, and expected unsupported migration cases.
- Runtime fixtures cover representative query shapes.
- `template-initial-schema.sql` keeps one broad template initial schema. Add
  more template fixtures only when they cover a parser shape not already
  represented here.

Avoid committing copied remotes, worktrees, UUID project directories, or exact
duplicate SQL files. Add the smallest fixture that covers the parser behavior
you need. Use timestamp-free kebab-case file names that describe the behavior
being exercised, such as `baseline-schema.sql` or
`schema-reconcile-do-block.sql`.
