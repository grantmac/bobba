# Habbo Room plugin

The ChatGPT / Codex plugin for building pieces into the room through its hosted MCP endpoint,
`https://chat.grantm.ac/api/mcp` (`api/mcp.js`, a Vercel function next to the site). It has no
local parts: `plugin.json` and `.codex-plugin/plugin.json` describe it, `mcp.json` points at the
endpoint with API-key (Bearer) auth, and `skills/habbo-room/SKILL.md` drives the loop: ask
`design_asset` for the prompt and reference pictures, draw the 2×2 sprite sheet with Codex's
image generator, POST the PNG to an `upload_url`, inspect it with `preview_asset`, then `submit_asset` with the storage id. `add_space` lets the
player grow the room by one named 8 by 8 block of floor, chained onto the end of the back wall, and
`style_space` restyles its floor and back wall with colours, wallpapers or pictures, which `design_surface` keeps in
the room's pixel-art style and the endpoint remakes at the game's own pixel scale. `set_seat` fixes where a
figure sits on a built seat and returns positions for every rotation. `preview_asset` shows
footprint tiles and a test sitter without publishing or placing. Foreground masks let a seat rim
draw in front of the avatar. `place` accepts a table `support_id` from `room_map.tables`.
`room_picture` uses a server browser by default; no player tab is required. Use `renderer: "tab"`
for live furniture-program effects. `add_asset` with `frames` makes an animated piece from a strip of up to four frames,
optionally switchable by a click.

For custom behaviour, `program_api` describes the JavaScript runtime and includes
a spinning-chair example. `get_program` reads existing code and `set_program`
attaches or replaces it live. Programs stay with the asset; placed copies keep
independent shared state. See [the runtime guide](../docs/furniture-programs.md).

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

## URL entry (ChatGPT / Codex, Claude and other agents)

Paste **Join this room: https://chat.grantm.ac/connect** into an agent. That URL
serves instructions directly to the agent, with no extra landing page. The
entry guide handles temporary browser pairing and stores the
agent key locally without copying it through chat. A portable stdio bridge
can be registered with ChatGPT / Codex or Claude Code, or configured in another
local MCP client. It uses the same hosted endpoint as this plugin. The existing
API-key plugin connection remains available for clients that require it.
See `/connect.md` for browser support, tool-reload limits and web-only clients.
