# Cardiary

Cardiary, short for Card + Diary, is a local-first personal agent for Mac where its memories are Markdown cards.

## Status

Cardiary is in early development. The app is currently built from source, and its first usable version is in progress.

The foundation is implemented and merged: a host service that runs on its own, an engine adapter around Pi Durable, storage with the data folder rules, a protocol schema with contract tests, and the macOS shell that starts and supervises the service.

The first usable slice, conversations and cards, is in progress. Conversation streaming, the card file format and its index, context assembly and compaction, model settings, image and audio import, permission rules with human approval, local file and terminal tools, and the main macOS window are implemented and merged. Integration testing of these features is in progress.

The card format, protocol and folder layout may change before a stable release.

Code comments are written in Traditional Chinese. Identifiers are English. The app's interface strings exist in English and Traditional Chinese.

## What it is

- **Memory is a card.** A card is one Markdown file in `cards/` with YAML front matter: an id, a kind, a title, a summary, sources and tags. You can read the files in any editor, search them with `grep`, back them up with `rsync`, or fix one by hand; the app reindexes on the next scan. Images and audio are imported once into `assets/`, named by content hash.
- **The app is a shell around one long-running service.** A SwiftUI app opens a window and a menu bar item. Conversations, the card index, the agent loop and tool execution all run in a Node host service that the app starts and supervises. Closing the window does not stop the service.
- **The data stays where you put it.** On first launch you pick a folder, on the internal disk or an external one. There is no account, no sync and no telemetry; the only network traffic is to the model providers you configure.
- **The agent asks before it touches the machine.** Reading a card needs no approval. Running a shell command, writing a file or patching a card goes through a permission rule, and anything the rules do not cover waits for you.
- **More clients come later.** The protocol is the boundary, so a web client, then iOS and iPadOS, connect to the same host and see the same cards.

## Architecture

```text
┌───────────────────────────────┐
│ macOS app (SwiftUI)           │  window, menu bar item, approvals,
│ apps/macos, apple/CardiaryKit │  Keychain, folder picker
└──────────────┬────────────────┘
               │ protocol on 127.0.0.1 (HTTP + WebSocket, JSON schema)
┌──────────────▼────────────────┐
│ host service (Node 22.19)     │  the only process that reads and
│ packages/host                 │  writes the data folder
│   ├ domain core               │  packages/domain
│   ├ engine adapter            │  packages/engine-adapter → Pi Durable
│   └ storage                   │  packages/storage → SQLite + files
└───────────────────────────────┘
```

A few rules shape the code:

- **The host owns the data.** Clients render state and send commands. They never open the database or the folder themselves.
- **The engine is replaceable.** `packages/engine-adapter` is the only package that imports Pi Durable, pinned to an exact version. The domain core does not see engine types. A fake engine in `packages/engine-fake` runs the same contract tests without a model provider.
- **Files first, databases second.** Card originals are Markdown and assets are content-addressed files. SQLite holds conversation state and indexes that can be rebuilt; deleting `cache/` loses nothing.
- **Local only.** The host binds to `127.0.0.1` and serves this machine. Nothing is exposed to the network, and there is no server to sign in to.

## Repository layout

| Path                      | What is in it                                                    |
| ------------------------- | ---------------------------------------------------------------- |
| `packages/protocol`       | Protocol schema, generated types, shared test support            |
| `packages/domain`         | Card rules, freshness, context assembly, media, permission rules |
| `packages/engine-adapter` | The only code that touches Pi Durable                            |
| `packages/engine-fake`    | In-memory engine used by tests and the demo assembly             |
| `packages/module-api`     | Module interface and registry                                    |
| `packages/storage`        | Data folder zones, file registry, SQLite, card files, deletion   |
| `packages/host`           | Host service: gateway, engine runtime, first-party modules       |
| `packages/contract-tests` | Black-box protocol tests against a running host                  |
| `apps/macos`              | SwiftUI app: shell, window, card library, settings, approvals    |
| `apple/CardiaryKit`       | Shared Swift package: protocol types, client, card model         |

## Requirements

