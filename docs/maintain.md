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

## Local Data & Backups (private data repo)

Everything too big or too private for this repo - financial-report PDFs and Postgres dumps - lives in a **separate private GitHub repo**, mounted here as a **git submodule** at `local-data/`. PDFs are stored with **Git LFS**; everything else is plain git.

- **Data repo**: `git@github-hahuaz:hahuaz/eot-private.git` (`github-hahuaz` is the SSH host alias in `~/.ssh/config`)
- **Mounted at**: `local-data/` (the root repo only stores the URL + which commit of the data repo to use, in `.gitmodules`)

### What's where

```
local-data/                     <- submodule (private data repo)
├── .gitattributes              *.pdf -> Git LFS
├── .gitignore                  ignores the generated folders below
├── extract-pdf/
│   └── pdfs/<quarter>/         source PDFs (LFS) - backed up
└── db-backups/
    └── eot.sql                 latest pg_dump - one file, git history keeps older versions
```

### Fresh machine: get everything back

```bash
git lfs install                                    # once per machine
git clone --recurse-submodules git@github-hahuaz:hahuaz/eot.git   # code + data, PDFs included
# already cloned without the submodule?
git submodule update --init
cd local-data && git lfs pull                      # if PDFs show up as small pointer text files
```

Then restore the DB (see below) and regenerate the derived folders with `pnpm script:extract-pdf` / `pnpm script:generate-verify-html`.

### Saving new PDFs (e.g. after a new quarter's `script:download-pdfs`)

Two commits: one in the data repo, then one in the root repo to point at it.

```bash
cd local-data
git add extract-pdf/pdfs extract-pdf/pdfs-exceptional
git commit -m "add 2026Q3 pdfs"
git push                                           # uploads PDFs to LFS

cd ..
git add local-data                                 # records the new data-repo commit
git commit -m "chore: bump local-data"
```

If you skip the root-repo commit, nothing is lost (the data is pushed), the root repo just keeps pointing at the older data commit.

### DB backup & restore

Postgres runs in Docker as `eot-postgres`. Run everything below in **Git Bash**, from the repo root 

#### 1. Create a backup - safe, only reads the DB

Writes the current DB into `local-data/db-backups/eot.sql` (replacing that file - the previous version stays in git history), then pushes it.

```bash
docker exec eot-postgres pg_dump -U eot -d eot --clean --if-exists > local-data/db-backups/eot.sql

git -C local-data add db-backups/eot.sql
git -C local-data commit -m "db backup"
git -C local-data push
```

#### 2. Restore the latest backup - ⚠ OVERWRITES the current DB

Drops every table in the running DB and recreates it from `eot.sql`. Anything changed since that backup is lost - run step 1 first if you might want it back.

```bash
docker exec -i eot-postgres psql -U eot -d eot -v ON_ERROR_STOP=1 < local-data/db-backups/eot.sql
```

`-i` is required (it passes the file in through stdin); don't add `-t`.

#### 3. Restore an older backup - ⚠ OVERWRITES the current DB

Same as step 2, but from an earlier commit of `eot.sql`:

```bash
git -C local-data log --oneline -- db-backups/eot.sql      # pick a commit hash

git -C local-data show <commit>:db-backups/eot.sql \
  | docker exec -i eot-postgres psql -U eot -d eot -v ON_ERROR_STOP=1
```

