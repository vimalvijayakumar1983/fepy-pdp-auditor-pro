"""Read-only FEPY PDP collection using Browser Use's direct browser controls."""
import asyncio
import base64
import io
import ipaddress
import json
import os
import re
import socket
import time
from pathlib import Path
from urllib.parse import unquote, urlparse
from PIL import Image

HOSTS = {"fepy.com", "www.fepy.com"}


def validate_url(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.query or parsed.fragment:
        raise ValueError("Use a public HTTPS FEPY product URL without query parameters or fragments.")
    parts = unquote(parsed.path).lower().split("/")
    if any(part in {"account", "customer", "checkout", "cart", "admin", "api", "graphql"} for part in parts):
        raise ValueError("Only public product pages may be audited.")
    if not parsed.path.strip("/"):
        raise ValueError("Use a product page, not the homepage.")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("Product URL must resolve to public internet addresses.")
    return url


EXTRACT = r'''() => {
 const clean = x => String(x || '').replace(/\s+/g, ' ').trim();
 const txt = selector => clean(document.querySelector(selector)?.innerText);
 const attr = (selector, key) => document.querySelector(selector)?.getAttribute(key) || '';
 const meta = name => attr(`meta[name="${name}"]`, 'content');
 const plain = x => { const el = document.createElement('div'); el.innerHTML = String(x || ''); return clean(el.textContent); };
 const nodes = [];
 function walk(x) { if (Array.isArray(x)) return x.forEach(walk); if (x && typeof x === 'object') { nodes.push(x); if (x['@graph']) walk(x['@graph']); } }
 let malformedSchema = 0;
 for (const script of document.querySelectorAll('script[type="application/ld+json"]')) { try { walk(JSON.parse(script.textContent)); } catch { malformedSchema++; } }
 const typed = (x, type) => (Array.isArray(x['@type']) ? x['@type'] : [x['@type']]).includes(type);
 const product = nodes.find(x => typed(x, 'Product'));
 const breadcrumbs = nodes.find(x => typed(x, 'BreadcrumbList'));
 const offer = product && (Array.isArray(product.offers) ? product.offers[0] : product.offers);
 const schemaImages = product ? (Array.isArray(product.image) ? product.image : [product.image]).map(x => typeof x === 'string' ? x : x?.url).filter(Boolean) : [];
 const gallery = [...document.querySelectorAll('[class*="gallery"] img, [class*="Gallery"] img, [class*="product-image"] img, [class*="productImage"] img, [class*="ProductImage"] img')];
 const primary = gallery.find(img => img.naturalWidth >= 150 && img.getBoundingClientRect().width > 80);
 const images = [...new Set([primary?.currentSrc, ...schemaImages, ...gallery.map(img => img.currentSrc)].filter(Boolean))].slice(0, 12);
 const image = schemaImages[0] || images[0] || '';
 const imageElement = [...document.images].find(img => img.currentSrc.split('?')[0] === image.split('?')[0] || img.src.split('?')[0] === image.split('?')[0]);
 const descriptionSelectors = ['[itemprop="description"]', '.product.description', '#description', '[class*="product-description"]', '[class*="productDescription"]', '[data-testid="product-description"]'];
 let description = [descriptionSelectors.map(txt).find(Boolean), txt('#features-benefits')].filter(Boolean).join(' ');
 if (!description && product?.description) description = plain(product.description);
 const specs = [];
 for (const item of document.querySelectorAll('#key-specifications div')) { const cells = [...item.children].filter(x => x.tagName === 'P').map(x=>clean(x.innerText)); if(cells.length === 2 && cells.every(Boolean)) specs.push(`${cells[0]}: ${cells[1]}`); }
 for (const tr of document.querySelectorAll('#product-attribute-specs-table tr, [class*="specification"] tr, [class*="Specification"] tr, [class*="product-attributes"] tr')) {
   const cells = [...tr.querySelectorAll('th,td')].map(x => clean(x.innerText));
   if (cells.length >= 2 && cells[0] && cells[1]) specs.push(`${cells[0]}: ${cells.slice(1).join(' ')}`);
 }
 if (!specs.length && product?.additionalProperty) for (const p of [].concat(product.additionalProperty)) if (p.name && p.value !== undefined) specs.push(`${clean(p.name)}: ${clean(p.value)}${p.unitText ? ' '+clean(p.unitText) : ''}`);
 const body = clean(document.body?.innerText).slice(0, 2000);
 const h1 = [...document.querySelectorAll('h1')].map(x => clean(x.innerText)).filter(Boolean);
 const availability = String(offer?.availability || attr('[itemprop="availability"]', 'href'));
 const brand = typeof product?.brand === 'string' ? product.brand : product?.brand?.name || '';
 const usableCategory = x => x && !/^(home|homepage|all products|products)$/i.test(x) && !h1.includes(x) && x !== clean(product?.name);
 const crumbLinks = [...document.querySelectorAll('[aria-label="breadcrumb"] a, [aria-label="Breadcrumb"] a, nav[class*="breadcrumb"] a, [class*="Breadcrumb"] a')].map(x=>clean(x.innerText)).filter(usableCategory);
 const schemaCrumbs = [...(breadcrumbs?.itemListElement || [])].sort((a,b)=>Number(a.position || 0)-Number(b.position || 0)).map(x=>clean(x.name || x.item?.name)).filter(usableCategory);
 const category = crumbLinks.at(-1) || (usableCategory(clean(product?.category)) ? clean(product.category) : '') || schemaCrumbs.at(-1) || '';
 const modelSpec = specs.find(x=>/^(model no\.?|model number|model):/i.test(x));
 const model = clean(product?.model || product?.mpn) || (modelSpec ? modelSpec.slice(modelSpec.indexOf(':')+1).trim() : '');
 let faq = [...document.querySelectorAll('#faq, #faqs, #frequently-asked-questions, [id*="faq"], [id*="FAQ"]')].map(x=>clean(x.innerText)).filter(Boolean).join(' ');
 if (!faq) { const fullText = clean(document.body?.innerText); const begin=fullText.indexOf('Frequently Asked Questions'); if(begin>=0) faq=fullText.slice(begin).split(/Ratings & Reviews|Customer Reviews|Related Products/)[0]; }
 faq = faq.slice(0,6000);
 return JSON.stringify({
  row: { sku: clean(product?.sku || product?.productID || txt('[itemprop="sku"]')), product_url: location.href, title_en: h1[0] || clean(product?.name), title_ar: document.documentElement.lang?.startsWith('ar') ? h1[0] : '', brand: clean(brand), model_number: model, category: clean(category), price_aed: clean(offer?.price || attr('[itemprop="price"]','content')), currency: clean(offer?.priceCurrency || attr('[itemprop="priceCurrency"]','content')), stock_status: availability.endsWith('InStock') ? 'in_stock' : availability.endsWith('OutOfStock') ? 'out_of_stock' : availability.endsWith('BackOrder') ? 'backorder' : '', description_en: description.slice(0,8000), image_url_1: image, image_alt_1: clean(imageElement?.alt), meta_title: document.title, meta_description: meta('description'), faq_text: faq, specs_inline: [...new Set(specs)].join(' | ').slice(0,8000) },
  title: document.title, canonical: attr('link[rel="canonical"]','href'), robots: meta('robots'), h1Count: h1.length, productSchema: !!product, pdpSections: !!document.querySelector('#features-benefits, #key-specifications'), malformedSchema, schemaModel: clean(product?.model || product?.mpn), schemaProductName: clean(product?.name), schemaSku: clean(product?.sku), schemaCurrency: clean(offer?.priceCurrency), schemaAvailability: availability, imageUrls: images, bodyPreview: body,
  sources: { title_en: 'rendered H1 / Product schema fallback', description_en: (txt('#features-benefits') || descriptionSelectors.some(selector => txt(selector))) ? 'rendered Features & Benefits / product description' : product?.description ? 'Product schema description' : 'not found', specs_inline: 'rendered Key Specifications / Product additionalProperty fallback', price_aed: 'Product Offer schema / itemprop', brand: 'Product schema', category: crumbLinks.length ? 'rendered breadcrumb links' : 'Product category / BreadcrumbList schema', model_number: clean(product?.model || product?.mpn) ? 'Product schema model / mpn' : modelSpec ? 'rendered Model No specification' : 'not found', faq_text: 'rendered FAQ section', image_url_1: 'product gallery / Product schema', meta_title: 'document title', meta_description: 'meta description' }
 });
}'''


def decode_result(value):
    # Actor serialises objects; extracting JSON explicitly avoids version-specific wrapping.
    if isinstance(value, dict):
        return value
    data = json.loads(value)
    if isinstance(data, str):
        data = json.loads(data)
    return data


def save_shot(value, path):
    if value.startswith("data:"):
        value = value.split(",", 1)[1]
    raw = base64.b64decode(value)
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    image.thumbnail((1440, 1000))
    image.save(path, "JPEG", quality=80)


def technical_findings(data, requested_url):
    findings = []
    def add(code, severity, finding, evidence, action):
        findings.append(dict(code=code, severity=severity, finding=finding, evidence=evidence, action=action))
    row = data.get("row", {})
    specs = row.get("specs_inline", "")
    faq = row.get("faq_text", "")
    speed = re.search(r"(?:^|\|)\s*No[- ]Load Speed:\s*([^|]+)", specs, re.I)
    faq_speed = re.search(r"(?:no[- ]load speed|first gear).{0,400}", faq, re.I)
    def speed_limits(text):
        ranged = re.findall(r"\d[\d,]*\s*(?:to|[–—-])\s*(\d[\d,]*)", text, re.I)
        rpm = re.findall(r"(\d[\d,]*)\s*rpm", text, re.I)
        return {int(value.replace(',', '')) for value in ranged + rpm if int(value.replace(',', '')) > 0}
    if speed and faq_speed:
        spec_values, faq_values = speed_limits(speed.group(1)), speed_limits(faq_speed.group())
        if spec_values and faq_values and spec_values != faq_values:
            add("speed_conflict", "high", "No-load speed conflicts between specifications and FAQ", f"Specifications: {speed.group(1).strip()}; FAQ: {faq_speed.group().strip()}", "Verify the exact model and kit against its manufacturer manual. Publish the same verified first-gear and second-gear speeds in the facts table, FAQ and structured data. Consistent facts help search engines and AI answers interpret the product; this does not guarantee rankings.")
    watts = re.search(r"(?:^|\|)\s*Power Input:\s*([0-9.]+)\s*W\b", specs, re.I)
    voltage = re.search(r"(?:^|\|)\s*Battery Voltage:\s*([0-9.]+)\s*V\b", specs, re.I)
    if watts and voltage and re.search(r"cordless|battery", row.get("title_en", ""), re.I):
        add("cordless_power_review", "review", "Verify the wattage listed for this cordless product", f"Power Input: {watts.group(1)}W; Battery Voltage: {voltage.group(1)}V", "A wattage figure alone is not proof of an error. Confirm what it measures using the exact manufacturer's documentation; label it clearly or remove it if unsupported. Keep verified voltage and kit contents consistent across the page and feeds.")
    if row.get("model_number") and "schemaModel" in data and not data["schemaModel"]:
        add("schema_model_missing", "review", "Visible model number is absent from Product model/MPN fields", f"Visible specification: {row['model_number']}; Product model/mpn: not found", "Add the verified model and manufacturer part number to the appropriate Product structured-data fields, matching the visible product. This improves machine-readable product identification; rich results and AI rankings are not guaranteed.")
    weight = re.search(r"(?:^|\|)\s*Weight:\s*([0-9.]+)\s*kg\b", row.get("specs_inline", ""), re.I)
    feature_weights = re.findall(r"([0-9.]+)\s*kg\b", row.get("description_en", ""), re.I)
    if weight and any(float(value) != float(weight.group(1)) for value in feature_weights):
        add("weight_conflict", "high", "Product weight differs between page sections", f"Specifications: {weight.group(1)} kg; description/features: {', '.join(dict.fromkeys(feature_weights))} kg", "Confirm whether these are tool, kit or shipping weights against a supplier source. Label each weight clearly and align the description, facts table and structured data before using a draft.")
    if not data.get("canonical"):
        add("canonical_missing", "review", "Canonical link was not found", "No rel=canonical in the rendered page", "Confirm the intended canonical URL on the published PDP.")
    if "noindex" in data.get("robots", "").lower():
        add("noindex", "high", "Page declares noindex", data["robots"], "Confirm whether this product should appear in search; remove noindex only if indexing is intended.")
    if data.get("h1Count") != 1:
        add("h1_count", "review", "Review the main product heading", f"Visible non-empty H1 count: {data.get('h1Count')}", "Use one clear primary product heading; multiple headings are a review signal, not an automatic ranking penalty.")
    if not data.get("productSchema"):
        add("schema_missing", "review", "Product JSON-LD was not found", "No Product node detected in rendered JSON-LD", "Check Product markup and product feeds. This check does not inspect microdata or guarantee rich-result eligibility.")
    if data.get("malformedSchema"):
        add("schema_invalid_json", "high", "Malformed JSON-LD found", f"Unparseable JSON-LD scripts: {data['malformedSchema']}", "Repair the JSON syntax and validate structured data against the visible product.")
    if data.get("schemaCurrency") and data["schemaCurrency"] != "AED":
        add("currency", "review", "Product offer currency needs review", data["schemaCurrency"], "Confirm currency agrees with the price visible to UAE customers.")
    if data.get("mobileOverflow"):
        add("mobile_overflow", "review", "Possible horizontal overflow on mobile", f"Page width {data.get('mobilePageWidth')}px; viewport 390px", "Inspect the mobile screenshot and check tables, product images and fixed elements.")
    return findings


async def collect_one(browser, url, job_id, index, evidence_dir):
    start = time.monotonic()
    page = None
    try:
        validate_url(url)
        page = await browser.new_page(url)
        await page.set_viewport_size(1365, 900)
        # Bounded readiness wait; no indefinite network-idle wait on analytics requests.
        for _ in range(20):
            state = decode_result(await page.evaluate("() => JSON.stringify({ready: !!document.querySelector('h1') && document.readyState !== 'loading', text: document.body?.innerText?.length || 0})"))
            if state.get("ready") and state.get("text", 0) > 200:
                break
            await asyncio.sleep(.5)
        final_url = await page.get_url()
        validate_url(final_url)
        initial = decode_result(await page.evaluate(EXTRACT))
        preview = initial.get("bodyPreview", "").lower()
        if any(s in preview for s in ["verify you are human", "checking your browser", "access denied", "captcha", "just a moment", "automated traffic", "unusual traffic", "failed to verify your browser", "vercel security checkpoint"]):
            raise ValueError("FEPY verification or security screening blocked this audit browser. No page assessment was made. The site administrator must permit the authorised audit worker before rerunning.")
        if not initial.get("productSchema") and not (initial.get("pdpSections") and initial.get("h1Count") == 1):
            raise ValueError("Product JSON-LD was not found. This URL may be a category, error page, or unsupported PDP; it was not treated as a product.")
        # Only known read-only product section toggles. No general autonomous agent or form actions.
        for selector in ([] if initial.get('pdpSections') else ['[role="tab"]', '.product.data.items .data.item.title a', '[data-testid="product-description-toggle"]', '#full-details button']):
            for element in (await page.get_elements_by_css_selector(selector))[:8]:
                label = str(await element.evaluate("() => this.textContent")).lower()
                if any(word in label for word in ["description", "specification", "details", "additional information", "features & benefits"]):
                    await element.click()
                    await asyncio.sleep(.3)
        data = decode_result(await page.evaluate(EXTRACT))
        await page.evaluate("() => { window.scrollTo(0, 0); return true; }")
        desktop = evidence_dir / f"{job_id}-{index}-desktop.jpg"
        save_shot(await page.screenshot(format="jpeg", quality=80), desktop)
        await page.set_viewport_size(390, 844)
        await asyncio.sleep(.3)
        mobile = evidence_dir / f"{job_id}-{index}-mobile.jpg"
        save_shot(await page.screenshot(format="jpeg", quality=80), mobile)
        size = decode_result(await page.evaluate("() => JSON.stringify({width: document.documentElement.scrollWidth, viewport: innerWidth})"))
        data.update(mobileOverflow=size['width'] > size['viewport'] + 8, mobilePageWidth=size['width'])
        return {"status": "completed", "requestedUrl": url, "finalUrl": final_url, "auditedAt": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), "durationSeconds": round(time.monotonic()-start, 2), "extracted": data["row"], "sources": data["sources"], "technical": technical_findings(data, url), "canonical": data["canonical"], "robots": data["robots"], "productSchemaDetected": data["productSchema"], "h1Count": data["h1Count"], "imageUrls": data["imageUrls"], "evidence": {"desktop": f"{job_id}-{index}-desktop.jpg", "mobile": f"{job_id}-{index}-mobile.jpg"}}
    except Exception as error:
        diagnostic = {}
        if page:
            try:
                visible = decode_result(await page.evaluate("() => JSON.stringify({pageTitle: document.title, visibleText: (document.body?.innerText || '').slice(0,1200), documentUrl: location.href})"))
                diagnostic.update(visible)
                block_text = (visible.get("pageTitle", "") + " " + visible.get("visibleText", "")).lower()
                if any(marker in block_text for marker in ["vercel security checkpoint", "failed to verify your browser", "verify you are human", "checking your browser", "just a moment", "automated traffic", "unusual traffic"]):
                    diagnostic["failureKind"] = "access_blocked"
                shot = evidence_dir / f"{job_id}-{index}-desktop.jpg"
                save_shot(await page.screenshot(format="jpeg", quality=80), shot)
                diagnostic["evidence"] = {"desktop": shot.name}
            except Exception:
                pass
        return dict(diagnostic, status="error", requestedUrl=url, durationSeconds=round(time.monotonic()-start,2), error=str(error) if isinstance(error, ValueError) else "Browser collection failed ("+type(error).__name__+"). No page assessment was made.")
    finally:
        if page:
            try:
                await browser.close_page(page)
            except Exception:
                pass


