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

function norm(s?: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      // Friendly UA tends to get fuller HTML
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36 FEPY-PDP-Auditor/1.0",
      "accept-language": "en;q=0.9",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/** --------- SITE-SPECIFIC: FEPY.COM ---------- */
function extractFepy($: cheerio.CheerioAPI): Extracted {
  const title =
    norm($(".product-name h1").first().text()) ||
    norm($("h1").first().text());

  // Long description
  const about =
    norm($(".product.attribute.description .value").first().text()) ||
    norm($(".product.attribute.description").first().text());

  // Feature bullets (overview)
  const bullets: string[] = [];
  $(".product.attribute.overview li, .product.attribute.overview .value li").each((_, li) => {
    const t = norm($(li).text());
    if (t) bullets.push(t);
  });

  // Attribute blocks (label: .type, value: .value)
  const specs: Record<string, string> = {};
  $(".product-info-main .product.attribute").each((_, el) => {
    const label = norm($(el).find(".type").first().text()).replace(/:$/, "");
    const value = norm($(el).find(".value").first().text());
    if (label && value && !specs[label]) specs[label] = value;
  });

  // Image URLs (gallery)
  const images: string[] = [];
  $(".fotorama__stage__frame img, .gallery-placeholder img").each((_, img) => {
    const src = $(img).attr("src") || $(img).attr("data-src");
    const s = norm(src);
    if (s && /^https?:\/\//i.test(s)) images.push(s);
  });

  // Price
  const price =
    norm($(".price-wrapper .price").first().text()) ||
    norm($(".product-info-main .price").first().text()) ||
    null;

  return { url: "", title, about, bullets, specs, images, price };
}
/** -------------------------------------------- */

/** --------- GENERIC FALLBACK EXTRACTOR -------- */
function extractGeneric($: cheerio.CheerioAPI): Extracted {
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
    url: "",
    title,
    about,
    bullets,
    specs,
    images: Array.from(images).slice(0, 12),
    price,
  };
}
/** -------------------------------------------- */

function extract(url: string, $: cheerio.CheerioAPI): Extracted {
  const isFepy = /(^|\.)fepy\.com$/i.test(new URL(url).hostname);
  const site = isFepy ? extractFepy($) : extractGeneric($);

  // Ensure url is set
  site.url = url;

  // If FEPY branch produced very little, blend with generic as fallback
  if (isFepy) {
    const generic = extractGeneric($);
    site.title ||= generic.title;
    site.about ||= generic.about;
    if (!site.bullets?.length) site.bullets = generic.bullets;
    if (!Object.keys(site.specs || {}).length) site.specs = generic.specs;
    if (!site.images?.length) site.images = generic.images;
    site.price ||= generic.price;
  }

  return site;
}

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
