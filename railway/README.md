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

## Interactive UAE browser

Set `BROWSER_USE_API_KEY` privately on the Railway worker. `/browser-sessions` GET reports readiness; POST starts a blank Browser Use Cloud API v4 browser with `proxyCountryCode=ae`, a 30-minute timeout, recording disabled, and CAPTCHA solving disabled. The catalog live-audit tab embeds the provider's interactive `liveUrl`, with manual control, watch mode, and a stop button. GET/DELETE `/browser-sessions/{id}` refreshes/stops a worker-owned session. All worker routes require the worker bearer token; Next.js proxies them server-side with private/no-store responses. Keep the Vercel project protected. Never log or share the live URL: it grants browser control. CDP and provider credentials stay on the worker.

A maximum of two active sessions is allowed by this worker. Creation requests are not automatically retried or switched to another country. The UI reports that UAE routing was requested; egress IP location has not been independently verified. Browser Use browser/proxy charges apply. Stop sessions when finished; closing the app does not stop billing before the timeout.

After the FEPY site administrator permits the auditor, set `FEPY_AUDITOR_ACCESS_APPROVED=true`. Only then may `/live-jobs` receive a `browserSessionId` to attach the existing collector to the same Cloud browser shown in the panel. A new network route must not be used to evade the known FEPY checkpoint. The panel starts blank and performs no automatic FEPY navigation. While collection runs, manual control is disabled locally to avoid changing evidence mid-audit.

## Findings and response time

The collector reads every linked breadcrumb instead of CSS `a:last-of-type` (which matched Home inside its own list item). Model/MPN uses Product schema first, then the visible Model No specification, with source labels. FAQ text is supplied to Decisions. Deterministic findings expose the exact FAQ/specification RPM disagreement and review a wattage entry alongside battery voltage without asserting an unverified manufacturer correction. Missing Product model/MPN fields are distinct from a missing visible model.

Live audits default to page evidence plus Decisions; image similarity can be selected explicitly. Findings are published as soon as page evidence arrives and retained during assessment. Decisions finishes and is saved before optional EmbeddingGemma loading/inference. Per-product timing records separate image fetch, Decisions and similarity; browser collection time remains in page evidence. Visible FEPY sections skip unnecessary legacy tab enumeration. No browser data is reused as fresh evidence.

`node tests/live-extract.test.cjs` checks extraction against HTML fixtures with a DOM adapter; it does not launch a real browser. Python tests verify exact finding evidence and that Decisions/page results are readable while similarity runs.


## Evidence review (2026-10-08)
Live audits default to fast page findings followed by model-matched manufacturer PDF comparison and a structured, quoted AI review. Detailed review uses the Responses API (`AUDITOR_DETAIL_MODEL`, default `gpt-6-luna`) separately from fast Decisions classification. Source facts are not assumed when retrieval fails or identity does not match. AI findings with fabricated/nonmatching quotes are withheld; all corrections remain reviewable drafts.

Pattex PL150 automatically checks Henkel's UAE technical sheet. Other models can use up to two approved manufacturer PDF URLs supplied in the UI or discovered on the PDP. Default allowed reference domains: datasheets.tdx.henkel.com, dm.henkel-dam.com, www.bosch-professional.com, www.makita.ae. Add exact trusted manufacturer hosts through AUDITOR_REFERENCE_HOSTS. HTTPS/public DNS only; no redirects, 5 MB limit, 30-page limit, readable text required. Retrieved sources cache for 24 hours and retain retrieval timestamps. This is not universal manufacturer-source discovery or full certification.

Authenticated recent-audit history covers 24 hours. Rechecking saved page evidence creates a new audit, retains the original capture time and uses current assessment logic without another browser session. New page-context/review checks require a fresh capture if an older audit did not collect those fields. Fast results remain visible during the deeper phase. Findings export as CSV (with spreadsheet formula escaping) and the complete report exports as JSON. Field completeness is displayed separately from accuracy and source coverage; no SEO ranking or AI citation guarantee is given.
