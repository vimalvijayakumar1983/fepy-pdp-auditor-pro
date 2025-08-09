import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { buildAuditFromExtracted } from "@/lib/audit";

type Extracted = {
  url: string;
  title?: string;
  about?: string;
  bullets?: string[];
  specs?: Record<string,string>;
  images?: string[];
  price?: string | null;
};

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    // A friendly UA helps some sites return full HTML
    headers: { "user-agent": "Mozilla/5.0 (compatible; FEPY-PDP-Auditor/1.0)" },
    // Don’t follow infinite redirects
    redirect: "follow",
    // 15s timeout
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function extract($: cheerio.CheerioAPI, url: string): Extracted {
  // Title (prefer PDP H1, then og:title, then <title>)
  const h1 = $("h1").first().text().trim();
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const docTitle = $("title").first().text().trim();
  const title = h1 || ogTitle || docTitle || "";

  // About/description
  const candidates = [
    $("#description").text(),
    $(".product-description").text(),
    $(".about, .about-this-item").text(),
    $('meta[name="description"]').attr("content"),
  ]
    .filter(Boolean)
    .map((s) => s!.toString().trim());
  const about = (candidates.find((s) => s.length > 60) || candidates[0] || "").trim();

  // Bullets: take lis from common sections
  const bulletRoots = [
    $(".features, .key-features, .highlights, .about-this-item"),
    $("#features"),
    $("ul:has(li)"),
  ];
  const bullets: string[] = [];
  for (const root of bulletRoots) {
    root.find("li").each((_, li) => {
      const t = $(li).text().replace(/\s+/g, " ").trim();
      if (t && !bullets.includes(t)) bullets.push(t);
    });
    if (bullets.length >= 3) break;
  }

  // Specs: table rows (th/td) or dt/dd pairs
  const specs: Record<string, string> = {};
  $("table:has(tr)").each((_, tbl) => {
    $(tbl)
      .find("tr")
      .each((__, tr) => {
        const k = $(tr).find("th,td").eq(0).text().replace(/\s+/g, " ").trim();
        const v = $(tr).find("th,td").eq(1).text().replace(/\s+/g, " ").trim();
        if (k && v && !specs[k]) specs[k] = v;
      });
  });
  $("dl").each((_, dl) => {
    $(dl)
      .find("dt")
      .each((i, dt) => {
        const dd = $(dt).next("dd");
        const k = $(dt).text().replace(/\s+/g, " ").trim();
        const v = dd.text().replace(/\s+/g, " ").trim();
        if (k && v && !specs[k]) specs[k] = v;
      });
  });

  // Images: og:image + <img> srcs (absolute only)
  const images = new Set<string>();
  const addImg = (src?: string) => {
    if (!src) return;
    const s = src.trim();
    if (/^https?:\/\//i.test(s)) images.add(s);
  };
  addImg($('meta[property="og:image"]').attr("content"));
  $("img").each((_, img) => addImg($(img).attr("src")));

  // Price: search for currency + amount (AED, $, SAR, QAR, EGP, etc.)
  const bodyText = $("body").text().replace(/\s+/g, " ");
  const priceMatch =
    bodyText.match(/\b(AED|USD|\$|SAR|QAR|OMR|KWD|BHD|EGP)\s?[\d.,]+\b/i) ||
    bodyText.match(/\b[\d.,]+\s?(AED|USD|SAR|QAR|OMR|KWD|BHD|EGP)\b/i);
  const price = priceMatch ? priceMatch[0] : null;

  return {
    url,
    title,
    about,
    bullets,
    specs,
    images: Array.from(images).slice(0, 12),
    price,
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const urls: string[] = Array.isArray(body?.urls) ? body.urls : [];

  const rows = await Promise.all(
    urls.map(async (url) => {
      try {
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);
        const extracted = extract($, url);
        return { url, audit: buildAuditFromExtracted(extracted) };
      } catch (err: any) {
        // Return a failed audit row with error info
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
