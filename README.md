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
node --import ./scripts/local-tool-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_free_mongoose.sql
node --import ./scripts/local-tool-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_thin_pepper_potts.sql
node --import ./scripts/local-tool-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_long_swordsman.sql
node --import ./scripts/local-tool-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_hard_yellowjacket.sql
npm run dev
```

For a built Worker HTTP check, `npm start -- --port 8787`, then `node scripts/smoke.mjs`. The smoke script accepts loopback origins only and uses synthetic trusted identity headers. It validates SSR, compiled API routing, D1 state across requests, tick/restore, version conflicts and unauthorised denial. It is not a real ChatGPT account test. Generated `.wrangler` and `.sites-runtime` state is ignored. Browser QA needs the supported environment browser; do not install an alternate browser to compensate for unavailable preview tooling.

## Deployment

Keep `.openai/hosting.json` project_id unchanged. The single Site identity was created after repository and existing Site inspection. `d1: "DB"`; `r2: "BUCKET"` holds private, content-addressed compact dish thumbnails only. `capabilities: ["mcp"]` exposes fixed private tools.

Read the current Sites skill before publishing. Retain its source access in memory and pass it on hidden stdin only. Keep the selected GitHub origin and Sites-managed source remote on the same exact commit. `scripts/push-source.mjs` accepts the native credential JSON on stdin and uses only temporary process authentication. It writes no token files. Do not print tokens or put them in shell arguments.

The official starter was obtained with `@openai/create-sites` because this environment lacked the plugin's filesystem lifecycle helpers. It preserves `sites()` from `@openai/sites-vite-plugin`. Package with `node scripts/package-site.mjs` after building and committing. The native archive includes root `.openai/hosting.json` plus `dist/server`, `dist/client` and `dist/.openai/drizzle`; archiving only the contents of dist omits the required entrypoint path. Push exact source before native save/deploy. Use owner-private deployment before inviting family, then preserve the resulting private audience and use the shared-audience native workflow for later versions. Never create another Site to resolve a normal deployment error.

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

The core organiser and local OCR need no provider credentials. Hosting supplies sign-in and DB. Optional `HUB_BOOTSTRAP_JSON` is a secret runtime-only one-time setup envelope for verified result/source snapshots and family email invitations. It is validated and installed transactionally on an authenticated owner request, guarded by a stable batch marker; it never overwrites newer records and is never returned to clients. Private snapshot values and family email addresses stay out of Git. This initial import does not establish a continuously connected workflow writer. iCloud remains the external calendar source. ChatGPT-hosted connector eligibility was unavailable in this account; the separately authorised private CalDAV connection below supplies actual read-only imports. Do not infer that a ChatGPT connection automatically grants the Site access. Manual Hub events are distinctly labelled and are not two-way Apple sync. No work rota, repeating appointments or availability is inferred. Notifications are displayed web reminders, not push delivery.

Existing news, UK-events, travel and dashboard schedules are independent. This build did not create, duplicate, resume or change their schedules. News/travel/events received an additive result-handoff instruction while their existing source rules, timing and enabled states were preserved. The separate local dashboard chat was changed by its owner to Daily Ryan Dashboard at 08:30; the older cloud weekly task remains paused. Runtime-only import evidence stays outside Git. Do not treat a task execution timestamp as a successful source check without a matching result.

The Site MCP contract exposes `bird_hub_read_household`, `bird_hub_read_admin_results`, `bird_hub_upsert_result`, `bird_hub_upsert_source`, `bird_hub_upsert_household_feed`, `bird_hub_invite_member`, `bird_hub_read_calendar_connections`, `bird_hub_add_calendar_subscription`, `bird_hub_refresh_calendar`, `bird_hub_fridge_recipe`. Platform identity and owner checks apply. Result fields include workflow/sourceId, stable id, summary, action, owner, dueAt, sourceLink, observedAt, lastSuccess and runStatus. Updates require the current version and cannot change the owning workflow/source. Source status is distinct from task findings. Freshness is green through one hour, yellow through 24 hours, red beyond 24 hours, grey when never verified/invalid/future. Page loads do not refresh timestamps.

The Site's private plugin has passed authenticated production write/readback checks from the build chat. Future scheduled delivery is a separate check and is not established by a one-time write. Wire existing specialist jobs individually without changing their schedules or paused states. Local email/transport/dashboard work still depends on its own Mac access. New results update D1, not the website deployment. General business/email admin records remain owner-only; only a deliberate household-feed projection is shared.

## Inline source connections and Home updates

Use Sources and select a node to configure it in the inspector; no separate connection page is required. Add source creates an existing-workflow receiver or a manually maintained source. The single iCloud source is reused; multiple calendars are selected within its account. Source identifiers are immutable and duplicate sources are rejected. Workflow Receive updates changes only this Site's receiving preference. It never starts, resumes, pauses or reschedules the underlying task, and never changes successful-check timestamps.

News/travel/events have dedicated household-safe projections in `hub_household_feed`, included in `/api/state`. Private admin results stay separate. `bird_hub_upsert_household_feed` checks owner permission, an enabled matching workflow receiver, stable workflow/source ownership and the current record version. Existing news/travel/events task instructions now include this handoff without changing schedules or their detailed source rules. Initial Home cards come from actual dated run outputs, staged outside Git. A successful receiver test and a successful scheduled delivery are distinct.

Family tasks use the existing shared reminder records, with person assignment, due dates, recurrence and reversible checkboxes. Renaming the view does not duplicate existing reminders. Ryan explicitly authorised the full dashboard report on the household wall on 29 October 2026, including its business/email/finance content. Publish that selected report as a household-feed projection so family and wall sessions can read it without fetching general admin data. Other admin records stay owner-only. The paused cloud scheduler is separate from the current local daily dashboard. Do not label a truncated artifact as the full original report or invent missing sections.

## Private iCloud calendar login

The iCloud source inspector now supports a separate direct private CalDAV login. It does not inherit ChatGPT plugin consent and is not Apple OAuth. Use the Apple Account email and an **app-specific password**, never the normal Apple password. Apple requires two-factor authentication: https://support.apple.com/en-us/102654 . Create/revoke the password at https://account.apple.com under Sign-In and Security → App-Specific Passwords. Apple changing/resetting the primary password revokes app-specific passwords.

Set `HUB_ENCRYPTION_KEY` through Sites runtime secrets to a cryptographically random 32-byte base64 key before connecting. It is separate from D1, never bundled or returned to the browser, and must not be casually rotated while credentials are saved. Credentials are tested first, then stored only as AES-GCM ciphertext with a random nonce and account-bound AAD in `hub_icloud_accounts`. Each authenticated member manages only their own saved Apple connection; even the household owner cannot request another member’s private account status or credentials. The shared household status contains counts and health, without usernames or credentials. The original `hub_icloud` v1 ciphertext is adopted transactionally by the original household owner and then removed, preserving the key and existing calendar records. Password inputs clear on request, tab hide and unmount; no localStorage or browser persistence is used.

Per-member flow: Test & connect my account → choose up to 32 calendars and their family profiles → Save choices & sync my calendars. Synchronisation is **read-only**, with a bounded past-30/next-180-day window. Sync now remains available; the owner’s configured hourly hosted task also refreshes their selected calendars and subscriptions. Selecting calendars explicitly shares those imported event fields with household members. The adapter validates every HTTPS Apple CalDAV URL/redirect and bounds response bytes, request time, object count and recurrence expansion. It rejects partial/malformed responses before an import is treated as authoritative. Recurrence exceptions, cancellations, all-day exclusive ends and timezone/DST expansion use ical.js. Failed requests retain the last successful imported data. Manual Hub events are never modified by calendar sync; imported events are read-only locally.

Disconnect deletes only the current member’s saved credentials. They may also remove events supplied only by that connection; events supplied by another family connection and manual Hub events remain. Revoke the app-specific password at Apple if desired. The existing owner’s live CalDAV login/read path has been verified separately. Multi-account isolation/deduplication tests use synthetic authenticated identities and CalDAV fixtures; Gabriella’s actual sign-in and second Apple connection require a distinct real session before claiming that real-account flow has passed.

Changing a selection removes only that connection’s deselected contributions transactionally. A verified change to a different Apple account clears only that member’s prior contributions and successful-sync timestamp; a failed login changes neither. Other family connections are preserved. Cancelled recurrence markers without DTSTART are supported, while malformed non-cancelled events cannot trigger authoritative deletion.

## Original report fidelity and theme

Read full shows the original saved ChatGPT report body verbatim, including the original dated Humber block where the task's rota rule includes it. Only the Home card summary is shortened. The display adapter handles Markdown tables/links and ChatGPT presentation wrappers without rewriting report sections or executing arbitrary HTML; platform-only citations and images link to the original ChatGPT report. News and travel task handoffs require the complete original body on future runs. Source timestamps remain the original source-check times. The app uses a soft ivory/mint light palette while retaining the same orbital layout and source web.

Email/transport source nodes display actual background-job completion status, not a manual setup form. A partial job must say partial/needs action, and a successful check with no findings is still a successful check. Never replace missing or partial evidence with an invented “successfully organised” message.

Paused workflows are retained in a collapsed group rather than the active source web. A current daily dashboard and an older paused weekly workflow remain separate records; do not resume the older schedule to change a display label. Observation timestamps alone never count as successful source checks. Receiving enabled is a preference, not proof that unattended delivery works.

The dashboard report reader provides accessible section tabs, action cards and a Show all sections option using only sections present in the saved report. Its verified-summary label remains until the complete original arrives. The render adapter never stores rewritten report text or executes source HTML scripts. Markdown tables, task lists and strikethrough use individual extensions, avoiding the literal-autolink dependency's regex lookbehind that breaks older Safari parsing.

Household reads have a 15-second fetch/body deadline, share concurrent refreshes and retain the last good state after failure. A post-save refresh invalidates older polls so stale responses cannot undo a displayed checkbox change. An application loading error is distinct from Safari's browser-level “server stopped responding”; successful Worker requests do not prove a physical iPad's DNS, TLS or sign-in path worked.


## Multi-day events and calendar ownership

Week/month views keep the existing day-card appearance and render a multi-day event as a continuous bar across its covered dates. A bar splits only at a week boundary, with continuation markers and deterministic lanes for overlaps. London civil dates determine coverage, all-day DTEND is exclusive, and timed events ending exactly at midnight omit the next day. The day agenda uses the same date-range calculation. Narrow screens can scroll the week horizontally. There is no change to the event’s actual provider dates.

In Sources → iCloud calendars, each selected calendar can be assigned to an existing family profile or left Shared/unassigned. Profile IDs are stable; names and colours resolve from current records on each household read. Everyone remains the default filter. Calendar/person filters retain every contributing calendar and profile when an event is shared. The owner may edit other selected calendars’ household metadata without seeing their private Apple login.

Migration 0004 adds account, calendar-link, contribution and optimistic revision tables; it contains schema only. Do not change earlier migrations or runtime encryption settings. Each CalDAV connection retains its own authoritative snapshots. A household event is deduplicated by its true UID plus canonical original recurrence identity, never by title, date or an inferred matching person. Different calendar URLs can therefore supply the same event without creating another display record. Explicit shared-calendar links group calendar filters; distinct provider UIDs stay distinct even when their titles/times match. Global optimistic revision guards prevent one account’s sync from replacing concurrent changes. A failed/incomplete sync retains the last good data.

After legacy adoption, use forward fixes with this account model. The older v4 server reads only the removed singleton and cannot use the new account tables; rolling back code alone would hide the saved connection. Credentials remain encrypted in the new table. Any rollback needs a compatible data adapter rather than a blind source-version rollback.

The original import predates stored UID/recurrence identities. Its records and selections are preserved during upgrade. The original owner should sync once to establish those identities before another account publishes shared events; until then the second sync returns a clear refresh-required state rather than creating duplicates. This does not create or reschedule a background task. Automatic calendar refresh is enabled only when the hourly hosted task and its runtime metadata are configured, as described below.

## Cookbook links and recipe imports

Recipe detail uses numbered, tickable steps beside portion-scaled ingredients. Direct shopping imports retain the existing server-side idempotency and cupboard exclusions. `yieldUnit: batches` supports clippings that do not specify a serving yield without inventing a person count. Pack weights that are absent remain explicit pack units. Full source photos are not stored. Available dish pictures use deduplicated WebP thumbnails (max480px, target25KB, hard40KB), served only to household members.

`POST /api/recipes/import-link` reads bounded JSON-LD recipe text and an available publisher dish-image link from allowlisted HTTPS BBC Good Food/Good Food, HelloFresh and Gousto pages, with checked redirects and a timeout. It returns a review draft; it never silently saves or imports arbitrary URLs. Imported recipes retain source attribution. Publisher blocking and pages without recipe metadata produce a manual-entry fallback. Fractional quantities are parsed for scaling, and unrecognised amounts remain review text.

Optional secret `HUB_RECIPE_IMPORT_JSON` accepts a one-time owner-authorized `{batchId, recipes: [{id, data}]}` envelope. It uses the existing transactional bootstrap marker and insert-only IDs, never overwrites household edits, and keeps private recipe content outside Git.


## Broadcast calendar subscriptions

Sources → iCloud calendars now accepts private webcal or HTTPS iCalendar links in Add calendar subscription, separately from the Apple account form. Each member can manage up to 16 subscriptions and select up to 32 iCloud calendars. These limits share one constant module; CalDAV uses a bounded four-request pool so selecting more than eight calendars is supported by the actual reader as well as the form. Family profiles remain configurable.

Use **Find new iCloud calendars** to discover calendars added later using the saved private Apple login. Existing selections, credentials, imports and subscriptions are retained; newly found calendars stay unselected. Missing selected calendars remain labelled as last known until the user removes or reconnects them.

A subscription can be named, assigned to a person, refreshed, given a replacement link or removed. It works without an Apple login. This is a read-only subscription; the publisher owns the events. Sync now remains available, and the owner’s configured hourly task includes their current subscriptions. The source panel shows the last successful refresh and failures; failed or incomplete reads keep the last good events. Replacing a feed does not automatically replace RSB Residential or other selected calendars. Unselect the old source when a migration is ready.

Migration 0005 stores feed URLs only as encrypted per-member credentials using the existing runtime encryption key. Own status lists subscription metadata without returning the URL. Shared records use opaque feed IDs and the existing UID/recurrence contribution model, preserving calendar ownership, multi-day spans and cross-source duplicate handling. Disconnecting an Apple account leaves independent feed subscriptions intact. Subscription URLs are never source links in household state/export and are not logged by application code.

The fetch adapter normalises webcal to HTTPS, forbids URL credentials/nonstandard ports/IP literals/private hostnames, checks public A/AAAA answers before each redirect, and bounds redirects, time, bytes and ICS parsing. It sends no Apple credentials, cookies or referrers. DNS preflight is not connection pinning: Workers cannot pin arbitrary external host resolution, so a DNS-change/TOCTOU limitation remains. This deployment has no private network/VPC bindings. Reassess the network guard before adding such connectivity.

DNS-over-HTTPS calls use `redirect: manual` and require a direct HTTP 200. Workers rejects `redirect: error` before making a request; Node-only fetch fixtures do not detect that incompatibility. The subscription suite includes a real Miniflare runtime regression with in-memory DNS/feed responders and a blocked outbound network. It also checks that DNS redirects remain rejected. Running that runtime test requires permission for local loopback sockets, not access to a live private feed.

The owner-only calendar MCP tools expose only the existing account-scoped status read and safe subscription-add API. Use `bird_hub_read_calendar_connections` before adding a link to avoid duplicates; `bird_hub_add_calendar_subscription` accepts a title, private URL and optional saved profile ID. Private URLs remain encrypted and are never returned in connection metadata or shared records. These tools cannot change task schedules, read another person’s Apple credentials or proxy arbitrary requests.

## Hourly hosted calendar refresh

The shared household reader and calendar import admission use `MAX_HOUSEHOLD_RECORDS` from `shared/record-limits.ts` (15,000 records). Keep these limits aligned when growing the recipe catalogue: the old 2,500-record calendar check incorrectly blocked both Apple and subscription refreshes once recipes passed that count. Calendar source/link/contribution limits remain independent. Admission counts the final deduplicated imported events plus all other records, including manual events without an origin field. It never deletes recipes or trims calendar history to make room. Source-health-only updates can record failures even at the record limit; a failed import must retain its previous events and successful timestamp.

The owner explicitly requested hourly calendar refresh. Reuse the Site-linked hourly task; inspect Sites linked automations before creating or changing it. Keep the news, travel, events, email and dashboard schedules independent, including paused states. No per-browser timer or Mac process provides the hosted refresh.

Each run uses the private Site tools: read the owner’s calendar connections, refresh the selected iCloud account once with `bird_hub_refresh_calendar({source: "icloud"})`, then refresh each current subscription sequentially with `{source: "subscription", subscriptionId}`. The fixed tool calls only the existing authenticated account-scoped APIs; it cannot read another member’s saved credentials or discover/change calendar selections. Verify the actual per-target last-success timestamps after writing. A version conflict may be retried once after re-reading status. Failures preserve last-good events and report connection attention; never invent a success or advance source timestamps manually.

`HUB_CALENDAR_REFRESH_SCHEDULE_JSON` is server-only runtime configuration `{enabled: true, taskId, verifiedAt}` recorded after native Sites confirms the enabled hourly schedule. `verifiedAt` means schedule confirmation, not a successful provider read. The owner’s status shows hourly; another member’s private account remains manual until separately authorized. Shared status reports mixed coverage when appropriate. Keep the environment metadata consistent if the task is later paused or removed, and redeploy the saved version after environment changes. The schedule runs without the Site open or the development Mac online. A saved schedule, a successful one-off hosted refresh and an actual scheduled execution are separate validation facts.

## Cook from my fridge

Recipes → Cook from my fridge is separate from printed-recipe OCR. The printed scanner remains on-device and never uploads its capture. The fridge flow explicitly discloses its AI provider before capture/upload: camera inside the website → temporary JPEG → identify possible ingredients → editable ingredient review → text-only recipe proposal → review missing ingredients → existing recipe editor → explicit Save. No test recipes are preloaded, no generated draft is automatically saved, and no ingredients or meals are automatically written.

The Site calls the single secret-protected `services/recipe-ai` Worker, using Cloudflare Workers AI’s fixed Mistral Small 3.1 vision model. The existing Ryan-owned Cloudflare account hosts this helper; it is not another Site or repository. The Site remains private with the same family audience. The helper’s own request logging, Logpush and previews are disabled; it has no storage bindings, AI Gateway, caches or queues. Configure `HUB_RECIPE_AI_URL` and `HUB_RECIPE_AI_TOKEN` as server-only runtime values in Sites; the matching helper binding uses the same token name. Never put the token in browser code, source, prompts or documentation. The configured URL must be an HTTPS workers.dev `/infer` endpoint with no credentials, query or fragment; requests never follow redirects or forward browser identity/cookies.

Photos are transient processing inputs: no database, object storage, browser persistence, service worker, thumbnail, Photos-library write, download or application logging. Capture bounds are a 1 MiB JPEG and 1280-pixel longest edge; camera tracks, original/scratch canvases, pending fetches and image references are released on success, retake, cancel, error, timeout, hidden page and unmount. Incoming cancellation propagates to the Site and relay, with independent deadlines even if a provider ignores abort. Browser/OS internals are not a forensic-erasure guarantee.

Cloudflare’s [current synchronous inference data policy](https://developers.cloudflare.com/workers-ai/platform/data-usage/) states that ordinary content is not retained after the response or used for training, subject to legal/security exceptions and separate operational metadata. This disclosure is visible before upload and acknowledged by the explicit Read ingredients action. Do not switch providers, enable AI Gateway/logging or add persistent image handling without reviewing this policy again.

Vision does not establish exact quantities, expiry, freshness or allergen safety. Identification is flagged as uncertain; names and amounts are editable. Recipe quantities and instructions are proposals. The server conservatively adds draft ingredients that do not match the reviewed list to the missing-ingredient review, even when the model omits them. Unknown food aliases/quantity conversions are not silently inferred. Servings are bounded to 1–12. Only reviewed recipe fields are saved through the existing endpoint.

Migration `0006_soft_alex_power.sql` adds only a household daily usage counter. Atomic D1 operations cap total recognition/suggestion attempts at 20 per London day, including failed provider attempts; the counter contains no photos, ingredients or recipe text. Existing household data and migrations remain untouched. There is no new task or paid-plan upgrade for AI. Existing Cloudflare free allowance is shared account-wide and is not guaranteed by this feature’s cap; see the helper README for current pricing and bounds.

Fridge tests cover authenticated membership/origin, malformed/oversized JPEGs, transient capture lifecycle, stale callbacks, cancelled and stalled inference, response validation, exact servings, missing ingredients, shared quota and no hidden saves. Mocked fixtures are distinct from live provider tests and physical camera/device checks. A fixed owner-only MCP operation exposes the same status/identify/suggest flow to the private assistant; its larger request limit applies only to a bounded photo-identification call. It never saves the image or a recipe automatically.

## Large cookbook catalog and country browsing

Recipe indexes return compact text metadata and ingredient counts; a signed-in household member opens a full recipe through `GET /api/items/:id`. The cookbook progressively renders 24 cards at a time, preserving the existing serving, meal-snapshot and shopping-import behavior without preloading every method. `collection` retains the book or import source. `countryCodes` contains explicit uppercase ISO alpha-2 culinary associations; uncertain origin stays unassigned.

A large owner-authorized migration may be staged as gzip-compressed base64 text across secret runtime values `HUB_RECIPE_CATALOG_01` through `HUB_RECIPE_CATALOG_64`, with `HUB_RECIPE_CATALOG_PARTS` declaring the exact count. Decompression is bounded at 8 MB and 10,000 entries. Owner API reads import at most two 40-recipe chunks per request through the existing transactional bootstrap markers. Completed chunks are never replayed, so deleted recipes stay deleted and edits survive later reads. Imported content, video frames and cookbook originals remain outside Git. This is an explicit one-time migration, not an external schedule.

## Dish-thumbnail imports and cleanup

Every recipe batch includes available source dish pictures. Keep original user files in place, extract only the dish image, strip metadata and encode WebP without upscaling (max480px; target25KB, hard40KB). Match photos to the exact recipe and keep missing photos empty. Content-addressed private R2 objects deduplicate identical pictures across recipes. D1 stores only references and dimensions. Lists lazy-load pictures and recipes with no picture keep their existing fallback. Publisher recipe-link imports retain an allowlisted small dish-image URL; no external scripts or source pages are embedded. Camera/OCR and fridge captures remain transient and are never retained as thumbnails automatically.

For an owner-authorized bulk backfill, configure the temporary `HUB_RECIPE_PHOTO_IMPORT_TOKEN` server secret, upload only validated thumbnails to the scoped migration endpoint, and verify stored-object hashes and recipe mapping receipts. Remove the temporary secret after verification. Never commit import data or images. Delete redundant task-specific local copies, extracted frames, generated archives and ChatGPT transfer artifacts only after successful text/photo readback; preserve the website originals, user's source files, application source and dependencies. Future batches use this same workflow and duplicate checks before import.
