# Cards

A card is a Markdown file in the Cardiary data folder.
Its path is `cards/<ulid>.md`, where the filename is the card's
ULID.
The file starts with YAML front matter between `---` lines,
followed by the Markdown body.
You can inspect and edit the file in a text editor.

## Read a card file

For example, a file named `cards/01JCW2Q3W7Z9K5V2N4M6P8R0T1.md`
can contain:

```markdown
---
id: 01JCW2Q3W7Z9K5V2N4M6P8R0T1
kind: note
title: Garden notes
created: 2026-11-14T02:00:00Z
tags: [garden, ideas]
---

Plant herbs near the kitchen.
```

Keep the `id` equal to the filename without `.md`.
The parser requires a valid ULID, a recognized `kind`, a nonempty
`title`, and a valid `created` date.
It recognizes RFC 3339 timestamps and date-only values.
A file with invalid front matter is marked broken rather than
silently repaired.

The recognized fields are:

| Field          | Meaning                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `id`           | Card ULID; it must match the filename. Cardiary creates it for new cards.      |
| `kind`         | One of `note`, `image`, `audio`, `memory`, `summary`, `persona`, or `bedrock`. |
| `title`        | Nonempty card title.                                                           |
| `summary`      | Optional short description.                                                    |
| `created`      | Creation date or timestamp, set when Cardiary creates the card.                |
| `updated`      | Optional timestamp. Cardiary updates it when applying a card patch.            |
| `sources`      | Optional list of source card IDs.                                              |
| `supersedes`   | Optional ID of a card replaced by this one.                                    |
| `tags`         | Optional list of tags.                                                         |
| `asset`        | Optional path under `assets/`, used for an image or audio original.            |
| `persona`      | Optional persona; an absent or empty value is interpreted as `default`.        |
| `importedFrom` | Optional import metadata containing `tool`, `path`, and `hash`.                |

You can edit the text fields and body, but preserve the identity
and valid field formats.
Cardiary sets `updated` again when it applies a later patch.
Unknown front matter fields and comments are preserved when
Cardiary rewrites a valid file.
The parser supports the card front matter format used by Cardiary.

The host calculates `revision` from normalized card content,
stores it in the index, and uses it to detect conflicting patches.
A card file's recognized front matter fields are listed above.
If you add a `revision` or `freshness` field, the parser preserves
it as an unknown field rather than using it as the calculated value.
Unknown fields also contribute to the calculated revision.
After an external edit, a patch based on an older revision can be
rejected; read the card again before retrying.
The state database stores freshness separately from the card file.

## Keep imported media

Image and audio originals are stored as
`assets/<sha256>.<extension>` relative to the data folder.
An image or audio card can refer to its original through the
`asset` field.
The body can also contain a reference using an
`assets/<sha256>.<extension>` path.

The filename contains a SHA-256 hash of the content.
Importing the same bytes with the same extension reuses the
existing file.
The same bytes with different extensions can occupy more than one
file.
Keep both the card and the assets it references when making a
backup.

Cardiary scans the actual card files for asset hashes before
reclaiming an asset.
If it cannot complete the scan or the index is not ready, it
skips reclamation.
An unreferenced asset can also be reclaimed during startup
cleanup.
Use `assets/` for originals referenced by card files.

## Understand freshness

Freshness is a value from 0 to 100 stored in
`state/cardiary.sqlite`.
A new card starts at 100.
Normally the value decays over time, with a default half-life of
30 days.
A counted load or an explicit refresh returns it to 100; a search
preview does not count as a load.

When every conversation that references a card is archived, its
freshness falls linearly toward zero by the earliest archive
deadline.
A card that loses all its conversation references after having
been used becomes an orphan and has freshness zero.
A new card that has never been referenced still follows normal
decay.
Zero freshness does not by itself delete the card file.

## Rebuild the index

The host indexes card files in `cache/index.sqlite` for listing
and search.
That index is a cache; card Markdown and assets are the
originals.
Stop the service before removing `cache/` and start it again to
rebuild the index by scanning the cards.
Keep `state/` when rebuilding the cache: it contains conversation
and freshness data that the card files cannot reconstruct.

While the host is running, it watches `cards/` for external
edits.
It also rescans periodically and scans at startup, so a missed
file notification can be picked up later.
If a card remains marked broken, check the delimiters, required
fields, timestamp, and matching filename and ID.
The host preserves an invalid file for you to repair.

## Archive or delete a conversation

Archiving starts a countdown for a conversation.
The default countdown is seven days, and you can unarchive before
it expires.
At expiry, the host first creates a summary; if that fails, it
retains the conversation for a later retry.
After a successful summary, it deletes the conversation and its
branches and removes their card references.
The original cards remain; cards left without references have
freshness zero.

Immediate conversation deletion follows a different path.
The app first requests a preview and displays the affected counts
before confirmation.
Deletion removes the conversation and its branches, plus cards
exclusive to them.
Cards referenced by other conversations or pinned are retained.
For a deleted card, the host removes its Markdown file, index
entry, and state, and attempts to reclaim its unreferenced asset.
Shared assets and assets whose references cannot be checked
safely remain.

## Repair a card by hand

1. Back up the card and any referenced assets.
2. Open its file in `cards/` and correct the front matter or Markdown body.
3. Keep the `id` and filename in agreement and retain the opening and closing `---` lines.
4. Save the file, then allow the host's file watcher or periodic scan to update the index.
5. If necessary, restart the service and check the card again after its startup scan.

If you need to rebuild a missing cache, follow [Rebuild the
index](#rebuild-the-index).
