# FEPY PDP Auditor Pro

A ready-to-deploy demo of the PDP auditing UI we prototyped.

## Quick start (local)
```bash
npm install
npm run dev
# open http://localhost:3000
```

## Deploy to Vercel (recommended)
1. Push this folder to a Git repo (GitHub/GitLab/Bitbucket).
2. Go to vercel.com → New Project → Import the repo.
3. Framework: **Next.js**. Build & Output: default.
4. Deploy. (No env vars required for the demo.)

## Deploy to Netlify
- Use the Next.js runtime adapter or Netlify’s Next.js build.
- Build command: `npm run build`
- Publish directory: `.next` (Netlify will detect automatically).

## Docker (self-host)
```bash
docker build -t fepy-pdp-auditor-pro .
docker run -p 3000:3000 fepy-pdp-auditor-pro
# open http://localhost:3000
```

## Notes
- `app/api/audit/route.ts` returns mock results. Replace with real logic that fetches PDP pages and validates rules.
- All UI components live in `components/ui/*` and the page in `app/page.tsx`.

## Replace mock with real auditing
1. In `app/api/audit/route.ts`, replace the mock with fetch/scrape of each URL (e.g. using `fetch` + `cheerio` or Playwright for JS-heavy sites).
2. Implement real rules and scores in `lib/audit.ts`.
3. Optionally connect to a DB (e.g., Supabase/Postgres) if you want history and user accounts.
