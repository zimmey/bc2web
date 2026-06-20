# BC2 Player Watch

A single-page, static web app that watches a **Battlefield: Bad Company 2**
server (via the [bflist.io](https://bflist.io) API) and shows whether one or
more players are online, as a colored dot:

| Color  | Meaning |
| ------ | ------- |
| 🟢 green  | A watched player is on the target server |
| 🟡 yellow | A watched player is online, but on a **different** server |
| 🔴 red    | The target server is up, but no watched player is on it |
| ⚪ grey   | The target server is offline (not in the server list) |

Below the dot it shows the current **map**, then the roster inline: a
two-column table (Team 1 | Team 2, each with its ticket count) with watched
players highlighted green.

## Configure who you're watching

Set the player(s) in the **⚙ settings** panel, or put them straight in the
**URL** so the link is shareable/bookmarkable. To watch more than one, give a
**comma-separated** list — the dot goes green if *any* of them is on the server:

```
https://<you>.github.io/bc2web/?player=alice
https://<you>.github.io/bc2web/?player=alice,bob,carol
```

Names are case-insensitive. The watched player(s) are the only thing stored in
the URL.

The target server is fixed in `app.v1.js` (`SERVER`). Its `ip:port` is cached in
`localStorage` and self-heals via the server **GUID** if the address ever
changes, so there's nothing to configure for that.

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
├── index.html    # markup
├── style.v1.css  # dark card
├── app.v1.js     # check logic + config
└── README.md
```

The CSS/JS filenames carry a version (`.v1.`) so the browser can't serve a
stale copy against a newer `index.html` — GitHub Pages caches each file for 10
minutes independently, and a mismatched set would break the page. **When you
edit `app.v1.js` or `style.v1.css`, bump the version** (e.g. to `.v2.`) by
renaming the file and updating its reference in `index.html`.
