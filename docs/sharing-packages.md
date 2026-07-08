# Sharing Code Between Backend and Frontend

The backend (root `src/`) and the frontend (`client-web/`) are separate apps that both need the same TypeScript types and constants (yield calculation configs, metric names, date lists, API response shapes, etc.). That shared code lives in its own workspace package: `packages/shared`, published internally as `@eot/shared`.

## How it's wired up

- **`pnpm-workspace.yaml`** lists `client-web` and `packages/*` as workspace members. This is what lets `workspace:*` dependencies resolve at all - pnpm only links packages it recognizes as part of the same workspace.
- **`packages/shared/package.json`** - name `@eot/shared`, `main`/`types` both point at `index.ts`. There's no build step: consumers import the raw TypeScript source directly.
- **Both consumers depend on it** via `"@eot/shared": "workspace:*"` in `package.json` (root `package.json` for the backend, `client-web/package.json` for the frontend). `pnpm install` turns this into a symlink: `node_modules/@eot/shared -> packages/shared`.
- **`client-web/next.config.ts`** sets `transpilePackages: ["@eot/shared"]`. By default, Next.js assumes anything in `node_modules` is already compiled and won't run it through its TypeScript/JSX pipeline. Since `@eot/shared` ships raw `.ts` source, it has to be told explicitly to transpile it.
- **`packages/shared/tsconfig.json`** lets the package be type-checked on its own (`pnpm check:ts` runs it as a third project, alongside the root and `client-web` configs).

## Adding something to the shared package

1. Add the type or constant to `packages/shared/types.ts` or `packages/shared/constants.ts` (or a new file, re-exported from `packages/shared/index.ts`).
2. Import it as `from "@eot/shared"` - one entry point, regardless of which internal file it lives in.
3. Run `pnpm check:ts` to confirm both the backend and `client-web` still type-check against it.

## Creating a new shared package

If you ever need to split out another internal package (e.g. a shared UI kit), follow the same pattern:

1. Create `packages/<name>/` with its own `package.json` (`"name": "@eot/<name>"`, `"private": true`).
2. It's automatically picked up as a workspace member via the `packages/*` glob in `pnpm-workspace.yaml` - no extra config needed.
3. Add `"@eot/<name>": "workspace:*"` to whichever app(s) need it, then run `pnpm install` from the repo root.
4. If the consumer is `client-web` (or any other Next.js app) and the package ships raw TypeScript, add it to `transpilePackages` in that app's `next.config.ts`.

## Things to know

- **Install from the repo root, not from inside `client-web/`.** The whole workspace shares a single `pnpm-lock.yaml` at the root; `client-web` no longer has its own lockfile. A single `pnpm install` at the root installs dependencies for the backend, `client-web`, and `packages/shared`, and links `@eot/shared` into both. Running `pnpm install` from inside `client-web/` still works too - pnpm walks up and finds the workspace root automatically - but there's no reason to; it doesn't install anything the root install wouldn't have.
- **No build step for `@eot/shared`.** This keeps things simple for a project this size, but it does mean every consumer's bundler has to be capable of compiling raw TypeScript from a workspace package (`tsx` and Next.js both handle this natively; the `transpilePackages` setting above is what makes Next.js do it).
