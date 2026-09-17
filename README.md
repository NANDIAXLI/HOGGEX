# HOGGEX — portfolio site

Black-and-white portfolio that shows your ArtStation and Behance work **inside** the site.
Visitors never leave. New projects you post appear here on their own.

## Files

- `index.html` — the whole site (home, galleries, post pages). No build step.
- `api/feed.js` — server function that pulls your latest projects from both platforms.
- Nothing else.

## Deploy (about 5 minutes, free)

1. Put this folder in a GitHub repo (or drag it into Vercel directly).
2. Go to **vercel.com** → New Project → import the repo → Deploy.
3. Done. You get a live URL like `hoggex.vercel.app`.
4. Optional: connect your own domain in Vercel → Settings → Domains.

Works the same on **Netlify** and **Cloudflare Pages** — the only change is moving
`api/feed.js` to `netlify/functions/feed.js` (Netlify) or `functions/api/feed.js` (Cloudflare).

## Changing accounts

Default usernames are `hoggex` (ArtStation) and `youniszone` (Behance).
To point elsewhere, add environment variables in Vercel:

```
ARTSTATION_USER=hoggex
BEHANCE_USER=youniszone
```

## How the auto-update works

`/api/feed` fetches your project lists server-side and caches the result for one hour.
Post something new on ArtStation or Behance → within an hour it is on your site,
with its images, title and a small link back to the original post.

To force an immediate refresh, redeploy from the Vercel dashboard.

## Editing text

Open `index.html` and search for:

- `CONTACT_EMAIL` — the "Get in touch" address.
- `label` / `blurb` — the two section names and their one-line descriptions.
- The `<h1>` and `.caption` in the hero.

## If a section comes up empty

ArtStation is stable. Behance has no public API any more, so `api/feed.js` reads the
project data embedded in your profile page. If Behance changes that page structure,
the design section can go empty — the fix is a small update to the parsing in
`behanceState()` and the `deepFind()` call under `behance()`.
