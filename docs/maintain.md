# Maintaining the Project

## Pre-commit Hooks (Husky + lint-staged)

This project uses **Husky** and **lint-staged** to automatically verify code quality before every commit.

### How it works (The Flow)

1.  **Trigger (Husky)**: When you run `git commit`, Husky intercepts the action and executes the `.husky/pre-commit` script.
2.  **Snapshot regression check**: The script first runs `pnpm test tests/snapshot.test.ts` (see [Snapshot Testing](#snapshot-testing) below). This requires a running, migrated Postgres instance - if it's down, the commit is blocked with a database connection error rather than a real test failure.
3.  **Detection (lint-staged)**: The script then runs `lint-staged`, which scans your **git staging area** to find _only_ the files you have modified and added.
4.  **Execution**: `lint-staged` filters these files based on the patterns in `package.json` (e.g., `*.ts`) and runs the configured commands (Prettier, Oxlint, etc.) _only_ on those specific files.

This setup ensures efficiency: you checked only what you changed, not the entire codebase (aside from the snapshot test, which always runs in full).

The following checks run automatically:

1.  **Snapshot regression**: `vitest run tests/snapshot.test.ts` verifies that yield calculations haven't changed unexpectedly.
2.  **Formatting**: `prettier --write` fixes formatting on all supported files (`.js`, `.ts`, `.tsx`, `.json`, `.md`).
3.  **Linting**: `oxlint` checks for bugs and errors in JavaScript/TypeScript files.
4.  **Type Checking**: `tsc --noEmit` verifies TypeScript types.
    - Checks `src/` files using the root `tsconfig.json`.
    - Checks `client-web/` files using `client-web/tsconfig.json`.

### Configuration

- **Hook Script**: `.husky/pre-commit`
- **Tool Config**: The rules for which commands run on which files are defined in the `lint-staged` section of `package.json`.

**Bypassing checks (Use with caution):**
If you absolutely must commit without running checks:

```bash
git commit -m "your message" --no-verify
```

## Snapshot Testing

This is a regression test for yield calculations. It computes the output and compares the result against a committed baseline. If a code change (intentional or not) alters any output, the test fails and shows a diff.

### Commands

| Command                            | What it does                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`                        | Runs the full test suite once, failing on any snapshot mismatch.                                                   |
| `pnpm test tests/snapshot.test.ts` | Runs just the snapshot test (what the pre-commit hook runs).                                                       |
| `pnpm test:update`                 | Updating base snapshots on purpose. Use this after a change to yield calculations that you've verified is correct. |
