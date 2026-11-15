# Contributing

Cardiary is in early development and its design is still
changing.
For a substantial change, open an issue first so contributors can
discuss its direction before implementation.
Small fixes and bug reports are welcome.

## Report a bug

Include enough information for someone else to reproduce the
problem:

- The Cardiary version or Git commit and your macOS version.
- Steps to reproduce, including what you expected and what happened instead.
- Relevant errors and a minimal example, when possible.
- Relevant service logs from the selected data folder's `logs/` directory.

Review logs and examples before sharing them, and remove private
information or credentials.
If the issue involves a card, include a minimal example with its
private contents replaced by sample text.
Describe whether the problem persists after restarting the app
when that is relevant to reproducing it.
To report a security problem, first open an issue stating only
that you want to report a security issue. Keep the security
details out of the public issue.

## Propose a change

1. Create a branch for the change. You can use a separate Git worktree if useful.
2. Make the change and add or update tests where the behavior needs coverage.
3. Run `pnpm check` and `pnpm test:swift` on macOS.
4. Open a pull request describing the problem, the motivation, the approach, and any tradeoffs.
5. Include the checks you ran and explain anything you could not verify.

See [Development](docs/development.md) for setup, other tests,
and package boundaries.
The [documentation index](docs/README.md) links to the user and
maintainer guides.

## Write commit messages

Use English Conventional Commits with a short sentence describing
the change.
Use the body to explain why when the subject is not enough.
For example:

```text
feat: add card search
fix: preserve card comments
test: cover archive cancellation
docs: explain card freshness
chore: update development dependencies
```

## License

Contributions are accepted under the [MIT license](LICENSE).
There is no contributor license agreement.
