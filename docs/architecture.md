# Architecture

Cardiary separates its macOS interface from a local host service.
The SwiftUI app starts and supervises the Node.js host.
Closing the window leaves the service running; the app also has a
menu bar interface.
The host can run independently of the app, including during
development and contract tests.

## Follow a request

The app communicates with the host over a local protocol on
`127.0.0.1`.
HTTP serves local endpoints including blob transfers, and
WebSocket carries JSON protocol frames.
The shared protocol package contains the JSON schema and
generated types.
The gateway checks incoming frames and routes valid requests to
the appropriate handler.
Invalid requests receive an error instead of reaching the
requested operation.
The client protocol authenticates each local client connection
with a token issued when the service starts.

The client associates responses with requests and subscribes to
streams for ongoing updates.
Some events are durable and can be replayed after a disconnect;
streaming text itself is not retained in the event log.

A card request, for example, reaches the cards module through the
gateway.
The module uses domain rules and storage to read or change the
card.
The host returns a response linked to the request and publishes
events for changes.
`card.changed` reports card changes on the system stream;
`session.*` events describe conversation changes.
A client can use these events to update its view without opening
the data folder itself.

The app also provides system services, such as access to a
selected folder and a specific Keychain item, through a separate
control channel.
That private channel connects the shell and its supervised host.
The host can also run independently of the app.

## Locate the code

| Path                      | Responsibility                                                            |
| ------------------------- | ------------------------------------------------------------------------- |
| `packages/protocol`       | JSON schema, generated types, and shared protocol test support.           |
| `packages/domain`         | Engine-independent card, freshness, context, media, and permission rules. |
| `packages/engine-adapter` | The Pi Durable adapter and the host-facing engine interfaces.             |
| `packages/engine-fake`    | An in-memory engine for tests and the demo assembly.                      |
| `packages/module-api`     | Interfaces and registry types for host modules.                           |
| `packages/storage`        | Folder layout, files, SQLite stores, indexes, and cleanup.                |
| `packages/host`           | Service assembly, protocol gateway, permissions, and first-party modules. |
| `packages/contract-tests` | Black-box protocol tests against a host process.                          |
| `apple/CardiaryKit`       | Shared Swift protocol types and client code.                              |
| `apps/macos`              | SwiftUI interface, shell, service supervision, and macOS integration.     |

First-party host modules live under `packages/host/src/modules/`.
A module registers its protocol handlers with the host rather
than opening another client connection.

## Keep ownership clear

The host owns the data folder.
Clients display state and send commands through the protocol
rather than reading card files or SQLite directly.
The app's folder picker and bookmark provide the host with access
to the selected folder.

The engine is replaceable.
Only `packages/engine-adapter` imports Pi Durable in the product
packages; its dependency is pinned to version `1.5.2`.
The domain package does not depend on engine types.
The fake engine supplies another implementation for tests and the
demo.

Files are the originals for cards and imported assets.
A card is Markdown in `cards/`; an imported image or audio file
is stored under `assets/`.
The SQLite card index in `cache/` can be rebuilt from those
files.
Keep the SQLite data in `state/`, including conversation state
and freshness information; it is separate from the card index.
See [Cards](cards.md) for the file format and cleanup behavior.

The folder also contains temporary files and logs.
`tmp/` is cleared when the service starts; `logs/` contains
diagnostic logs.
The storage package handles folder layout and initialization.

## Recover after a disconnect

System and conversation streams have sequence numbers and an
event epoch.
On connection, the client learns the host's current epoch.
For a stream with a saved sequence number in that epoch, it sends
the epoch and last sequence number when it subscribes again.
The host replays retained events after that number when they are
available.

If the epoch changed, there is no cursor, or the requested events
cannot be replayed, the host returns a fresh snapshot instead.
The Swift client discards the old cursor when the epoch changes
and reloads the stream state.
A session snapshot has a bounded history; older conversation
messages can be requested separately.
Clients should treat an epoch as part of the cursor, not compare
sequence numbers across epochs.

## Explore further

- [Cards](cards.md) explains the files and their indexes.
- [Permissions](permissions.md) describes the permission gate and command sandbox.
- [Development](development.md) explains how to build and test the components.
