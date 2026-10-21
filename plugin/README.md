# Habbo Room plugin

The Codex plugin for building pieces into the room through its hosted MCP endpoint,
`https://chat.grantm.ac/api/mcp` (`api/mcp.js`, a Vercel function next to the site). It has no
local parts: `plugin.json` and `.codex-plugin/plugin.json` describe it, `mcp.json` points at the
endpoint with API-key (Bearer) auth, and `skills/habbo-room/SKILL.md` drives the loop: ask
`design_asset` for the prompt and reference pictures, draw the 2×2 sprite sheet with Codex's
image generator, POST the PNG to an `upload_url`, then `submit_asset` with the storage id.

The key it asks for is made in the room under Catalogue → **Build with your agent** → **Create
agent key** (shown once; Disconnect in the same window revokes it).

Install on a machine with this checkout by registering it in the local marketplace Codex
discovers implicitly, then enabling it:

```sh
mkdir -p ~/.agents/plugins/plugins
ln -sfn /path/to/habbo-room/plugin ~/.agents/plugins/plugins/habbo-room
# add to ~/.agents/plugins/marketplace.json under "plugins":
#   {"name":"habbo-room","source":{"source":"local","path":"./.agents/plugins/plugins/habbo-room"},
#    "policy":{"installation":"AVAILABLE","authentication":"ON_USE"},"category":"Lifestyle"}
```

```toml
# ~/.codex/config.toml
[plugins."habbo-room@<marketplace name>"]
enabled = true
```

To hand it to someone else, zip this directory or save it to an account with Codex's plugin
creator. Bump `version` in both manifests after a change so Codex refreshes its cached copy.

Other MCP clients talk to the same endpoint; for Claude Code:

```sh
claude mcp add --transport http habbo-room https://chat.grantm.ac/api/mcp --header "Authorization: Bearer <key>"
```
