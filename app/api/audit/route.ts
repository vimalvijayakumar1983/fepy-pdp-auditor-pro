import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { buildAuditFromExtracted } from "@/lib/audit";

type Extracted = {
  url: string;
  title?: string;
  about?: string;
  bullets?: string[];
  specs?: Record<string, string>;
  images?: string[];
  price?: string | null;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36 FEPY-PDP-Auditor/1.0";
const SERP_API = "https://serpapi.com/search.json";

function norm(s?: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** ------------------ PDP extraction ------------------ */
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en;q=0.9" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// FEPY specific
function extractFepy($: cheerio.CheerioAPI): Partial<Extracted> {
  const title = norm($(".product-name h1").first().text()) || norm($("h1").first().text());

  const about =
    norm($(".product.attribute.description .value").first().text()) ||
    norm($(".product.attribute.description").first().text());

  const bullets: string[] = [];
  const overviewHtml = $(".product.attribute.overview .value").first().html() || "";
  if (overviewHtml) {
    overviewHtml
      .split(/<br\s*\/?>|•|\n/gi)
      .map((s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      .forEach((t) => {
        if (t && !/^\d+(\.|-)?$/.test(t) && t.length > 3) bullets.push(t);
      });
  }
  $(".product.attribute.overview li, .product.attribute.overview .value li").each((_, li) => {
    const t = $(li).text().replace(/\s+/g, " ").trim();
    if (t && !/^\d+(\.|-)?$/.test(t) && t.length > 3) bullets.push(t);
  });

  const specs: Record<string, string> = {};
  $(".product-info-main .product.attribute").each((_, el) => {
    const k = norm($(el).find(".type").first().text()).replace(/:$/, "");
    const v = norm($(el).find(".value").first().text());
    if (k && v && !specs[k]) specs[k] = v;
  });
  $(".additional-attributes-wrapper table tr").each((_, tr) => {
    const k = norm($(tr).find("th, .col.label").first().text());
    const v = norm($(tr).find("td, .col.data").first().text());
    if (k && v && !specs[k]) specs[k] = v;
  });

  const images: string[] = [];
  $(".fotorama__stage__frame img, .gallery-placeholder img").each((_, img) => {
    const src = $(img).attr("src") || $(img).attr("data-src");
    const s = norm(src);
    if (s && /^https?:\/\//i.test(s)) images.push(s);
  });

  const price =
    norm($(".price-wrapper .price").first().text()) ||
    norm($(".product-info-main .price").first().text()) ||
    null;

  return { title, about, bullets, specs, images, price };
}

// Generic fallback
function extractGeneric($: cheerio.CheerioAPI): Partial<Extracted> {
  const h1 = norm($("h1").first().text());
  const ogTitle = norm($('meta[property="og:title"]').attr("content"));
  const docTitle = norm($("title").first().text());
  const title = h1 || ogTitle || docTitle || "";

  const candidates = [
    $("#description").text(),
    $(".product-description").text(),
    $(".about, .about-this-item").text(),
    $('meta[name="description"]').attr("content"),
  ]
    .filter(Boolean)
    .map((s) => norm(String(s)));
  const about = candidates.find((s) => s.length > 60) || candidates[0] || "";

  const bullets: string[] = [];
  const bulletRoots = [
    $(".features, .key-features, .highlights, .about-this-item"),
    $("#features"),
    $("ul:has(li)"),
  ];
  for (const root of bulletRoots) {
    root.find("li").each((_, li) => {
      const t = norm($(li).text());
      if (t && !bullets.includes(t)) bullets.push(t);
    });
    if (bullets.length >= 3) break;
  }

  const specs: Record<string, string> = {};
  $("table:has(tr)").each((_, tbl) => {
    $(tbl)
      .find("tr")
      .each((__, tr) => {
        const k = norm($(tr).find("th,td").eq(0).text());
        const v = norm($(tr).find("th,td").eq(1).text());
        if (k && v && !specs[k]) specs[k] = v;
      });
  });
  $("dl").each((_, dl) => {
    $(dl)
      .find("dt")
      .each((i, dt) => {
        const dd = $(dt).next("dd");
        const k = norm($(dt).text());
        const v = norm(dd.text());
        if (k && v && !specs[k]) specs[k] = v;
      });
  });

  const images = new Set<string>();
  const addImg = (src?: string) => {
    const s = norm(src);
    if (s && /^https?:\/\//i.test(s)) images.add(s);
  };
  addImg($('meta[property="og:image"]').attr("content"));
  $("img").each((_, img) => addImg($(img).attr("src") || $(img).attr("data-src")));

  const bodyText = norm($("body").text());
  const priceMatch =
    bodyText.match(/\b(AED|USD|\$|SAR|QAR|OMR|KWD|BHD|EGP)\s?[\d.,]+\b/i) ||
    bodyText.match(/\b[\d.,]+\s?(AED|USD|SAR|QAR|OMR|KWD|BHD|EGP)\b/i);
  const price = priceMatch ? priceMatch[0] : null;

  return {
    title,
    about,
    bullets,
    specs,
    images: Array.from(images).slice(0, 12),
    price,
  };
}

function extract(url: string, $: cheerio.CheerioAPI): Extracted {
  const host = new URL(url).hostname;
  const isFepy = /(^|\.)fepy\.com$/i.test(host);
  const site = (isFepy ? extractFepy($) : extractGeneric($)) as Extracted;

  // Blend with generic if FEPY missed anything
  if (isFepy) {
    const g = extractGeneric($);
    site.title ||= g.title;
    site.about ||= g.about;
    if (!site.bullets?.length) site.bullets = g.bullets;
    if (!Object.keys(site.specs || {}).length) site.specs = g.specs;
    if (!site.images?.length) site.images = g.images as string[];
    site.price ||= g.price || null;
  }

  site.url = url;
  return site;
}

/** ---------------- SerpAPI + external verify ---------------- */
type SerpItem = { title?: string; link?: string; snippet?: string; };

function buildQuery(pdp: Extracted) {
  // Try to assemble a precise query using brand + model from title/specs
  const t = norm(pdp.title);
  const brand = (pdp.specs?.["Brand"] || t.split(" ")[0] || "").trim();
  // pull an alnum model-like token
  const modelMatch = t.match(/\b[A-Z0-9-]{3,}\b/);
  const model = modelMatch ? modelMatch[0] : "";
  const extra = (pdp.specs?.["Model"] || "").trim();

  const parts = [brand, model || extra].filter(Boolean);
  return parts.length ? parts.join(" ") : t || pdp.url;
}

async function serpSearch(query: string) {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY missing");
  const url = `${SERP_API}?engine=google&q=${encodeURIComponent(query)}&num=5&hl=en&api_key=${key}`;
  const r = await fetch(url, { headers: { "user-agent": UA }, cache: "no-store" });
  if (!r.ok) throw new Error(`SerpAPI HTTP ${r.status}`);
  const j: any = await r.json();
  const items: SerpItem[] = (j.organic_results || []).map((x: any) => ({ title: x.title, link: x.link, snippet: x.snippet }));
  // Prefer brand sites and big marketplaces
  const prefer = ["jotun", "bosch", "makita", "philips", "dewalt", "fepy", "amazon", "noon", "aceuae", "carrefour", "lulu"].join("|");
  items.sort((a, b) => {
    const sa = a.link && new RegExp(prefer, "i").test(a.link) ? 0 : 1;
    const sb = b.link && new RegExp(prefer, "i").test(b.link) ? 0 : 1;
    return sa - sb;
  });
  return items.slice(0, 3).filter((x) => x.link);
}

async function fetchAndExtractExternal(link: string): Promise<Extracted> {
  const html = await fetchHtml(link);
  const $ = cheerio.load(html);
  const g = extractGeneric($); // generic works for most external pages
  return { url: link, ...g } as Extracted;
}

// very simple token similarity (0..1)
function sim(a: string, b: string) {
  const A = new Set(norm(a).toLowerCase().split(/\W+/).filter(Boolean));
  const B = new Set(norm(b).toLowerCase().split(/\W+/).filter(Boolean));
  if (!A.size && !B.size) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return inter / union;
}

function pickBestMatch(pdp: Extracted, cands: Extracted[]) {
  // Rank by title similarity + presence of model token
  const model = (pdp.title || "").match(/\b[A-Z0-9-]{3,}\b/)?.[0] || "";
  let best: { item: Extracted; score: number } | null = null;
  for (const it of cands) {
    const titleScore = sim(pdp.title || "", it.title || "");
    const modelBonus = model && (it.title || "").includes(model) ? 0.15 : 0;
    const score = titleScore + modelBonus;
    if (!best || score > best.score) best = { item: it, score };
  }
  return best?.item || cands[0];
}

function mergeCorrections(pdp: Extracted, ref: Extracted) {
  // Only overwrite when reference is clearly better
  const corrected: Extracted = { ...pdp };

  if (ref.title && sim(pdp.title || "", ref.title) < 0.6 && ref.title.length >= 40) {
    corrected.title = ref.title;
  }
  if (ref.about && (ref.about.length > (pdp.about || "").length + 30)) {
    corrected.about = ref.about;
  }
  const refBullets = (ref.bullets || []).filter((b) => b.length > 5);
  if ((pdp.bullets || []).length < 3 && refBullets.length >= 3) {
    corrected.bullets = refBullets.slice(0, 7);
  }
  // merge some specs keys if pdp missing them
  corrected.specs = { ...(pdp.specs || {}) };
  for (const [k, v] of Object.entries(ref.specs || {})) {
    const key = k.trim();
    if (!corrected.specs![key] && v && v.length >= 2) corrected.specs![key] = v;
  }
  if ((pdp.images || []).length < 3 && (ref.images || []).length >= 3) {
    corrected.images = ref.images?.slice(0, 6);
  }
  if (!pdp.price && ref.price) corrected.price = ref.price;

  return corrected;
}
/** ------------------------------------------------------ */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const urls: string[] = Array.isArray(body?.urls) ? body.urls : [];

  const rows = await Promise.all(
    urls.map(async (url) => {
      try {
        // 1) extract PDP
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);
        const pdp = extract(url, $);

        // 2) search & fetch references (best 1)
        let corrected = { ...pdp };
        try {
          const query = buildQuery(pdp);
          const serp = await serpSearch(query);
          const refs: Extracted[] = [];
          for (const item of serp) {
            if (!item.link) continue;
            try {
              const ext = await fetchAndExtractExternal(item.link);
              refs.push(ext);
            } catch { /* ignore */ }
          }
          if (refs.length) {
            const best = pickBestMatch(pdp, refs);
            corrected = mergeCorrections(pdp, best);
          }
        } catch (e) {
          // ignore external failure; we still return PDP-only audit
        }

        // 3) build audit using corrected suggestions
        // We pass "corrected" through buildAudit to compute checks.
        // And we fill "suggested" fields by comparing pdp vs corrected in-place below.
        const auditBase = buildAuditFromExtracted(pdp);
        const suggestedAudit = buildAuditFromExtracted(corrected);

        // Map suggested fields from corrected where our PDP failed
        const result = {
          passed: auditBase.passed,
          score: auditBase.score,
          title: {
            ok: auditBase.title.ok,
            current: auditBase.title.current,
            suggested: auditBase.title.ok ? auditBase.title.current : suggestedAudit.title.current,
            reason: auditBase.title.reason,
          },
          about: {
            ok: auditBase.about.ok,
            current: auditBase.about.current,
            suggested: auditBase.about.ok ? auditBase.about.current : suggestedAudit.about.current,
            reason: auditBase.about.reason,
          },
          bullets: {
            ok: auditBase.bullets.ok,
            current: auditBase.bullets.current,
            suggested: auditBase.bullets.ok ? auditBase.bullets.current : suggestedAudit.bullets.current,
            reason: auditBase.bullets.reason,
          },
          specs: {
            ok: auditBase.specs.ok,
            current: auditBase.specs.current,
            suggested: auditBase.specs.ok ? auditBase.specs.current : suggestedAudit.specs.current,
            reason: auditBase.specs.reason,
          },
          images: {
            ok: auditBase.images.ok,
            currentCount: auditBase.images.currentCount,
            suggested: auditBase.images.ok ? auditBase.images.suggested : suggestedAudit.images.suggested,
            reason: auditBase.images.reason,
          },
          price: {
            ok: auditBase.price.ok,
            current: auditBase.price.current,
            suggested: auditBase.price.ok ? auditBase.price.current : suggestedAudit.price.current,
            reason: auditBase.price.reason,
          },
        };

        return { url, audit: result };
      } catch (err: any) {
        return {
          url,
          audit: {
            passed: false,
            score: 0,
            error: `Fetch/parse failed: ${err?.message || err}`,
            title: { ok: false, current: "", suggested: "", reason: "Page fetch/parse failed." },
            about: { ok: false, current: "", suggested: "", reason: "Page fetch/parse failed." },
            bullets: { ok: false, current: [], suggested: [], reason: "Page fetch/parse failed." },
            specs: { ok: false, current: {}, suggested: {}, reason: "Page fetch/parse failed." },
            images: { ok: false, currentCount: 0, suggested: [], reason: "Page fetch/parse failed." },
            price: { ok: false, current: null, suggested: null, reason: "Page fetch/parse failed." },
          },
        };
      }
    })
  );

  return NextResponse.json({ rows });
}
