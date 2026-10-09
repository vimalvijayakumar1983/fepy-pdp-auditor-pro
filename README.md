# FEPY PDP Auditor Pro — Product Intelligence Workspace

A persistent team workspace for improving product detail pages. Products, captured evidence, source comparisons, issue ownership, editorial drafts and audit history stay connected across runs. Open `/workspace`; the existing detailed audit console remains at `/catalog`.

## Working product features

- Projects and a durable product library, with CSV imports and live FEPY audits.
- Overview of active/high-priority findings, recheck work and captured field coverage. Coverage is not an accuracy score.
- An improvement queue filtered by priority, category, owner and workflow status, with saved notes, due dates and optimistic concurrency checks.
- Content studio for English/Arabic titles, descriptions, specifications, FAQs, image descriptions and search metadata. Drafts never overwrite captured evidence or publish to the storefront.
- Original desktop/mobile evidence, manufacturer-source scope, AI assessment state and captured fields available beside the proposed change.
- Saved audit history, original capture times and field comparison between versions. Saved-evidence reassessment is clearly distinct from fresh browser capture.
- Authenticated CSV/JSON exports and a print/PDF report. Screenshot binaries remain on the worker volume.
- A PDP playbook covering identity, accuracy, content/answers, search/schema, media/mobile/accessibility, commerce/trust, Arabic and continuous improvement. It describes both supported checks and manual/integration work.
- Responsive navigation, keyboard focus handling, error/empty/loading states and protected team access.

## Access and deployment

This release introduces private workspace access and therefore **fails closed** until the app access variables are configured. It protects the legacy audit console and its proxies as well as the new workspace. It is a shared team workspace, not a multi-tenant SaaS: an owner/assignee is an editorial label, not a verified user identity or role.

Vercel/Next.js variables:

| Variable | Requirement |
| --- | --- |
| `AUDITOR_WORKER_URL` | HTTPS URL of the Railway worker |
| `AUDITOR_WORKER_TOKEN` | Private bearer token, identical on app and worker |
| `AUDITOR_APP_PASSWORD` | Private workspace password, at least 16 characters |
| `AUDITOR_SESSION_SECRET` | Independent random secret, at least 32 characters |

Use your hosting environment/secret manager to supply the values; never commit them. Sessions use signed, HttpOnly, SameSite=Strict cookies with a 12-hour expiry; HTTPS cookies are Secure. Mutations require the same request origin. The login has a process-local attempt limiter; an edge/WAF limiter or managed identity provider is needed for an Internet-scale launch. Rotate both access variables to invalidate existing sessions when removing shared access.

Railway variables and browser/AI dependencies are described in [railway/README.md](railway/README.md). Preserve the existing volume and `AUDITOR_DATA_DIR`: workspace records and archived evidence live there.

### Rollout order

1. Back up the Railway database and evidence directory. Test this branch against an isolated worker/volume.
2. Deploy the worker with the new `workspace.py` module. SQLite creates additive workspace tables; it does not delete legacy records.
3. Configure private access on the app, then deploy the app against the upgraded worker.
4. Sign in; create a project; save existing recent audits before their temporary 24-hour window expires.
5. Validate an authorized live audit, saved screenshot access, draft/review persistence and export in staging before switching production.

Automated FEPY collection requires site-administrator permission, expressed by the existing `FEPY_AUDITOR_ACCESS_APPROVED=true` setting. The worker now enforces this for both Cloud/CDP and local/background browser paths, before site resolution or collection, and for FEPY-hosted image fetches. No checkpoint is bypassed. The unused `/api/audit` legacy HTML endpoint is retired with HTTP 410 because it skipped this gate and invented fallback product claims. The workspace requires an active authorized UAE Cloud browser for its live-audit dialog. Browser sessions remain billable until stopped or expired; use **Browser sessions** to resume and stop them after collection.

## Persistence and interpretation

The original jobs API retains unsaved runs for 24 hours. Workspace audits archive terminal results and protect their original screenshot files from that cleanup. Project-aware jobs archive on the **worker**, so closing the browser tab does not prevent saving. The browser also offers a recoverable save action and local pending-run pointer.

Products are identified by normalized canonical FEPY URL (or SKU for URL-less catalog imports); use consistent identifiers to avoid treating a URL-less record and a subsequent URL record as separate items. Each project supports up to 500 products; split larger catalogs into projects. The workspace supports up to 100 projects and displays the 100 most recent saved audits. JSON export retains all saved audits. Audits imported out of order cannot replace a newer page capture.

Repeated imports/saves are idempotent. A concurrent review/draft edit returns HTTP 409 rather than silently overwriting another editor. Changed findings reopen for review. Only a newer, completed page capture with the relevant check executed can mark an old finding **not detected**; saved-evidence reassessment, blocked pages, unavailable sources and failed detailed review do not establish a fix. This status does not certify manufacturer accuracy or overall readiness.

Back up the Railway volume (SQLite plus evidence) regularly. The JSON export includes evidence metadata, not screenshot binaries, and is an export rather than a database-restore feature. Archived records are retained until an administrator performs a documented retention operation; storage usage should be monitored.

## Local validation

```bash
npm ci
# configure .env.local using the variable names above
npm run dev
npm test
npm run test:worker
npm run build
```

The browser smoke test uses a local synthetic worker and a temporary database, no FEPY access, no Browser Use sessions and no paid AI:

```bash
python -m pip install fastapi httpx pillow pypdf uvicorn
npx playwright install chromium
npm run test:workspace
```

If Chromium is already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path. Set `FEPY_TEST_ARTIFACT_DIR` to a local directory to retain desktop/mobile screenshots, a PDF and accessibility output. Test credentials are synthetic and only used by the local test processes.

## Next production milestones

This release supplies a working continuous-improvement workflow, not a claim that every enterprise capability exists. Before a public SaaS launch, add managed individual sign-in/SSO, role-based authorization and tenant isolation; move large catalogs to a scalable database and object storage with backups/retention; add durable job queues, quotas, provider usage/cost accounting and operational monitoring. Subsequent commerce integrations should support reviewed Magento/PIM change sets with rollback, scheduled fresh audits with the same site permission gate, analytics-linked outcome measurement, richer media/interaction/accessibility/performance testing and a separately authorized Arabic storefront collector. None of those is shown as a working feature here.
