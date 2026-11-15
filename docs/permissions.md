# Permissions and approvals

Cardiary evaluates an agent's tool action before it runs.
The result is allow, deny, or ask for a person's decision.
The rules allow some limited operations directly, ask about
others, and reject protected actions.
This gives you a chance to review actions that can affect files
or run commands on your machine.

## Respond to a request

- **Allow** means the applicable rule permits the action.
- **Deny** means the action is rejected. A saved approval cannot override a deny rule.
- **Ask** means the host requests a human decision before the action proceeds.

For example, reading a card and creating a card are allowed by
the card rules.
Patching or deleting a card requires approval.
Some reads and limited read-only commands are allowed within
their permitted locations; other file operations and shell
commands can require approval.
The request describes the action and its scope so you can decide
whether to approve it.
An unrecognized tool is treated as a high-risk approval request
and cannot be saved as an always-allow rule.

Deny rules include credential access, privilege escalation,
destructive disk operations, protected system writes, and
modification of protected Cardiary paths.
The agent cannot change those rules or turn a denial into an
approval.

## Choose when to always allow

When available, **Always allow** approves the current request and
saves a rule for later requests.
The rule records the tool name, action kind, and scope.
For file actions, the scope is the working directory and matching
targets within it.
For shell actions, the scope is the working directory; the action
kind and tool must also match.
Some non-path actions use a global scope for that tool and action
kind.
Review the scope shown in the request before saving it.

Saved rules persist across conversations and can be revoked.
They do not override deny rules or the operating system sandbox.
Always allow is offered when the request includes a supported
action, tool, and scope that the host can save.

## Understand settings levels

Settings have three levels for agent-initiated changes:

- `free`: the agent can change the setting without a separate approval.
- `approval`: a human must approve the change.
- `human-only`: the agent is denied; a person must make the change.

This classification applies to setting changes.
It does not grant the agent permission to edit the permission
rules themselves.

## Run commands within the sandbox

On macOS, `run_command` starts the shell and its child processes
under the operating system sandbox.
If the sandbox is unavailable, the command is rejected rather
than run without it.
The sandbox normally permits writes only inside the working
directory and the Cardiary folder's `tmp/` directory.
It also permits writes to the null device.
Protected paths remain blocked even if they overlap an allowed
write directory.

Protected writes include the Cardiary originals and state, system
locations, and the app bundle.
The sandbox denies reads of sensitive locations such as the home
directory's `.ssh`, `.aws`, and `.gnupg` directories and Keychain
files.
It also blocks credential filename patterns such as `.env`,
private keys, and `credentials` files.
The permission rules separately deny credential access and use of
the Keychain command-line tool.
The app provides a configured provider key through its
restricted Keychain broker when the host needs it.

Approval does not grant a shell process access to protected
locations.
For example, `npm install` may fail if it tries to write a cache
in the home directory.
Configure the tool to use a cache inside the working directory or
the Cardiary temporary directory, and keep any resulting project
writes within the approved scope.
Keep credentials in their protected locations.

The shell sandbox limits writes and sensitive reads; its profile
allows network access.
The app itself runs as a normal macOS app.
