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

// Walk any JSON blob and collect the first values matching a predicate.
function deepFind(node, test, found = [], seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return found;
  seen.add(node);
  if (test(node)) found.push(node);
  for (const v of Object.values(node)) deepFind(v, test, found, seen);
  return found;
}

function bestCover(covers) {
  if (!covers) return null;
  const order = ["original", "808", "404", "230", "202", "115", "max_808", "small"];
  for (const k of order) if (covers[k]) return typeof covers[k] === "string" ? covers[k] : covers[k].url;
  const first = Object.values(covers)[0];
  return typeof first === "string" ? first : first?.url || null;
}

/* ---------------- ArtStation ---------------- */

async function artstation() {
  const list = await get(
    `https://www.artstation.com/users/${ARTSTATION_USER}/projects.json?page=1`,
    true
  );
  const projects = (list.data || []).slice(0, MAX_PROJECTS);

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
}

/* ---------------- Behance ---------------- */

function behanceState(html) {
  // Behance embeds its page data in a script tag; shape changes over time,
  // so try the known ids first, then any large JSON blob.
  const patterns = [
    /<script[^>]*id="beconfig-store_state"[^>]*>([\s\S]*?)<\/script>/,
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) { try { return JSON.parse(m[1]); } catch {} }
  }
  return null;
}

async function behance() {
  const html = await get(`https://www.behance.net/${BEHANCE_USER}`);
  const state = behanceState(html);
  if (!state) return [];

  // A project object on Behance has a name/slug and a covers map.
  const raw = deepFind(state, (o) =>
    o && typeof o.name === "string" && o.covers && (o.url || o.slug || o.id)
  ).slice(0, MAX_PROJECTS);

  const seen = new Set();
  const unique = raw.filter((p) => {
    const k = String(p.id || p.url || p.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return mapLimit(unique, 4, async (p) => {
    const link = p.url || `https://www.behance.net/gallery/${p.id}/${p.slug || ""}`;
    let images = [bestCover(p.covers)].filter(Boolean);
    let desc = p.description || "";

    try {
      const ph = await get(link);
      const ps = behanceState(ph);
      if (ps) {
        const modules = deepFind(ps, (o) => o && (o.imageSizes || o.sizes) && (o.type === "image" || o.src || o.imageSizes));
        const urls = modules
          .map((m) => {
            const s = m.imageSizes || m.sizes || {};
            return s.original?.url || s.max_1920?.url || s.disp?.url || s.original || s.max_1920 || m.src || null;
          })
          .filter((u) => typeof u === "string");
        if (urls.length) images = [...new Set(urls)];
      }
      if (!desc) {
        const og = ph.match(/<meta property="og:description" content="([^"]*)"/);
        if (og) desc = og[1];
      }
    } catch {}

    return {
      id: String(p.id || p.slug || p.name).replace(/\W+/g, "-").toLowerCase(),
      title: p.name,
      year: p.published_on ? new Date(p.published_on * 1000).getFullYear().toString() : "",
      tags: (p.fields || []).map((f) => (typeof f === "string" ? f : f.name)).join(" / "),
      desc,
      link,
      images,
    };
  });
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
