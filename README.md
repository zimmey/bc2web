# BC2 Player Watch

A single-page, static web app that watches a **Battlefield: Bad Company 2**
server (via the [bflist.io](https://bflist.io) API) and shows whether a
particular player is online, as a colored dot:

| Color  | Meaning |
| ------ | ------- |
| 🟢 green  | The player is on the target server |
| 🟡 yellow | The player is online, but on a **different** server |
| 🔴 red    | The target server is up, but the player is not on it |
| ⚪ grey   | The target server is offline (not in the server list) |

Below the dot it shows the roster inline: a two-column table
(Team 1 | Team 2) with the watched player highlighted green.

## Configure who you're watching

Everything is configurable, and the config lives in the **URL query string** so
links are shareable and bookmarkable. Open the **⚙ settings** panel on the page,
or build a link by hand:

```
https://<you>.github.io/bc2web/?player=someone
https://<you>.github.io/bc2web/?player=someone&guid=<server-guid>
```

| Param      | Meaning                                              | Default |
| ---------- | ---------------------------------------------------- | ------- |
| `player`   | Player name to watch (case-insensitive)              | *(none — set one)* |
| `guid`     | Target server GUID (re-finds the server if its IP changes) | `a29658-5436dd8-25091f8-865ea20` |
| `ip`       | Last known server IP (auto-updated)                  | `64.188.124.238` |
| `port`     | Last known server port (auto-updated)                | `19569` |
| `api`      | bflist API base URL                                  | `https://api.bflist.io/v2/bfbc2` |

Only non-default values appear in the URL, so shared links stay short. The
auto-discovered `ip:port` is also cached in `localStorage` (keyed by GUID), so
the app self-heals when a server changes address.

## How it checks

The check runs once on page load (the ⟳ button re-runs it) — a single request
in the common case:

1. One direct query to `…/servers/<ip>:<port>`.
   - Responds and the player is present → **green**.
   - Responds but the player is absent → fetch the list once to see if they're
     playing elsewhere → **yellow**, otherwise **red**.
2. If the direct query 404s, the server may have moved. Fetch the list, find the
   server by its **GUID**, persist the new `ip:port`, then apply the logic above.
   If the GUID isn't in the list at all → **grey** (still checking for the player
   elsewhere → yellow before settling on grey).

The bflist API sends `Access-Control-Allow-Origin: *`, so the page calls it
directly from the browser — no server or proxy needed.

## Run / deploy

It's plain static HTML/CSS/JS — no build step.

**Locally:**

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

**GitHub Pages:** push this repo, then in *Settings → Pages* set the source to
the `main` branch (root). The site appears at
`https://<you>.github.io/<repo>/`.

## Layout

```
bc2web/
├── index.html   # markup
├── style.css    # dark card
├── app.js       # check logic + config
└── README.md
```
