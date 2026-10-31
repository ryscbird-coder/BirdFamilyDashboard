export interface DashboardFeed {
  workflow?: string;
  sourceId?: string;
  title?: string;
  observedAt?: string;
}

const words = (value: string | undefined) => (value || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const bellaSources = new Set(['bella dashboard daily', 'daily bella dashboard']);
const canonicalBellaSource = (feed: DashboardFeed) => bellaSources.has(words(feed.sourceId));

function dashboardOwner(feed: DashboardFeed): 'ryan' | 'bella' | undefined {
  // A fixed writer identity takes precedence over a report's editable title.
  if (canonicalBellaSource(feed)) return 'bella';
  const label = words(`${feed.workflow || ''} ${feed.sourceId || ''} ${feed.title || ''}`);
  if (!/\bdashboard\b/.test(label)) return undefined;
  if (/\b(?:bella|gabriella)\b/.test(label)) return 'bella';
  // Retain the original daily/weekly household dashboard without assigning news
  // or travel feeds to Ryan merely because they run each day.
  if (/\b(?:ryan|daily|weekly)\b/.test(label)) return 'ryan';
  return undefined;
}

const observedTime = (feed: DashboardFeed) => {
  const value = typeof feed.observedAt === 'string' ? Date.parse(feed.observedAt) : NaN;
  return Number.isFinite(value) ? value : -Infinity;
};

/** Select a person's latest saved dashboard without rewriting or reordering feeds. */
export function dashboardFeed<T extends DashboardFeed>(feeds: readonly T[], person: 'ryan' | 'bella'): T | undefined {
  let latest: T | undefined;
  for (const feed of feeds) {
    if (dashboardOwner(feed) !== person) continue;
    if (!latest || observedTime(feed) > observedTime(latest) ||
      (observedTime(feed) === observedTime(latest) && canonicalBellaSource(feed) && !canonicalBellaSource(latest))) latest = feed;
  }
  return latest;
}
