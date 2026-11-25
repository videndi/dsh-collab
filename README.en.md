# dsh-collab — multiplayer collaboration room for DeepSeek Harness

English | [中文](README.md)

> A **Collaboration** preset for [DeepSeek Harness](https://github.com/deepseek-ai): invite teammates into your
> project, and every member runs their own agent on their own machine and their own account — while one panel
> shows everyone's live session progress, current tool call, and token usage.
>
> No shared LAN required: one click opens a Cloudflare quick tunnel, so the invite link / QR code works from any
> network, without exposing the DSH UI itself.

## Why "each pays their own tokens"

Collaboration never proxies inference and never shares credentials. The plugin only syncs **summaries**
(session title, current tool name, latest user line, turn count, token counters). Model calls happen on each
machine with each person's provider and billing. The room owner does not pay for anyone else, and nobody sees
another member's transcript.

## Three ways to connect

| Scenario | Address you get | Requirement |
|---|---|---|
| Same machine (try it / lab) | `http://127.0.0.1:<port>/…` | nothing — the panel has a one-click **on-machine lab** |
| Same LAN | `http://<your-lan-ip>:<port>/…` (auto-detected) | both sides on that LAN |
| **Any network** | `https://<random>.trycloudflare.com/…` | a machine that can reach the internet; click **Public invite**, no VPS and no port forwarding |

The tunnel only exposes the plugin's own small service (`/dsh-collab/relay/*` and the invite landing page), never
the DSH Web UI. It dies with the Host process.

## Install

Put this directory anywhere, then in your DSH session (Collaboration or Creation preset) ask the agent to run:

```
plugin_manager action=install_bundle target=<absolute path to this directory>
```

Then **restart DSH once** (Host-side JS is not hot-swapped) and reload the page. The collaboration bar appears
under the composer.

## Use

1. New session → preset **Collaboration**.
2. Under the composer click **open collaboration** → pick a name → **create room**. The room binds to your
   project (taken from the latest session directory; you can type one instead).
3. For cross-network invites click **Public invite**; the QR code and link switch to `https://…trycloudflare.com`.
4. A teammate opens the invite link inside their own DSH → the panel prefills relay and code → **join**.
   Scanning the QR code or pasting `relay=… code=…` works too.
5. Each member card shows: who is running, which tool, latest activity, turn, tokens; plus the room total.
6. Alone? Click **on-machine lab** to spawn two simulated members over real loopback HTTP.

## Self-check and lab (no DSH process needed)

```bash
npm run lab                     # on-machine lab: host + member instances on loopback, 13 assertions
node scripts/tunnel-check.mjs   # public path (needs internet): real tunnel, join over the public URL
npm run selftest                # health check of a running DSH (default 127.0.0.1:53796)
```

`lab.mjs` drives `apply(ctx)` through a fake Cordis context on a real `node:http` server, so plugin changes can be
verified without restarting DSH. It also serves as the protocol regression suite — the historical defect
"route left behind after unload → duplicate prefix route" is one of its cases.

`qr.js` is a self-contained offline QR encoder (byte mode, versions 1–40, L/M/Q/H, mask selection);
`scripts/qr-decode.mjs` is an independent decoder (format bits → BCH check → unmask → inverse zigzag →
de-interleave → RS verify). They share no code path, so a round-trip pass means the symbol is self-consistent.

## Layout

| File | Role |
|---|---|
| `index.js` | Host: `/dsh-collab` on `webServer` (state, invite, relay, landing page, lab, public tunnel); folds `session/event` into progress cards |
| `qr.js` | offline QR encoder producing an SVG path |
| `client.js` | Web UI: status bar and panel in `conversation.composer.dock` |
| `cordis.patch.yml` | declares the Host row and the **Collaboration** preset |
| `scripts/harness.mjs` | fake Cordis context + real http server test bench |
| `scripts/lab.mjs` | on-machine multiplayer lab (13 assertions) |
| `scripts/tunnel-check.mjs` | public tunnel check (8 assertions) |
| `scripts/selftest.mjs` | QR round-trip + live DSH health check |
| `scripts/qr-decode.mjs` | independent QR decoder for verification |

Wire protocol is short: owner serves `/dsh-collab/relay/{join,report,message,snapshot,health}`; members report
every 2 seconds and pull a snapshot; the owner merges local progress with all member progress for the browser.

## Known limits

- Room and member progress live **in memory**; a DSH restart clears them.
- Progress keeps sessions active in the last 6 hours, at most 40, summaries only.
- The invite code is a room check, not authentication. A leaked tunnel URL plus code means the room can be
  joined — do not post it publicly.
- Files are not synced across machines: everyone works on their own copy; the panel shows each project path so
  nobody assumes it is the same working tree.
- A quick tunnel gets a fresh hostname on every start. For a stable domain, run your own named tunnel and point
  `relay` at it.

## License

MIT. See [LICENSE](LICENSE).
