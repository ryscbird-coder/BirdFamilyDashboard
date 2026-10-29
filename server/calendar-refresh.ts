/** Native Sites schedule metadata. Confirmation is not evidence of a successful calendar read. */
export function calendarRefreshSchedule(raw: string | undefined): { taskId: string; verifiedAt: string } | undefined {
  if (!raw || raw.length > 2000) return;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || value.enabled !== true || typeof value.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value.taskId) || typeof value.verifiedAt !== 'string') return;
    const confirmed = Date.parse(value.verifiedAt);
    if (!Number.isFinite(confirmed) || confirmed > Date.now() + 300_000) return;
    return { taskId: value.taskId, verifiedAt: new Date(confirmed).toISOString() };
  } catch { return; }
}

export function ownCalendarRefresh(raw: string | undefined, actorId: string, ownerId: string | undefined) {
  const schedule = calendarRefreshSchedule(raw);
  return schedule && actorId === ownerId
    ? { enabled: true, scope: 'self' as const, intervalMinutes: 60 as const, verifiedAt: schedule.verifiedAt }
    : { enabled: false, scope: 'self' as const };
}
