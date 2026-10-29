type SourceHealthData = {
  lastSuccess?: unknown;
  observedAt?: unknown;
  runStatus?: unknown;
  schedulePaused?: unknown;
  nextRunAt?: unknown;
};

export function sourceIsPaused(data: SourceHealthData): boolean {
  return data.schedulePaused === true || data.runStatus === "paused";
}

/** Presentation groups preserve each source and its saved execution settings. */
export function groupSources<T extends { data: SourceHealthData }>(sources: readonly T[]): { active: T[]; paused: T[] } {
  const active: T[] = [];
  const paused: T[] = [];
  for (const source of sources) (sourceIsPaused(source.data) ? paused : active).push(source);
  return { active, paused };
}

function reportedTime(value: unknown, now: number): number | undefined {
  if (typeof value !== "string") return undefined;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && instant <= now + 300000 ? instant : undefined;
}

function elapsed(instant: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - instant) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}

/** A source observation or receiver setting is not evidence of a successful check. */
export function sourceHealthLabel(data: SourceHealthData, now: number): string {
  if (sourceIsPaused(data)) return "Paused";
  const observed = reportedTime(data.observedAt, now);
  const success = reportedTime(data.lastSuccess, now);
  const observationAge = observed === undefined ? "" : ` · ${elapsed(observed, now)}`;
  if (data.runStatus === "error") return `Check needs attention${observationAge}`;
  if (data.runStatus === "stale" && observed !== undefined) return `Partial report${observationAge}`;
  if (success !== undefined) return `Report checked · ${elapsed(success, now)}`;
  if (observed !== undefined) return `Status reported${observationAge}`;
  if (typeof data.nextRunAt === "string" && Number.isFinite(Date.parse(data.nextRunAt)) && Date.parse(data.nextRunAt) > now) return "Awaiting first report";
  return "No successful report received";
}
