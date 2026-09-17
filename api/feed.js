// HOGGEX — feed API
// Pulls your latest projects from ArtStation and Behance, server-side,
// and returns clean JSON for the site. Cached for 1 hour at the edge,
// so a new upload shows up on the site within the hour by itself.
//
// Vercel serverless function (Node 18+). Deploy the folder, nothing to configure.

const ARTSTATION_USER = process.env.ARTSTATION_USER || "hoggex";
const BEHANCE_USER    = process.env.BEHANCE_USER    || "youniszone";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_PROJECTS = 30;

/* ---------------- helpers ---------------- */

async function get(url, json = false) {
  const r = await fetch(url, {
    headers: {
      "user-agent": UA,
      "accept": json ? "application/json" : "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return json ? r.json() : r.text();
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const n = i++;
        try { out[n] = await fn(items[n]); } catch { out[n] = null; }
      }
    })
  );
  return out.filter(Boolean);
}

/* ---------------- ArtStation ----------------
   ArtStation puts its JSON endpoints behind Cloudflare bot protection that
   blocks requests from servers (not just this one — every automated tool
   hits the same 403, this is a platform-wide restriction, not a bug in
   this code). There's no reliable server-side workaround for that, so
   Art posts are listed by hand below until ArtStation opens this up.
   Add a new entry any time you post new work — takes a few seconds. */

const ARTSTATION_MANUAL = [
  {
    id: "manual-1",
    title: "Character design",
    year: "",
    tags: "",
    desc: "",
    link: "https://www.artstation.com/hoggex",
    images: [],
  },
];

async function artstation() {
  try {
    const list = await get(
      `https://www.artstation.com/users/${ARTSTATION_USER}/projects.json?page=1`,
      true
    );
    const projects = (list.data || []).slice(0, MAX_PROJECTS);
    if (!projects.length) throw new Error("empty");

    return mapLimit(projects, 5, async (p) => {
      let images = [];
      let desc = "";
      try {
        const d = await get(`https://www.artstation.com/projects/${p.hash_id}.json`, true);
        desc = (d.description_html || d.description || "").replace(/<[^>]+>/g, "").trim();
        images = (d.assets || [])
          .filter((a) => a.has_image && a.image_url)
          .map((a) => a.image_url);
      } catch {}
      if (!images.length && p.cover) images = [p.cover.thumb_url || p.cover.small_square_url].filter(Boolean);

      return {
        id: p.hash_id || String(p.id),
        title: p.title || "Untitled",
        year: (p.published_at || p.created_at || "").slice(0, 4),
        tags: (p.categories || []).map((c) => c.name).join(" / "),
        desc,
        link: p.permalink || `https://www.artstation.com/${ARTSTATION_USER}`,
        images,
      };
    });
  } catch {
    // Blocked — fall back to the manual list so the section isn't empty.
    return ARTSTATION_MANUAL;
  }
}

/* ---------------- Behance ----------------
   Behance's project-detail pages return bot-detection errors even from a
   plain server-side fetch, so this only makes ONE request (the profile
   page) and reads titles / covers / links straight out of its HTML. That
   HTML is not treated as trusted markup — everything pulled from it is
   plain text and URLs, nothing is executed or rendered as-is. */

function scrapeBehanceProfile(html) {
  const posts = [];
  const seen = new Set();
  const linkRe = /href="(https:\/\/www\.behance\.net\/gallery\/(\d+)\/([^"?]+))"[^>]*title="Link to project - ([^"]+)"/g;
  let m;
  while ((m = linkRe.exec(html))) {
    const [, link, id, slug, titleRaw] = m;
    if (seen.has(id)) continue;
    seen.add(id);

    // nearest preceding cover image
    const windowStart = Math.max(0, m.index - 2000);
    const chunk = html.slice(windowStart, m.index);
    const imgs = [...chunk.matchAll(/<img[^>]+src="(https:\/\/mir-s3-cdn-cf\.behance\.net\/[^"]+)"/g)];
    const cover = imgs.length ? imgs[imgs.length - 1][1] : null;

    posts.push({
      id,
      title: decodeHtmlEntities(titleRaw),
      year: "",
      tags: "",
      desc: "",
      link,
      images: cover ? [cover] : [],
    });
  }
  return posts;
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function behance() {
  const html = await get(`https://www.behance.net/${BEHANCE_USER}`);
  return scrapeBehanceProfile(html).slice(0, MAX_PROJECTS);
}

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

  const [art, design] = await Promise.allSettled([artstation(), behance()]);

  res.status(200).json({
    updated: new Date().toISOString(),
    art: {
      posts: art.status === "fulfilled" ? art.value : [],
      error: art.status === "rejected" ? String(art.reason) : null,
    },
    design: {
      posts: design.status === "fulfilled" ? design.value : [],
      error: design.status === "rejected" ? String(design.reason) : null,
    },
  });
}
