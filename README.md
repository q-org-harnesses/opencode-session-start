# opencode-session-start

An [OpenCode](https://opencode.ai) 2 plugin that runs an agent's Session Start routine itself, on the first prompt of a session, and gives the model the report as context. The model no longer spends a turn running the script, and cannot skip or fake it.

## Provided as is: no support

The code is published for anyone to read, use and fork under the MIT license. It is **not supported**: the Issues tab is turned off, and pull requests, questions and feature requests are not monitored.

## Credit

Written by **Claude Sonnet 5.5 (Anthropic)**, working with a human owner.

## How it works

1. On the first prompt of a session, the plugin runs a script you configure (default `python3 ~/.config/opencode/session_start.py`) with a time limit. The script prints its report to stdout; the plugin sets `SESSION_START_NO_WRITE=1` so a script can tell it must not save anything itself.
2. The plugin stores the report in a folder the harness owns, or writes one line to the OS log (`reportTarget`).
3. On every request of that session, the plugin adds the report to the system context, headed "Session Start (done by the session-start plugin; do not run session_start.py yourself)".
4. If the script fails or times out, the model gets a one-line notice and is told to run the routine itself once. The plugin never throws into a prompt.

## Skipping and switching off

- A first message that starts with `[no-start]`, or with a command in `triggers` (default `/task`), skips Session Start for that session: nothing runs and nothing is injected.
- `"enabled": false` in the plugin options, or the environment variable `SESSION_START=off`, switches the plugin off entirely.

## Options

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `triggers` | `["[no-start]", "/task"]` | First-message prefixes that skip Session Start. A trigger starting with `/` must be followed by whitespace or the end of the message. |
| `command` | `["python3", "~/.config/opencode/session_start.py"]` | The script to run (argument list, no shell). |
| `timeoutMs` | `60000` | Time limit for the script. |
| `reportTarget` | `"harness"` | `"harness"` writes `session_start_latest.md` to `reportDir`; `"syslog"` writes one line through `logger -t session-start` and no file. |
| `reportDir` | `~/.local/share/opencode/session-start` | Where the harness-owned report goes. |
| `refusePaths` | `[]` | If `reportDir` contains any of these strings, the file is not written (use it to keep the plugin out of a notes vault). The report is still injected. |

## Install

Clone this repository anywhere and add it to `opencode.json`:

```json
"plugins": [{
  "package": "/path/to/opencode-session-start",
  "options": { "reportDir": "~/.local/share/opencode/session-start" }
}]
```

Then remove any instruction from your `AGENTS.md` that tells the model to run the Session Start script itself, or it will run it twice.

## Tests

```bash
npm test    # node:test, no dependencies
```

## License

MIT, see `LICENSE`.
