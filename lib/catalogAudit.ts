export type CatalogRow = {
  sku?: string;
  product_url?: string;
  title_en?: string;
  title_ar?: string;
  brand?: string;
  model_number?: string;
  category?: string;
  price_aed?: string | number;
  currency?: string;
  stock_status?: string;
  description_en?: string;
  image_url_1?: string;
  image_alt_1?: string;
  meta_title?: string;
  meta_description?: string;
  specs_inline?: string;
};

export type AuditIssue = {
  code: string;
  severity: "fail" | "review";
  message: string;
  recommendation: string;
};

export type CatalogAudit = {
  sku: string;
  title: string;
  score: number;
  seoScore: number;
  aeoScore: number;
  status: "pass" | "review" | "fail";
  issues: AuditIssue[];
  suggestedTitle: string;
  suggestedIntro: string;
  suggestedMeta: string;
  suggestedAlt: string;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function humanStock(value: string) {
  return value.split("_").join(" ");
}

export function auditCatalogRow(row: CatalogRow): CatalogAudit {
  const sku = text(row.sku) || "MISSING-SKU";
  const title = text(row.title_en);
  const brand = text(row.brand);
  const model = text(row.model_number);
  const category = text(row.category) || "product";
  const description = text(row.description_en);
  const image = text(row.image_url_1);
  const alt = text(row.image_alt_1);
  const metaTitle = text(row.meta_title);
  const metaDescription = text(row.meta_description);
  const url = text(row.product_url);
  const price = text(row.price_aed);
  const stock = text(row.stock_status);
  const specs = text(row.specs_inline);
  const arabic = text(row.title_ar);
  const issues: AuditIssue[] = [];

  if (!text(row.sku)) issues.push({ code: "missing_sku", severity: "fail", message: "SKU is empty.", recommendation: "Export the PIM SKU. One sellable variant per row." });
  if (!title) issues.push({ code: "missing_title", severity: "fail", message: "English title is empty.", recommendation: "Use brand + model + product type + key spec." });
  if (title && title.length < 35) issues.push({ code: "short_title", severity: "review", message: "Title is short for search.", recommendation: "Add brand, model, and the job or size. Keep it under 70 characters for the meta title." });
  if (title && !brand) issues.push({ code: "missing_brand", severity: "fail", message: "Brand is empty.", recommendation: "Fill brand from the PIM. Do not infer it from the title alone." });
  if (title && brand && !title.toLowerCase().includes(brand.toLowerCase())) issues.push({ code: "brand_not_in_title", severity: "review", message: "Brand is not in the English title.", recommendation: `Start the title with ${brand}.` });
  if (!model) issues.push({ code: "missing_model", severity: "review", message: "Model number is empty.", recommendation: "Add the manufacturer model so search and answer engines can cite the exact item." });
  if (!hasUrl(url)) issues.push({ code: "missing_url", severity: "fail", message: "Product URL is missing or not absolute.", recommendation: "Export the live canonical URL." });
  if (!price || Number(price) <= 0) issues.push({ code: "missing_price", severity: "fail", message: "Price is missing.", recommendation: "Export price_aed as a number, no currency symbol." });
  if (!stock) issues.push({ code: "missing_stock", severity: "review", message: "Stock status is empty.", recommendation: "Use in_stock, out_of_stock, or backorder." });
  if (!hasUrl(image)) issues.push({ code: "missing_image", severity: "fail", message: "Primary image URL is missing.", recommendation: "Export a fetchable CDN URL in image_url_1." });
  if (image && !alt) issues.push({ code: "missing_alt", severity: "review", message: "Image alt text is empty.", recommendation: "Alt text should be the product name, not a file name." });
  if (description.length < 80) issues.push({ code: "thin_description", severity: "review", message: "Description is too thin for SEO and AEO.", recommendation: "Open with one factual sentence: what it is, who it is for, and the key spec." });
  if (!specs) issues.push({ code: "missing_specs", severity: "review", message: "No specs_inline value.", recommendation: "Add labeled facts such as voltage: 18V | size: 12 mm." });
  if (!arabic) issues.push({ code: "missing_arabic", severity: "review", message: "Arabic title is empty.", recommendation: "Add title_ar where the UAE storefront serves Arabic." });
  if (!metaTitle) issues.push({ code: "missing_meta_title", severity: "review", message: "Meta title is empty.", recommendation: "Use a unique meta title under 60 characters with brand and model." });
  if (metaTitle && metaTitle.length > 60) issues.push({ code: "long_meta_title", severity: "review", message: "Meta title is longer than 60 characters.", recommendation: "Shorten it so Google does not truncate the brand or model." });
  if (!metaDescription || metaDescription.length < 50) issues.push({ code: "weak_meta", severity: "review", message: "Meta description is missing or short.", recommendation: "Write 120-160 characters with the product, spec, and availability cue." });

  const suggestedTitle = [brand, model, title || category].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 110);
  const suggestedIntro = `${brand || "This"} ${model || "product"} is a ${category.toLowerCase()} for UAE site and trade work. ${specs || "Add the key spec before publishing."}`;
  const suggestedMeta = `${suggestedTitle}. ${price ? `AED ${price}` : "Price on request"}${stock ? `, ${humanStock(stock)}` : ""}.`.slice(0, 160);
  const suggestedAlt = suggestedTitle;

  const seoChecks = [Boolean(title), Boolean(metaTitle), Boolean(metaDescription), Boolean(alt), hasUrl(url), hasUrl(image)];
  const aeoChecks = [description.length >= 80, Boolean(specs), Boolean(brand), Boolean(model), Boolean(price), Boolean(arabic)];
  const seoScore = Math.round((seoChecks.filter(Boolean).length / seoChecks.length) * 100);
  const aeoScore = Math.round((aeoChecks.filter(Boolean).length / aeoChecks.length) * 100);
  const failCount = issues.filter((issue) => issue.severity === "fail").length;
  const score = Math.max(0, 100 - failCount * 18 - (issues.length - failCount) * 6);
  const status = failCount > 0 ? "fail" : issues.length > 0 ? "review" : "pass";

  return { sku, title, score, seoScore, aeoScore, status, issues, suggestedTitle, suggestedIntro, suggestedMeta, suggestedAlt };
}

export function auditCatalog(rows: CatalogRow[]) {
  const results = rows.map(auditCatalogRow);
  const summary = {
    total: results.length,
    pass: results.filter((row) => row.status === "pass").length,
    review: results.filter((row) => row.status === "review").length,
    fail: results.filter((row) => row.status === "fail").length,
  };
  return { summary, results };
}