- An Apple Silicon Mac running a recent macOS. The Swift packages declare macOS 14 as their minimum; development targets the two latest major versions.
- Node.js 22.19.0 or newer for development. The app embeds Node 22.19.0.
- pnpm 9. The `packageManager` field pins the exact version.
- Xcode with a Swift 6 toolchain for `apps/macos` and `apple/CardiaryKit`.

## Getting started

```sh
pnpm install        # workspace dependencies
pnpm check          # eslint, prettier --check, tsc -b, vitest
pnpm test:swift     # swift test for CardiaryKit and the macOS app
pnpm verify:app     # builds a debug Cardiary.app
```

`pnpm check` builds `packages/host/dist` first, because the contract tests start it as a child process. `pnpm verify:app` downloads the pinned Node runtime into `~/Library/Caches/CardiaryNode` on first run and needs no Apple developer identity for a debug build.

### Running the host service on its own

The app starts the service for you. To run it by hand, build once with `pnpm build`, then point `TMPDIR` inside the folder you want the service to use:

```sh
TMPDIR=<folder>/tmp node packages/host/dist/main.js --folder <folder>
```

`<folder>` must be an absolute path. The service clears `<folder>/tmp` at startup and refuses to start when `TMPDIR` points somewhere else. On an empty folder, add `--initialize-folder` once to create `state/folder.json` and the databases; the app does this itself when you pick a folder. The service prints a ready line with the port it listens on, then serves the client protocol.

Another assembly swaps the engine for the fake one and the persistent storage for memory. The contract tests use it, and so does anyone without a model provider set up:

```sh
node packages/host/dist/main.js --folder <folder> --engine fake --demo
```

That assembly reuses an existing folder, so initialize the folder with the command above first. `--demo` registers a few sample tools (`demo.echo`, `demo.sleep`, `demo.card`, `demo.exec`) that exercise the approval flow.

The macOS app is a Swift package too, so `swift build` and `swift test` inside `apps/macos` work as usual. `pnpm test:swift` runs both packages, and `Scripts/build-app.sh` produces the `.app` bundle that `pnpm verify:app` calls in debug configuration.

## Data and privacy

You choose one folder, and everything Cardiary knows lives in it:

```text
<folder>/
  cards/      card originals (Markdown)
  assets/     images and audio, named by content hash
  boards/     whiteboard data
  skills/     SKILL.md files that describe agent skills
  state/      conversations, settings, freshness, file registry (SQLite)
  modules/    first-party modules and their data
  cache/      indexes and thumbnails; safe to delete, rebuilt on demand
  tmp/        tool scratch space, cleared at startup
  logs/       rotating diagnostic logs
```

Every file is an original, a cache entry or a temp file. Originals are what you keep, cache can be rebuilt at any time, and temp is wiped when the service starts. The only other thing inside the folder is the rotating diagnostic log. Outside the folder the app keeps its own state directory (folder bookmark, debug logs) and the Keychain entries, and nothing else.

- **API keys live in the macOS Keychain.** You enter them in the app. The host service asks the app for a key when a provider request needs one and keeps nothing on disk. Keys never appear in the protocol or in logs.
- **No accounts, no telemetry.** Cardiary does not report usage anywhere. Outbound requests go to the model providers you configure, and nowhere else.
- **Approvals gate anything that changes your machine.** Permission rules answer allow, deny or ask; a deny is final, and the agent has no way to change its own rules. Files outside the data folder, shell commands and card edits fall under these rules.
- **The app runs as a normal Mac app.** macOS privacy permissions, Cardiary's permission rules and the three-zone rule govern access to protected resources and data. Distribution is planned as a signed, notarized direct download.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Cards](docs/cards.md)
- [Permissions and approvals](docs/permissions.md)
- [Development](docs/development.md)
- [Contributing](CONTRIBUTING.md)

## Contributing

Cardiary is at an early stage and the design is still moving. Bug reports and small fixes are welcome as issues or pull requests, in English or Traditional Chinese.

For anything larger, open an issue first. The protocol, the card file format and the permission rules are the parts most likely to change, and it is better to agree on the shape of a change before you write it.

There is no CLA. Contributions are accepted under the MIT license.

## License

MIT. See [LICENSE](LICENSE).
