# Maintaining the Project

## Code Quality & Pre-commit Hooks

This project uses **Husky** and **lint-staged** to automatically verify code quality before every commit.

### How it works (The Flow)

1.  **Trigger (Husky)**: When you run `git commit`, Husky intercepts the action and executes the `.husky/pre-commit` script.
2.  **Detection (lint-staged)**: The script runs `lint-staged`, which scans your **git staging area** to find _only_ the files you have modified and added.
3.  **Execution**: `lint-staged` filters these files based on the patterns in `package.json` (e.g., `*.ts`) and runs the configured commands (Prettier, Oxlint, etc.) _only_ on those specific files.

This setup ensures efficiency: you checked only what you changed, not the entire codebase.

The following checks run automatically:

1.  **Formatting**: `prettier --write` fixes formatting on all supported files (`.js`, `.ts`, `.tsx`, `.json`, `.md`).
2.  **Linting**: `oxlint` checks for bugs and errors in JavaScript/TypeScript files.
3.  **Type Checking**: `tsc --noEmit` verifies TypeScript types.
    - Checks `src/` files using the root `tsconfig.json`.
    - Checks `client-web/` files using `client-web/tsconfig.json`.

### Configuration

- **Hook Script**: `.husky/pre-commit` (runs `pnpm exec lint-staged`)
- **Tool Config**: The rules for which commands run on which files are defined in the `lint-staged` section of `package.json`.

**Bypassing checks (Use with caution):**
If you absolutely must commit without running checks:

```bash
git commit -m "your message" --no-verify
```