async def collect_pages(urls, job_id, evidence_dir, update, cdp_url=None):
    from browser_use import Browser
    options = dict(allowed_domains=list(HOSTS), enable_default_extensions=False, accept_downloads=False, auto_download_pdfs=False, permissions=[])
    if cdp_url:
        browser = Browser(cdp_url=cdp_url, keep_alive=True, **options)
    else:
        browser = Browser(headless=True, executable_path=os.getenv("AUDITOR_CHROMIUM_PATH", "/usr/bin/chromium"), chromium_sandbox=False, keep_alive=False, **options)
    results = []
    evidence_dir.mkdir(parents=True, exist_ok=True)
    try:
        await browser.start()
        # One tab at a time on the existing 4GB worker while the embedding model is resident.
        for index, url in enumerate(urls):
            try:
                result = await asyncio.wait_for(collect_one(browser, url, job_id, index, evidence_dir), timeout=70)
            except asyncio.TimeoutError:
                result = {"status": "error", "requestedUrl": url, "error": "Page collection timed out. No page assessment was made."}
            results.append(result)
            update(index + 1, results)
            if result.get("failureKind") == "access_blocked":
                for remaining in urls[index + 1:]:
                    results.append({"status": "error", "requestedUrl": remaining, "failureKind": "skipped_after_block", "error": "Not opened because site verification blocked this batch. No assessment was made."})
                update(index + 1, results)
                break
    finally:
        await browser.stop()
    return results


if __name__ == "__main__":
    import sys
    config = json.loads(Path(sys.argv[1]).read_text())
    output = Path(config["output"])
    def write_progress(count, pages):
        temporary = output.with_suffix(".tmp")
        temporary.write_text(json.dumps({"pagesCompleted": count, "pages": pages, "finished": False}))
        temporary.replace(output)
    try:
        pages = asyncio.run(collect_pages(config["urls"], config["jobId"], Path(config["evidenceDir"]), write_progress, config.get("cdpUrl")))
        write_progress(len(pages), pages)
        data = json.loads(output.read_text())
        data["finished"] = True
        temporary = output.with_suffix(".tmp")
        temporary.write_text(json.dumps(data))
        temporary.replace(output)
    except Exception as error:
        print("Browser runtime failed: " + type(error).__name__, file=sys.stderr)
        sys.exit(1)
