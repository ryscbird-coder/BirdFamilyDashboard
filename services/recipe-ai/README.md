# Private recipe AI relay

This separate Cloudflare Worker supplies synchronous image understanding and text recipe proposals to the private Bird Family Hub Site. It uses the existing Cloudflare account and does not create another Site, schedule, database or storage bucket.

## Contract

Only the Sites server calls this relay. Configure the returned HTTPS `/infer` URL and a shared random `HUB_RECIPE_AI_TOKEN` as Sites runtime secrets. Bind the same token as `secret_text` and bind Workers AI as `AI` in the relay. Tokens never enter browser bundles or this repository.

Authenticated `GET /health` performs no inference. Authenticated `POST /infer` accepts exactly these operations:

```json
{"operation":"recognize","image":{"mimeType":"image/jpeg","base64":"<transient base64 JPEG>"}}
```

It returns `ingredients: [{name,amount?,unit?,uncertain,note?}]` and `warnings: string[]`.

```json
{"operation":"suggest","ingredients":[{"name":"Carrot","amount":200,"unit":"g","uncertain":false}],"servings":2,"preferences":"A simple soup"}
```

It returns a proposed `draft` containing normal recipe fields, `missingIngredients`, and `warnings`. Each proposed draft ingredient requires a positive numeric `amount`; its unit is a concrete measure or `count` for whole items. These new recipe quantities are proposals, distinct from optional photograph quantities (which require readable label evidence). Reviewed names are preserved; preparation such as juicing belongs in the method, and reviewed ingredients are excluded from the missing list. It never saves recipes or meal plans. `identify` is an alias for `recognize`.

The fixed model is `@cf/mistralai/mistral-small-3.1-24b-instruct`, using native Workers AI messages with a JPEG data URI and `response_format: {type: "json_schema", json_schema: schema}`. Cloudflare currently resolves that public model identifier to `@cf/mistralai/mistral-small-3.1-24b-v2`. The [current JSON Mode documentation](https://developers.cloudflare.com/workers-ai/features/json-mode/) and a controlled live text probe establish this format; the model schema endpoint still lists the older `guided_json` field, which the live endpoint ignored. Both structured-object and JSON-text responses are byte bounded and independently validated. There is no selectable provider, arbitrary model, remote image fetch, tool execution or URL proxy. The Site requires editable ingredient/recipe review.

## Privacy

Photo bytes exist only in the incoming request and synchronous AI input. There is no KV, R2, D1, queue, cache, analytics, AI Gateway or application logging in this Worker. HTTP responses are private/no-store. Body buffers and image references are released after success/failure/cancellation. Browser/OS/provider internals are not a forensic-erasure guarantee.

Cloudflare's [Workers AI data policy](https://developers.cloudflare.com/workers-ai/platform/data-usage/) (checked 29 October 2026) states that standard synchronous inference does not retain Customer Content after processing and response delivery, and content is not used for training. Legal/security exceptions and operational metadata are separate. Enabling stateful features, AI Gateway logging/caching, storage or another provider would change this behavior and requires a fresh review.

## Bounds and costs

JPEGs are limited to 1 MiB and a 1280-pixel longest edge. Recognition is capped at 1000 output tokens; a recipe proposal at 2200. Input text/array sizes are bounded (30 photographed ingredients, up to 40 reviewed recipe ingredients). A 40-second deadline settles the request even if a provider ignores the accompanying AbortSignal. `rejectIfBusy` avoids queue waiting; there are no automatic retries. The Site applies the durable household quota of 20 inference calls/day before invoking this relay; the token is server-only.

[Current Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) includes 10,000 Neurons/day on Free and Paid. Free stops at its daily allowance; an existing Paid plan bills usage above it. This app's limits bound its use, but are not an account-wide spending cap and cannot reserve the shared free allocation. Do not purchase/upgrade a plan or create subscriptions for this feature. Account billing could not be read through the current OAuth scope; account settings alone do not prove a paid plan.

## Deployment

Keep one script named `bird-family-hub-recipe-ai`; inspect the account Workers list before creating another. Upload `worker.mjs` using native Cloudflare API multipart upload metadata:

```json
{
  "main_module":"worker.mjs",
  "compatibility_date":"2026-10-29",
  "compatibility_flags":["nodejs_compat"],
  "bindings":[
    {"type":"ai","name":"AI"},
    {"type":"secret_text","name":"HUB_RECIPE_AI_TOKEN","text":"<session-held secret>"}
  ],
  "observability":{"enabled":false},
  "logpush":false
}
```

The module part uses `Content-Type: application/javascript+module`. Enable only this script's workers.dev route using the supported subdomain API with previews disabled. Keep secrets in native structured arguments/session memory, never shell arguments or source. Verify authenticated health, then explicitly authorized synthetic-image inference; unauthenticated requests must fail. Do not claim live vision based on unit fixtures.

Run local mocked contract tests with `node services/recipe-ai/worker.test.mjs`. They exercise auth, server-only access, bounds, fixed-model/schema calls, response validation, safe errors, health and cancellation without external inference or charges.
