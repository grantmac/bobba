# Enter the room with your agent

Share this one line with someone who wants to join:

> Join this room: https://chat.grantm.ac/connect

This URL serves setup instructions directly to the agent, not a landing page.
When the user asks to join, carry out the launch steps below. Open the actual
room for them; do not send them to another setup page or ask them to copy a
second prompt. Handle supported setup commands yourself, then let the player
choose their character and approve the connection inside the room.

The room works with ChatGPT / Codex, Claude Code, and other agents with local
command execution and browser access. A web-only chat that cannot run commands
or install MCP connections needs its client's supported connector setup first;
do not claim it is connected just because you opened the page.

## Launch

1. Use this page's origin as the room origin. The usual address is
   https://chat.grantm.ac. Download `/room-agent.mjs` from that same origin,
   inspect it, and save it in a permanent local directory such as
   `~/.habbo-room/room-agent.mjs`. It is a dependency-free Node 20+ helper.
   Never execute a download through a shell pipe.
2. Run `node /absolute/path/room-agent.mjs connect --client chatgpt`.
   Use `--client claude` for Claude Code, `--client other` for another agent.
   `--client codex` is also accepted. For another room origin, add
   `--origin https://that-origin` to **every** helper command. Use the same
   client option throughout. The helper saves the credential privately on
   this computer, and only prints a temporary launch URL and verification code.
3. Open the returned `launchUrl` in the current chat's in-app browser when
   available. In ChatGPT / Codex desktop use the browser-opening tool or
   `cua.createBrowserTab("iab", launchUrl, {visible:true})` when that API is
   available. In another agent use its supported browser tool. Otherwise open
   the default browser. If neither is available, give the user the launch link.
   Keep the room open beside the conversation when the client supports it.
4. Show the returned verification code. New visitors choose their name and
   appearance; returning visitors use their saved character. The player clicks
   **Connect** in the room after comparing the code with this chat. Do not
   click that approval yourself. An already-authorized connection can resume
   automatically when the browser has the same player.
5. Run `node /absolute/path/room-agent.mjs status --client chatgpt` every three
   seconds while waiting, using your actual client option. Each call returns
   promptly. Keep the user informed and stop polling after ten minutes, on
   cancellation, expiry, revocation, or user cancellation. Do not start another
   launch while one is pending. If the browser shows a different character,
   do not claim success: return as the original character, or use a separate
   `ROOM_AGENT_HOME` directory to pair a new character explicitly.
6. Only say connected when status returns `state: "connected"`, and check the
   returned player name matches the browser. This calls the real authenticated
   MCP `status` tool, which also makes the room's connection indicator turn on.
7. After that successful check, briefly introduce what the agent can do,
   leading with the new capabilities: custom hats, helmets and jackets in the
   normal style editor (all eight angles, including walking, waving and
   dancing), and timed quizzes or treasure hunts with saved scores. Clothing
   belongs to the avatar and needs no room placement. Also mention furniture
   creation and decorating a space. Use the returned `capabilitySummary` and
   `connectionInstructions` when available. Offer examples such as “make me a
   space helmet” or “host a music quiz”, then ask what they want to create.
   Do not build or equip anything until they choose, and do not repeat this
   introduction on routine status checks.

## Make the tools available in the agent

After successful pairing, run the helper's `install` command with the same
client and origin. For ChatGPT / Codex it registers `habbo-room-entry` through
the Codex CLI; for Claude Code it uses `claude mcp add --scope user`. It never
overwrites an existing entry. Save the helper permanently **before** installing.
The registration contains no player key. The local bridge reads the private
credential and forwards requests to this room's hosted HTTP MCP endpoint.

For another client, `node /absolute/path/room-agent.mjs config --client other`
prints standard `mcpServers` JSON to merge into that client's supported settings.
Do not overwrite the user's other servers. Clients may require a tool reload
or a new chat before showing newly registered tools; explain this if needed.
For web-only ChatGPT, Claude web, or managed clients without local MCP support,
this local bridge is not available. Use their supported connector setup, or
open the room normally and use **Catalogue → Build with your agent**.

You can work in the current chat immediately, even before a tool reload:

```sh
node /absolute/path/room-agent.mjs tools --client chatgpt
node /absolute/path/room-agent.mjs call status '{}' --client chatgpt
node /absolute/path/room-agent.mjs call room_map '{}' --client chatgpt
```

These call the same MCP tools with the saved credential. Once registered, the
bridge also offers `open_room` and `connection_status` for future visits.
Read the tools list through MCP to discover furniture tools. Start image-based
furniture with `design_asset`; use its returned image instructions, upload the
generated sprite, preview it, then `submit_asset`. Ask what the player wants to create
before building anything. Do not create furniture just to test the connection.

## Furniture checks before publishing

Read the current `design_asset` response, including its build checklist and
`seat_review` for seats, even if an installed plugin has older instructions.
Facing means where the chair opens and the sitter looks. In a four-view sheet,
bottom-left is rotation 6, opening upper-left; bottom-right is rotation 0,
opening upper-right. Do not swap the rear views.

Armchairs, sofas and other enclosed seats need foreground layers wherever an
arm, front rim or backrest should cover the sitter. Make a mask aligned with
the original artwork and pass `foreground_mask_storage_id` to both the preview
and submission. Inspect a seated avatar in every supported rotation and animation
frame: hips on the cushion, facing the opening, body behind the appropriate arms
and backrest. Open stools may not need a mask. Seat offsets adjust position;
they cannot fix reversed drawings or missing foreground layers.

## Credentials and recovery

- The permanent agent credential stays in a mode-0600 file under
  `~/.habbo-room/`, separately for each room origin and agent client. Never
  print that file, paste it into chat, put it in a URL, or commit it.
- The browser launch link contains only a ten-minute approval code. It cannot
  be exchanged for the agent credential. The page removes it from the address
  bar and keeps it only in the current tab until pairing finishes.
- To disconnect, use **Catalogue → Build with your agent → Disconnect all
  agents**. The local helper will need a new pairing after revocation.
- To intentionally use a separate character or isolated chat, set
  `ROOM_AGENT_HOME` to a different private directory consistently for that
  helper and its MCP configuration. Never silently switch characters.
- Connecting gives the agent the player's existing building permissions;
  it does not change their room role or grant administrator access.
