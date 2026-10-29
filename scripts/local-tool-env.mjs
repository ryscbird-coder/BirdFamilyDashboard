import path from 'node:path';
process.env.WRANGLER_LOG_PATH ??= path.resolve('.wrangler/logs');
process.env.XDG_CONFIG_HOME ??= path.resolve('.sites-runtime/config');
process.env.WRANGLER_SEND_METRICS ??= 'false';
process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
