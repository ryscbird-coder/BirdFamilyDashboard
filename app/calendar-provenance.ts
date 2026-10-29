type CalendarSourceData = { origin?: string; calendarId?: string; calendarIds?: string[] };

/** Subscription IDs are opaque; private publisher addresses never reach the view. */
export function calendarSourceBadge(data: CalendarSourceData): string {
  if (data.origin !== 'icloud') return 'Hub';
  const ids = [...new Set([data.calendarId, ...(data.calendarIds || [])].filter((id): id is string => !!id))];
  const subscribed = ids.some(id => id.startsWith('feed_'));
  const apple = ids.some(id => !id.startsWith('feed_'));
  return subscribed ? apple ? 'Apple + subscribed' : 'Subscribed' : 'Apple';
}

export function calendarSourceDescription(data: CalendarSourceData): string {
  const label = calendarSourceBadge(data);
  return label === 'Subscribed' ? 'Subscribed calendar' : label === 'Apple + subscribed' ? 'Apple Calendar and subscribed calendar' : label === 'Apple' ? 'Apple Calendar' : 'Bird Family Hub';
}

export function calendarReadOnlyHelp(data: CalendarSourceData): string {
  const label = calendarSourceBadge(data);
  return label === 'Subscribed'
    ? 'This is a read-only calendar subscription. Change the event at its publisher, then refresh the subscription in Sources.'
    : label === 'Apple + subscribed'
      ? 'This shared event comes from Apple Calendar and a subscription. Edit it at the original provider, then refresh its sources.'
      : 'This is a read-only iCloud import. Edit the original in Apple Calendar, then sync the iCloud source to bring its updates here.';
}
