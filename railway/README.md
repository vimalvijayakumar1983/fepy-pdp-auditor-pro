# Railway worker

Railway is the later home for the EmbeddingGemma audit worker. The Next.js app on Vercel stays the UI.

Do not deploy the embedding model in v1. The catalog page already scores Excel/CSV exports with rules, SEO, and AEO checks.

When the catalog export is ready:
1. Create a Railway service from this repo.
2. Set the start command to a Python worker that reads image URLs and writes mismatch scores.
3. Point `EMBED_API_URL` on Vercel at that service.

The worker is intentionally not required for the first audit.
