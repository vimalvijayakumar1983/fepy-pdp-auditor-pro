// app/api/audit/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import he from "he"; // for decoding HTML entities like &lt; &quot; etc.
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

/* -------------------- helpers -------------------- */

function norm(s?: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function stripTags(html?: string) {
  return norm((html || "").replace(/<[^>]*>/g, ""));
}

function decodeHtml(html?: string) {
  return norm(he.decode(html || ""));
}

function toCleanTextFromHtml(html?: string) {
  return norm(he.decode(stripTags(html)));
}

function pushClean(target: string[], value?: string) {
  const v = norm(value);
  if (!v) return;
  // ignore numeric artifacts like "1", "2", "3." etc.
  if (/^\d+([.)-])?$/.test(v)) return;
  if (!target.includes(v)) target.push(v);
}

function parseJsonLd($: cheerio.CheerioAPI) {
  const out: {
    title?: string; description?: string;
    bullets?: string[]; specs?: Record<string,string>;
    price?: string | null; images?: string[];
  } = { specs: {}, bullets: [], images: [], price: null };

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const j = JSON.parse(raw);
      const items = Array.isArray(j) ? j : [j];
      for (const item of items) {
        if (!item) continue;
        const type = Array.isArray(item["@type"]) ? item["@type"].join(",") : item["@type"];
        if (!type || !/Product/i.test(type)) continue;

        if (item.name) out.title = out.title || norm(item.name);
        if (item.description) out.description = out.description || norm(item.description);

        if (item.brand) {
          const b = typeof item.brand === "string" ? item.brand : item.brand?.name;
          if (b) out.specs!["Brand"] = norm(b);
        }
        if (item.sku) out.specs!["SKU"] = norm(item.sku);
        if (item.mpn) out.specs!["Model"] = norm(item.mpn);
        if (item.gtin13) out.specs!["GTIN-13"] = norm(item.gtin13);
        if (item.gtin14) out.specs!["GTIN-14"] = norm(item.gtin14);
        if (item.gtin8) out.specs!["GTIN-8"] = norm(item.gtin8);

        if (item.offers) {
          const o = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          const p = o?.priceCurrency && o?.price ? `${o.priceCurrency} ${o.price}` : (o?.price || "");
          if (p) out.price = out.price || norm(p);
        }

        if (Array.isArray(item.image)) {
          for (const img of item.image) {
            if (typeof img === "string" && /^https?:\/\//i.test(img)) out.images!.push(img);
          }
        } else if (typeof item.image === "string" && /^https?:\/\//i.test(item.image)) {
          out.images!.push(item.image);
        }

        // sometimes bullets are embedded in description separated by • or newlines
        if (item.description && /[\n•]/.test(item.description)) {
          const parts = String(item.description).split(/\n|•/g);
          for (const p of parts) pushClean(out.bullets!, p);
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  });

  out.images = Array.from(new Set(out.images || []));
  return out;
}

/* ---------------- FEPY-specific extractor ---------------- */

function extractFepy($: cheerio.CheerioAPI): Partial<Extracted> {
  // Title
  const title =
    norm($(".product-name h1").first().text()) ||
    norm($(".page-title-wrapper .page-title span").first().text()) ||
    norm($("h1").first().text());

  // About / long description – prefer rich .value, decode & strip tags
  let aboutHtml =
    $(".product.attribute.description .value").first().html() ||
    $("#description .value, #description").first().html() || "";
  const about = toCleanTextFromHtml(aboutHtml);

  // Bullets
  const bullets: string[] = [];

  // 1) <li> items
  $(".product.attribute.overview .value li, .product.attribute.overview li").each((_, li) => {
    pushClean(bullets, $(li).text());
  });

  // 2) <br>-separated lines (decode entities, strip tags)
  const overviewHtml = $(".product.attribute.overview .value").first().html() || "";
  if (overviewHtml) {
    overviewHtml
      .split(/<br\s*\/?>|•|\n/gi)
      .map(s => toCleanTextFromHtml(s))
      .forEach(t => pushClean(bullets, t));
  }

  // 3) Fallback key-features sections
  $(".key-features li, .highlights li").each((_, li) => pushClean(bullets, $(li).text()));

  // Specs: attribute blocks + "Additional Information" + generic tables
  const specs: Record<string, string> = {};
  $(".product-info-main .product.attribute").each((_, el) => {
    const k = norm($(el).find(".type").first().text()).replace(/:$/, "");
    const v = norm($(el).find(".value").first().text());
    if (k && v && !specs[k]) specs[k] = v;
  });
  $(".additional-attributes-wrapper table tr, table.data.table.additional-attributes tr").each((_, tr) => {
    const k = norm($(tr).find("th, .col.label").first().text());
    const v = norm($(tr).find("td, .col.data").first().text());
    if (k && v && !specs[k]) specs[k] = v;
  });
  $("table:has(tr)").each((_, tbl) => {
    $(tbl).find("tr").each((__, tr) => {
      const k = norm($(tr).find("th,td").eq(0).text());
      const v = norm($(tr).find("th,td").eq(1).text());
      if (k && v && !specs[k]) specs[k] = v;
    });
  });

  // Images
  const images: string[] = [];
  $(".fotorama__stage__frame img, .gallery-placeholder img, .product.media img").each((_, img) => {
    const src = $(img).attr("src") || $(img).attr("data-src");
    const s = norm(src);
    if (s && /^https?:\/\//i.test(s)) images.push(s);
  });

  // Price
  const price =
    norm($(".price-wrapper .price").first().text()) ||
    norm($(".product-info-main .price").first().text()) ||
    null;

  // JSON-LD merge/fallback
  const ld = parseJsonLd($);
  const mergedSpecs = { ...ld.specs, ...specs };
  const mergedImages = Array.from(new Set([...(images || []), ...(ld.images || [])]));
  const mergedBullets = [...bullets];
  if (mergedBullets.length < 3 && ld.description) {
    ld.description.split(/\n|•/g).forEach(p => pushClean(mergedBullets, p));
  }

  return {
    title: title || ld.title,
    about: about || ld.description,
    bullets: mergedBullets,
    specs: mergedSpecs,
    images: mergedImages,
    price: price || ld.price || null,
  };
}

/* --------------- generic extractor (fallback) --------------- */

function extractGeneric($: cheerio.CheerioAPI): Partial<Extracted> {
  const h1 = norm($("h1").first().text());
  const ogTitle = norm($('meta[property="og:title"]').attr("content"));
  const docTitle = norm($("title").first().text());
  const title = h1 || ogTitle || docTitle || "";

  // About
  const aboutCandidates = [
    $("#description").html(),
    $(".product-description").html(),
    $(".about, .about-this-item").html(),
    $('meta[name="description"]').attr("content"),
  ];
  const about = toCleanTextFromHtml(
    aboutCandidates.find((x) => (x || "").length > 0) as string | undefined
  );

  // Bullets
  const bullets: string[] = [];
  const bulletRoots = [
    $(".features, .key-features, .highlights, .about-this-item"),
    $("#features"),
    $("ul:has(li)"),
  ];
  for (const root of bulletRoots) {
    root.find("li").each((_, li) => {
      pushClean(bullets, $(li).text());
    });
    if (bullets.length >= 3) break;
  }
  // try <br>-separated paragraphs as last resort
  if (bullets.length < 3) {
    const anyHtml = ($(".about, .about-this-item, #description").first().html() || "");
    anyHtml.split(/<br\s*\/?>|•|\n/gi).forEach(chunk => pushClean(bullets, toCleanTextFromHtml(chunk)));
  }

  // Specs
  const specs: Record<string, string> = {};
  $("table:has(tr)").each((_, tbl) => {
    $(tbl).find("tr").each((__, tr) => {
      const k = norm($(tr).find("th,td").eq(0).text());
      const v = norm($(tr).find("th,td").eq(1).text());
      if (k && v && !specs[k]) specs[k] = v;
    });
  });
  $("dl").each((_, dl) => {
    $(dl).find("dt").each((i, dt) => {
      const dd = $(dt).next("dd");
      const k = norm($(dt).text());
      const v = norm(dd.text());
      if (k && v && !specs[k]) specs[k] = v;
    });
  });

  // Images
  const images = new Set<string>();
  const addImg = (src?: string) => {
    const s = norm(src);
    if (s && /^https?:\/\//i.test(s)) images.add(s);
  };
  addImg($('meta[property="og:image"]').attr("content"));
  $("img").each((_, img) => addImg($(img).attr("src") || $(img).attr("data-src")));

  // Price (rough)
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

/* ---------------- selector chooser ---------------- */

function extract(url: string, $: cheerio.CheerioAPI): Extracted {
  const isFepy = /(^|\.)fepy\.com$/i.test(new URL(url).hostname);
  const site = (isFepy ? extractFepy($) : extractGeneric($)) as Extracted;
  site.url = url;
  return site;
}

/* ---------------- basic fetch ---------------- */

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html,application/xhtml+xml", "accept-language": "en;q=0.9" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/* ---------------- POST /api/audit ---------------- */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const urls: string[] = Array.isArray(body?.urls) ? body.urls : [];

  const rows = await Promise.all(
    urls.map(async (url) => {
      try {
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);
        const extracted = extract(url, $);
        return { url, audit: buildAuditFromExtracted(extracted) };
      } catch (err: any) {
        return {
          url,
          audit: {
            passed: false,
            score: 0,
            error: `Fetch/parse failed: ${err?.message || err}`,
            title: { ok: false, current: "", suggested: "", reason: "Fetch/parse failed" },
            about: { ok: false, current: "", suggested: "", reason: "Fetch/parse failed" },
            bullets: { ok: false, current: [], suggested: [], reason: "Fetch/parse failed" },
            specs: { ok: false, current: {}, suggested: {}, reason: "Fetch/parse failed" },
            images: { ok: false, currentCount: 0, suggested: [], reason: "Fetch/parse failed" },
            price: { ok: false, current: null, suggested: null, reason: "Fetch/parse failed" },
          },
        };
      }
    })
  );

  return NextResponse.json({ rows });
}
