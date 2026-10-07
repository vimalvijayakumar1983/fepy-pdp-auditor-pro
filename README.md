# FEPY PDP Auditor Pro

Catalog audit for Fepy product pages. Upload the PIM Excel export as CSV, then review missing fields, SEO gaps, AEO gaps, and suggested corrections. Nothing is published back to fepy.com.

## Catalog audit
Open `/catalog` after deploy. Paste the export saved as CSV, or use the sample rows already in the box.

Required columns: `sku`, `product_url`, `title_en`, `brand`, `category`, `price_aed`, `currency`, `stock_status`, `image_url_1`.

Recommended: `title_ar`, `model_number`, `description_en`, `image_alt_1`, `meta_title`, `meta_description`, `specs_inline`.

## Local
```bash
npm install
npm run dev
```
Open http://localhost:3000/catalog

## Vercel
Import this GitHub repo. Framework is Next.js. No env vars are required for the rule audit.

## Railway
Use Railway later for the EmbeddingGemma worker. See `railway/README.md`. The first version does not need it.

## Notes
`/api/audit` is the older page-level mock. `/api/catalog-audit` is the catalog export audit.
