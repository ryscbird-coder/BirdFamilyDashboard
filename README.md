# Bird Family Hub

A private, shared household organiser with a responsive command-centre dashboard and wall mode. Built in the selected BirdFamilyDashboard repository with the official OpenAI Sites Vinext starter, React, a Sites-managed Cloudflare Worker and D1. The Mac and development session are not production dependencies.

## Development

Use Node 24.19.0 LTS and npm 11.17.0. The prepared selected environment toolchain can be activated with `source /workspace/.birdfamilyhub/activate.sh`.

```sh
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run build
```

`npm run build` copies the locally installed OCR engine/language assets into generated public/ocr, builds Vinext, and verifies the Sites manifest/migration journal. OCR assets are build inputs from locked packages, not household photographs. The upstream starter's compatibility date is retained because its pinned local Workers binary only supports dates through May 2026.

Apply each unapplied local migration once, in order (use the real filename):

```sh
node --import ./scripts/local-tool-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_smart_old_lace.sql
node --import ./scripts/local-tool-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_funny_black_queen.sql
npm run dev
```

For a built Worker HTTP check, `npm start -- --port 8787`, then `node scripts/smoke.mjs`. The smoke script accepts loopback origins only and uses synthetic trusted identity headers. It validates SSR, compiled API routing, D1 state across requests, tick/restore, version conflicts and unauthorised denial. It is not a real ChatGPT account test. Generated `.wrangler` and `.sites-runtime` state is ignored. Browser QA needs the supported environment browser; do not install an alternate browser to compensate for unavailable preview tooling.

## Deployment

Keep `.openai/hosting.json` project_id unchanged. The single Site identity was created after repository and existing Site inspection. `d1: "DB"`; R2 is disabled because images are never stored. `capabilities: ["mcp"]` exposes fixed private tools.

Read the current Sites skill before publishing. Retain its source access in memory and pass it on hidden stdin only. Keep the selected GitHub origin and Sites-managed source remote on the same exact commit. `scripts/push-source.mjs` accepts the native credential JSON on stdin and uses only temporary process authentication. It writes no token files. Do not print tokens or put them in shell arguments.

The official starter was obtained with `@openai/create-sites` because this environment lacked the plugin's filesystem lifecycle helpers. It preserves `sites()` from `@openai/sites-vite-plugin`. The native supported archive is the contents of dist, including .openai/hosting.json, server, client and .openai/drizzle. Push exact source before native save/deploy. Use owner-private deployment before inviting family, then preserve the resulting private audience and use the shared-audience native workflow for later versions. Never create another Site to resolve a normal deployment error.

The database schema lives in db/schema.ts. Generate append-only migrations using `npm run db:generate`; inspect SQL and journal. Sites applies hosted migrations during deployment. Never create tables in a request or edit applied migration history. Local D1 is separate from hosted D1. Do not commit household records, captures, task results, source credentials or runtime secrets.

## Data and permissions

Every API operation requires platform-injected `oai-authenticated-user-id`; write routes also validate same origin and bounded JSON. Owner-private first use atomically claims the owner. Do not broaden access before owner bootstrap. The owner may create a verified-email invitation with POST /api/members/invites or the fixed private MCP tool. On later sign-in only an exact trusted email match grants household member status. Sites visitor access is an independent required grant. Do not guess family emails.

Family records share one household database. Uninvited accounts are denied; family members are denied owner admin, membership and source-health writes. `/api/state` and `/api/export` never include private admin results. `/admin` checks the server-side owner permission. Wall mode is a presentation setting, not a restricted device identity: an owner-signed-in tablet can still reach owner routes. A limited device session remains a separate setup consideration before private business content is left on an unattended screen.

CRUD uses stable operation keys and version checks. Shopping completion is reversible. Recurring reminders advance a single task and expose Undo. Meal records retain recipe snapshots; later recipe edits/deletion do not rewrite the plan. Ingredient imports scale numeric quantities, preserve uncertain text, separate incompatible units and deduplicate equivalent operations, including HTTP retries. Export is JSON, paginated with nextCursor and ?after= if needed.

## Camera and OCR privacy

Flow: Recipes → Scan → Start camera → Capture → Read → Review text → Review recipe fields → Save. getUserMedia runs only after an explicit action and browser permission. There is no file-input or Photos-save requirement.

Captures use only a transient canvas and local Tesseract worker. Same-origin pinned engine and English language assets are hosted with the app. No image is sent to an API, AI provider, D1, R2, queues, analytics, logs, localStorage, IndexedDB, service worker or backup. OCR traineddata caching is disabled (`cacheMethod: none`). Success, cancellation, retake, error, 90-second timeout, hidden page and component unmount stop tracks, clear canvas references and terminate the worker; generation guards discard late results. No object URLs are created. Only reviewed recipe fields are saved. Browser/OS temporary buffers are outside application control; forensic erasure is not promised.

OCR is not cloud AI extraction. Unrecognised headings/quantities are retained as uncertain review text; missing servings are explicitly flagged. There are no invented recipes. A synthetic printed-page Node OCR run achieved 93% confidence; physical camera/browser lifecycle tests remain separate and are not claimed. Cloud AI formatting requires a separately configured supported service and retention review before enabling any image-upload path.

## Connections and existing workflows

The core organiser and local OCR need no provider secrets. Hosting supplies sign-in and DB. iCloud remains the intended external calendar source; hosted connector eligibility/action access was not exposed in this account/tool surface, so authenticated hosted iCloud reads/writes are not claimed. Manual Hub events are distinctly labelled and are not two-way Apple sync. No work rota, repeating appointments or availability is inferred. Notifications are displayed web reminders, not push delivery.

Existing news, UK-events, travel and weekly-dashboard schedules are independent. No schedules were created, duplicated, resumed or edited. The news/travel run metadata and dated concise results were read separately from underlying provider facts. Runtime-only import evidence is kept outside the Git repository. Do not treat a timestamp of task execution as a successful source check without a matching result.

The Site MCP contract (2026-07-28) exposes `bird_hub_read_household`, `bird_hub_read_admin_results`, `bird_hub_upsert_result`, `bird_hub_upsert_source`, `bird_hub_invite_member`. Platform identity and owner checks apply. Result fields include workflow/sourceId, stable id, summary, action, owner, dueAt, sourceLink, observedAt, lastSuccess and runStatus. Updates require the current version and cannot change the owning workflow/source. Source status is distinct from task findings. Freshness is green through one hour, yellow through 24 hours, red beyond 24 hours, grey when never verified/invalid/future. Page loads do not refresh timestamps.

Install/connect the Site's private plugin and verify a real write plus readback before treating unattended writers as operational. Then wire existing specialist jobs individually without changing their schedules or paused states. Local email/transport work still depends on its own Mac access. New results update D1, not the website deployment. Keep detailed news/business/email findings in admin. Shared source nodes carry concise health/provenance only.
