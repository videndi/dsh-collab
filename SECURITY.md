# Security policy

## What this plugin exposes

`dsh-collab` publishes an HTTP surface of its own and can publish it to the public internet.

| Surface | Where | Who can reach it |
|---|---|---|
| `/dsh-collab/api/*` (state, create, join, message, lab, tunnel) | DSH `webServer`, i.e. your normal Web UI port | whatever can reach your DSH port; the DSH host authenticates that port |
| `/dsh-collab/relay/*` (join, report, message, snapshot, health) | same port **and** the plugin's own loopback-only service | members of the room, by invite code |
| `/dsh-collab/join?c=CODE` | same | anyone with the link |
| Public tunnel | `https://<random>.trycloudflare.com` via `cloudflared` quick tunnel | anyone who has the URL |

The tunnel points at the plugin's **own** loopback service, not at the DSH Web UI port, so a public tunnel never
exposes the Harness UI, sessions, files, or tools.

## Threat model you should accept

- **The invite code is a room check, not authentication.** Anyone holding both the relay URL and the 6-character
  code can join, read member summaries, and post messages. Treat the invite link like a shared secret with a
  short lifetime.
- **Summaries are shared, transcripts are not.** Members see session titles (directory names), tool names, the
  latest user line (truncated to 160 chars), turn counts, and token counters. They do not receive model output,
  file contents, credentials, or the ability to drive another member's agent.
- **No remote command execution is introduced.** The relay accepts data about sessions; it never accepts a
  tool call, a path to execute, or a prompt aimed at someone else's agent.
- **A public tunnel is a temporary public endpoint.** Quick tunnels get a random hostname and stop with the Host
  process. Stop the tunnel (panel button) when you are done, and do not leave it running unattended.

## Reporting

Open a private security advisory on the repository
(https://github.com/videndi/dsh-collab/security/advisories/new) rather than a public issue.
Include the version (`package.json`), what an attacker can do, and the smallest reproduction you have.
