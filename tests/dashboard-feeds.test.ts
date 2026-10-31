import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardFeed } from '../app/dashboard-feeds.ts';

const feed = (id: string, workflow: string, sourceId: string, title: string, observedAt = '2026-10-31T08:00:00Z') => ({ id, workflow, sourceId, title, observedAt, body: `Synthetic saved report ${id}` });

test('a newer Bella dashboard cannot replace Ryan’s saved overview', () => {
  const ryan = feed('ryan', 'Daily Ryan Dashboard', 'ryan-dashboard-local', 'Ryan’s daily dashboard');
  const bella = feed('bella', 'Daily Bella Dashboard', 'bella-dashboard-daily', 'Bella’s daily dashboard', '2026-10-31T09:00:00Z');
  const records = Object.freeze([Object.freeze(ryan), Object.freeze(bella)]);
  assert.equal(dashboardFeed(records, 'ryan'), ryan);
  assert.equal(dashboardFeed(records, 'bella'), bella);
  assert.deepEqual(records.map(record => record.id), ['ryan', 'bella']);
});

test('stable Bella writer aliases identify their owner even when a report title is generic or copied', () => {
  for (const sourceId of ['bella-dashboard-daily', 'daily_bella_dashboard', 'DAILY_BELLA_DASHBOARD']) {
    const report = feed('bella', 'Existing assistant workflow', sourceId, 'Ryan dashboard title awaiting correction');
    assert.equal(dashboardFeed([report], 'bella'), report);
    assert.equal(dashboardFeed([report], 'ryan'), undefined);
  }
});

test('Bella and Gabriella labels are recognised across workflow and title spellings', () => {
  for (const report of [
    feed('bella-title', 'Existing workflow', 'opaque-source', 'Daily — Bella Dashboard'),
    feed('gabriella-workflow', 'Daily_Gabriella_Dashboard', 'opaque-source', 'Today’s priorities'),
    feed('bella-camel', 'dailyBellaDashboard', 'opaque-source', 'Today’s priorities'),
  ]) {
    assert.equal(dashboardFeed([report], 'bella'), report);
    assert.equal(dashboardFeed([report], 'ryan'), undefined);
  }
});

test('the legacy unnamed daily and weekly dashboards still belong to Ryan', () => {
  for (const report of [
    feed('legacy-daily', 'daily_dashboard', 'dashboard-local', 'Daily overview'),
    feed('legacy-weekly', 'Weekly - Dashboard', 'dashboard-local', 'Weekly overview'),
    feed('named-ryan', 'Existing workflow', 'ryan_dashboard_local', 'Verified overview'),
  ]) {
    assert.equal(dashboardFeed([report], 'ryan'), report);
    assert.equal(dashboardFeed([report], 'bella'), undefined);
  }
});

test('unrelated news, travel and email reports are never selected as a dashboard', () => {
  const records = [
    feed('news', 'Morning News Briefing', 'news-daily', 'Daily news'),
    feed('travel', 'Daily Family Travel Deals', 'travel-daily', 'Bella’s travel update'),
    feed('email', 'Daily email organisation', 'email-daily', 'Ryan’s organised inbox'),
    feed('generic', 'Existing workflow', 'unrelated-source', 'Household dashboard'),
  ];
  assert.equal(dashboardFeed(records, 'ryan'), undefined);
  assert.equal(dashboardFeed(records, 'bella'), undefined);
});

test('latest dashboard follows actual timestamps including timezone offsets and ignores unreadable dates', () => {
  const early = feed('early', 'Daily Bella Dashboard', 'bella-dashboard-daily', 'Earlier report', '2026-10-31T09:00:00+01:00');
  const later = feed('later', 'Daily Bella Dashboard', 'daily_bella_dashboard', 'Later report', '2026-10-31T08:30:00Z');
  const invalid = feed('invalid', 'Daily Bella Dashboard', 'bella-dashboard-daily', 'Unverified date', 'not-a-date');
  assert.equal(dashboardFeed([invalid, later, early], 'bella'), later);
});

test('canonical Bella source breaks equal-time ties while a newer labelled report still wins', () => {
  const labelled = feed('labelled', 'Daily Bella Dashboard', 'older-bella-workflow', 'Bella dashboard');
  const canonical = feed('canonical', 'Daily Bella Dashboard', 'bella-dashboard-daily', 'Bella dashboard');
  assert.equal(dashboardFeed([labelled, canonical], 'bella'), canonical);
  const newer = { ...labelled, observedAt: '2026-10-31T09:00:00Z' };
  assert.equal(dashboardFeed([canonical, newer], 'bella'), newer);
});

test('empty or unmatched input returns undefined without inventing a report', () => {
  assert.equal(dashboardFeed([], 'ryan'), undefined);
  assert.equal(dashboardFeed([], 'bella'), undefined);
  assert.equal(dashboardFeed([feed('unknown', 'Existing workflow', 'unknown', 'Awaiting first result')], 'bella'), undefined);
});
