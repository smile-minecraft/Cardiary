# Development

This guide is for contributors building and testing Cardiary from
source.
See the [project README](../README.md) for the current project
status and a short setup guide.

## Install the tools

Use an Apple Silicon Mac with macOS and Xcode with a Swift 6
toolchain.
The Swift packages declare macOS 14 as their minimum.
Install Node.js 22.19.0 or newer and pnpm 9; the app bundles
Node.js 22.19.0.
The repository's `packageManager` field pins the pnpm version.

From the repository root:

```sh
pnpm install
pnpm check
pnpm test:swift
pnpm verify:app
```

`pnpm check` runs ESLint, Prettier's format check, the TypeScript
build, and Vitest.
The build comes before the tests because contract tests start the
compiled host.
`pnpm test:swift` runs both Swift package test suites.
`pnpm verify:app` builds a debug app bundle and downloads the
pinned Node runtime on the first run if needed.
It does not require an Apple developer identity for a debug
build.

## Choose the tests

Unit tests exercise domain rules, storage, host modules, and
other components.
Run `pnpm check` for the repository's normal JavaScript and
TypeScript checks.

The contract suite starts a real host child process and exercises
its protocol from the outside.
The default suite uses the fake engine.
To run the same contract suite with the Pi engine assembly, build
first and run:

```sh
pnpm build
pnpm test:contract:pi
```

Contract tests need the compiled host in `packages/host/dist`.
Running Vitest directly before the build can fail or skip checks
that depend on built output.
The Pi assembly uses a scripted model when a test supplies a
script; otherwise it uses the host's configured model source.

`pnpm test:swift` checks the Swift client and macOS app packages.
`pnpm verify:app` checks assembly of the app bundle, including
its packaged service.
Use macOS and Xcode for these commands and for the command
sandbox tests.
Sandbox tests skip when macOS or `sandbox-exec` is unavailable.
The removable-disk test is opt-in; some tests also skip when
their built dependency or optional provider credentials are
absent.
Check test output to see what actually ran.

## Run the host directly

The app starts the host in normal use.
For standalone development, build the host and use an absolute
path for the data folder.
Set `TMPDIR` to that folder's `tmp/` directory; the service
clears it on startup.
On a new folder, pass `--initialize-folder` once:

```sh
pnpm build
TMPDIR=<folder>/tmp node packages/host/dist/main.js --folder <folder> --initialize-folder
```

Replace `<folder>` with the absolute path of a folder you intend
to use for development.
The host refuses a different `TMPDIR`.
After initialization, omit `--initialize-folder` on later runs.
The service prints a ready line with its listening port.

For the fake engine and sample demo tools, reuse the initialized
folder:

```sh
TMPDIR=<folder>/tmp node packages/host/dist/main.js --folder <folder> --engine fake --demo
```

The demo assembly uses an in-memory engine and storage for the
demo services.
Its sample tools exercise the approval flow without a configured
model provider.
See [Permissions](permissions.md) for the rules applied to local
tools.

## Avoid stale builds

`apps/macos/build/service` contains the packaged service cache.
After changing host code, run `pnpm verify:app` to rebuild the
packaged service and app before testing the bundle.
A direct Swift build leaves the packaged host unchanged.

For contract tests invoked outside `pnpm check`, run `pnpm build`
first.
Rebuild again after changing TypeScript that the host process
uses.

## Work on a change

Use a separate branch for each change; a Git worktree can keep
concurrent changes in separate directories.
Keep the change focused and run the checks above before opening a
pull request.
Explain the motivation and tradeoffs in the pull request; see
[Contributing](../CONTRIBUTING.md).

Use English Conventional Commits messages, for example:

```text
feat: add card search
fix: preserve card comments
test: cover archive cancellation
docs: explain card freshness
chore: update development dependencies
```

Use one short sentence for what changed and add a body explaining
why when needed.

## Follow package boundaries

TypeScript uses strict mode, ESLint, and Prettier.
Identifiers are in English; code comments and internal
development documents use Traditional Chinese.
Interface strings support English and Traditional Chinese.

Keep domain logic independent of the engine.
Only `packages/engine-adapter` imports Pi Durable in the product
packages, and the dependency uses an exact version.
First-party host modules belong under
`packages/host/src/modules/` and export `hostModule`.
Protocol schemas and generated types belong in
`packages/protocol`; clients communicate through the protocol.
