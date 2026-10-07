# FEPY AI worker

Implements EmbeddingGemma 2 (text + image, CPU) and OpenAI Decisions API (`gpt-6-luna`, `POST /v1/decisions`). Rules remain on Vercel; AI does not edit products.

## Deploy

Deploy this repository with root directory `/railway`, Dockerfile `Dockerfile`, and health check `/health`. Use one process/replica with a volume at `/data` (8 GB) and 4 GB RAM / 2 vCPU initially. Benchmark before increasing batch sizes.

Worker environment variables:

- `AUDITOR_WORKER_TOKEN`: random shared bearer token. Required on all endpoints except health.
- `OPENAI_API_KEY`: add directly in Railway Variables. Never commit it or send it in chat.
- `HF_HOME=/data/models`, `AUDITOR_DATA_DIR=/data/auditor`.
- `AUDITOR_IMAGE_HOSTS`: comma-separated approved image/CDN hostnames. Defaults: `fepy.com,imagekit.io,ik.imagekit.io,res.cloudinary.com`. Subdomains are permitted. Downloads require public HTTPS addresses, no redirects, max 10 MB / 25 million pixels.
- Optional `HF_TOKEN`: configure directly in Railway if Hugging Face requires account/model access.

On Vercel set `AUDITOR_WORKER_URL` to the generated Railway HTTPS URL, and `AUDITOR_WORKER_TOKEN` to the identical token. Redeploy after changing environment variables. Keep Deployment Protection enabled; the app is an internal audit tool and does not implement separate user accounts.

## API

Bearer authentication is required on `/capabilities`, `POST /jobs`, and `GET /jobs/{id}`. Create a job with `{ "rows": [...], "decisions": true, "embeddings": true }`. It returns 202 and a job ID. Poll until `completed` or `failed`; row results are returned during processing. Maximum 500 rows, one active worker thread, queue limit 3. Decisions errors and missing configuration do not become passes. Jobs interrupted by restart are explicitly failed rather than automatically replaying paid requests.

Embedding weights download on first use. Text and resized-image embeddings are cached by content SHA-256 and model identity for up to 30 days. Jobs expire after 24 hours. A job compares neighbors within the uploaded batch, not the entire FEPY catalogue. No product data is written to Magento.

Similarity >= 0.85 produces up to three review candidates per modality. This is a provisional review threshold, not an exact-match classifier; calibrate against a labeled FEPY sample. Image/title cosine similarity is exposed without a pass threshold. Decisions confidence below 0.90, negative assessments, refusal and insufficient evidence all require review. Confidence is not assumed calibrated. Verify variant/pack details independently before any merge.

## Tests

`python -m unittest discover -s railway -p 'test_*.py'`

Tests use mocked inference/HTTP; they validate contracts, authentication, input bounds, confidence/refusal handling, cache behavior and partial failures. A real model smoke test and OpenAI access check are separate deployment checks.

Reference docs:
- https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers
- https://developers.openai.com/api/docs/guides/decisions

## Live PDP auditing

`POST /live-jobs` accepts `urls` (1–100 public HTTPS fepy.com/www.fepy.com product URLs) and optional `decisions`/`embeddings` booleans. Browser Use 0.13.11 drives local headless Chromium with direct page controls; no navigation LLM/API key is needed. One page is read at a time on this 4GB worker, before model assessment. This is a bounded batch, not an unrestricted autonomous shopping agent.

Read progress and captured fields with the existing authenticated `GET /jobs/{id}`. `phase` separates page collection from assessment; per-page errors are never scored as successful products. Screenshots at `GET /jobs/{id}/evidence/{index}/desktop` or `/mobile` show the first viewport and expire with jobs after 24h. Evidence files are purged on subsequent live jobs. Product sections, metadata and JSON-LD are collected; robots.txt, response headers, actual indexing/rankings, manufacturer verification and complete interactions are not covered.

Chromium is installed in the Docker image. Browser Use runs in `/opt/browser` with separate dependencies from Transformers/EmbeddingGemma; public URL batches and evidence are exchanged through temporary files. No OpenAI or worker credentials are passed to the browser process. Override its executable with `AUDITOR_CHROMIUM_PATH` only if necessary. `ANONYMIZED_TELEMETRY=false` disables Browser Use telemetry. No persistent browser profile or customer login is used. Known product details toggles may be opened; cart, checkout, customer account and admin URLs are rejected.

### FEPY access prerequisite

The deployed Railway Chromium pilot on 2026-10-07 reached FEPY's **Vercel Security Checkpoint**, returning **Failed to verify your browser / Code 29**. It did not obtain product evidence and no AI assessment was made. The site owner must authorize this audit worker in the FEPY site's security configuration before live audits can be validated. Do not disable certificate verification, disguise fingerprints or rotate proxies to evade the checkpoint. Access blocks are captured as diagnostic screenshots; remaining URLs are skipped without browsing. CSV audits remain usable.
