"use client";

import React, { useEffect, useRef, useState } from "react";

export type CalendarProfile = { id: string; data: { name?: string; color?: string; [field: string]: any } };
export type ICloudSetupProps = {
  profiles: CalendarProfile[];
  canManageHousehold: boolean;
  onRefresh: () => Promise<boolean>;
};
type CalendarChoice = {
  id: string;
  displayName: string;
  color?: string;
  calendarKey: string;
  personId: string | null;
  sharedCalendarId: string;
  version: number;
};
type HouseholdCalendar = {
  calendarKey: string;
  sharedCalendarId: string;
  displayName: string;
  color?: string;
  personId: string | null;
  personName?: string;
  ownerIsMe: boolean;
  version: number;
};
type ICloudStatus = {
  scope: "self";
  canConnect: boolean;
  configured: boolean;
  username?: string;
  calendars: CalendarChoice[];
  selectedCalendarIds: string[];
  householdCalendars: HouseholdCalendar[];
  lastSuccess?: string;
  lastAttempt?: string;
  status: "unconfigured" | "configured" | "ready" | "error";
  error?: string;
  revision?: number;
};
type MappingDraft = { personId: string; sharedCalendarId: string };
const RESTORE_OWN_IDENTITY = "__restore_own_calendar__";
const TZ = "Europe/London";
function formatDate(iso: string) { return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)); }
function time(iso: string) { return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
function freshness(iso?: string) { const elapsed = Date.now() - Date.parse(iso || ""); return !Number.isFinite(elapsed) || elapsed < -300000 ? "grey" : elapsed <= 3600000 ? "green" : elapsed <= 86400000 ? "yellow" : "red"; }
function Icon({ name, size = 16 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === "arrow" ? <path d="m9 5 7 7-7 7"/> : <path d="M20 8a9 9 0 1 0 0 9M20 3v6h-6"/>}</svg>; }

/** Actor-scoped account form. Passwords live only in the input and transient request body. */
export default function ICloudSetup({ profiles, canManageHousehold, onRefresh }: ICloudSetupProps) {
  const [status, setStatus] = useState<ICloudStatus | null>(null);
  const [username, setUsername] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MappingDraft>>({});
  const [householdDrafts, setHouseholdDrafts] = useState<Record<string, MappingDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");
  const [requestError, setRequestError] = useState("");
  const [changingAccount, setChangingAccount] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [removeImported, setRemoveImported] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const operationBusy = useRef(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const readStatus = async (signal?: AbortSignal, preserveOwnDrafts = false) => {
    const response = await fetch("/api/icloud/status", { credentials: "same-origin", cache: "no-store", signal });
    const result: any = await response.json();
    if (!response.ok) throw new Error(result.error?.message || result.error || "Your iCloud connection status could not be loaded.");
    const next: ICloudStatus = { ...result, calendars: result.calendars || [], selectedCalendarIds: result.selectedCalendarIds || [], householdCalendars: result.householdCalendars || [] };
    if (mounted.current) {
      setStatus(next); setUsername(next.username || "");
      if (!preserveOwnDrafts) { setSelection(next.selectedCalendarIds); setDrafts(Object.fromEntries(next.calendars.map(calendar => [calendar.id, { personId: calendar.personId || "", sharedCalendarId: calendar.sharedCalendarId }]))); }
      setHouseholdDrafts(Object.fromEntries(next.householdCalendars.map(calendar => [calendar.calendarKey, { personId: calendar.personId || "", sharedCalendarId: calendar.sharedCalendarId }])));
    }
    return next;
  };
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController(); controller.current = abort;
    void readStatus(abort.signal).catch(error => { if (mounted.current && error.name !== "AbortError") setRequestError(error.message); }).finally(() => { if (mounted.current) setLoading(false); });
    const clearHiddenPassword = () => { if (document.visibilityState !== "visible" && passwordInput.current) passwordInput.current.value = ""; };
    document.addEventListener("visibilitychange", clearHiddenPassword);
    return () => { mounted.current = false; controller.current?.abort(); document.removeEventListener("visibilitychange", clearHiddenPassword); if (passwordInput.current) passwordInput.current.value = ""; };
  }, []);

  const requestJson = async (path: string, method: string, requestBody: string, signal: AbortSignal) => {
    const pending = fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: requestBody, cache: "no-store", signal });
    requestBody = "";
    const response = await pending;
    const result: any = await response.json();
    if (!response.ok) throw new Error(result.error?.message || result.error || "The iCloud change could not be completed.");
    return result;
  };
  const operate = async (action: string, success: string, operation: (signal: AbortSignal) => Promise<void>) => {
    if (operationBusy.current) return false;
    operationBusy.current = true; controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 60000);
    setBusyAction(action); setRequestError(""); setMessage("");
    try {
      await operation(abort.signal);
      await readStatus(abort.signal, action === "mapping");
      await refreshRef.current();
      if (mounted.current) setMessage(success);
      return true;
    } catch (error: any) {
      if (mounted.current) setRequestError(error.name === "AbortError" ? "The request was interrupted or timed out. Refresh saved status before retrying; the server may have completed part of the change. No successful sync is being claimed." : error.message || "The change failed. Refresh saved status before retrying.");
      return false;
    } finally {
      clearTimeout(timeout); operationBusy.current = false;
      if (passwordInput.current) passwordInput.current.value = "";
      if (mounted.current) setBusyAction("");
    }
  };
  const connect = (event: React.FormEvent) => {
    event.preventDefault(); if (operationBusy.current || !passwordInput.current?.value) return;
    let encoded = JSON.stringify({ username: username.trim(), password: passwordInput.current.value });
    passwordInput.current.value = "";
    void operate("connect", "Your Apple account was verified. Choose the calendars you want to share below.", async signal => {
      const pending = requestJson("/api/icloud/connect", "POST", encoded, signal); encoded = ""; await pending;
    }).then(ok => { if (ok && mounted.current) setChangingAccount(false); });
    encoded = "";
  };
  const saveAndSync = async () => {
    if (!status || operationBusy.current) return;
    const chosen = [...selection];
    const settings = status.calendars.filter(calendar => chosen.includes(calendar.id)).map(calendar => ({ calendar, draft: { ...(drafts[calendar.id] || { personId: calendar.personId || "", sharedCalendarId: calendar.sharedCalendarId }) } }));
    await operate("sync", chosen.length ? "Your selected calendars and person assignments were saved, then synced from Apple." : "Your calendars are no longer shared from this connection. Other family connections and manual events were kept.", async signal => {
      for (const { calendar, draft } of settings) {
        if (draft.personId !== (calendar.personId || "") || draft.sharedCalendarId !== calendar.sharedCalendarId) {
          await requestJson("/api/icloud/calendar-settings", "POST", JSON.stringify({ calendarId: calendar.id, personId: draft.personId || null, version: calendar.version, sharedCalendarId: draft.sharedCalendarId === RESTORE_OWN_IDENTITY ? null : draft.sharedCalendarId }), signal);
        }
      }
      await requestJson("/api/icloud/calendars", "POST", JSON.stringify({ calendarIds: chosen }), signal);
      if (chosen.length) await requestJson("/api/icloud/sync", "POST", "{}", signal);
    });
  };
  const saveHouseholdMapping = async (calendar: HouseholdCalendar) => {
    const draft = householdDrafts[calendar.calendarKey]; if (!draft) return;
    await operate("mapping", "The household calendar’s person assignment was saved. Its private account credentials were not changed.", async signal => {
      await requestJson(`/api/icloud/calendar-mappings/${encodeURIComponent(calendar.calendarKey)}`, "POST", JSON.stringify({ personId: draft.personId || null, version: calendar.version, sharedCalendarId: draft.sharedCalendarId === RESTORE_OWN_IDENTITY ? null : draft.sharedCalendarId }), signal);
    });
  };
  const disconnect = async () => {
    const ok = await operate("disconnect", removeImported ? "Your connection and events supplied only by it were removed. Other family connections and manual events were kept." : "Your saved Apple credentials were removed. The last imported events were kept.", async signal => {
      await requestJson("/api/icloud/config", "DELETE", JSON.stringify({ removeImported }), signal);
    });
    if (ok && mounted.current) { setConfirmDisconnect(false); setChangingAccount(false); setRemoveImported(false); }
  };

  if (loading) return <p className="subtle" role="status">Checking your private iCloud connection…</p>;
  const busy = !!busyAction;
  const configured = !!status?.configured;
  const sharedChoices = Array.from(new Map((status?.householdCalendars || []).map(calendar => [calendar.sharedCalendarId, calendar])).values());
  const otherMappings = (status?.householdCalendars || []).filter(calendar => !calendar.ownerIsMe || !status?.calendars.some(own => own.calendarKey === calendar.calendarKey));
  const updateDraft = (calendarId: string, patch: Partial<MappingDraft>) => setDrafts(current => ({ ...current, [calendarId]: { ...current[calendarId], ...patch } }));
  const updateHouseholdDraft = (calendarKey: string, patch: Partial<MappingDraft>) => setHouseholdDrafts(current => ({ ...current, [calendarKey]: { ...current[calendarKey], ...patch } }));
  const personOptions = <><option value="">Shared / unassigned</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.data.name}</option>)}</>;
  const sharingOptions = (currentId: string) => <><option value={currentId}>Keep the current calendar link</option>{sharedChoices.filter(calendar => calendar.sharedCalendarId !== currentId).map(calendar => <option key={calendar.sharedCalendarId} value={calendar.sharedCalendarId}>Same calendar as {calendar.displayName}{calendar.personName ? ` · ${calendar.personName}` : ""}</option>)}<option value={RESTORE_OWN_IDENTITY}>Keep as a separate calendar</option></>;

  return <div className="icloud-setup">
    <p className="form-note">This is your private Apple connection. Other family members connect their own accounts here after signing in; your account does not replace theirs.</p>
    {configured && <><div className="setup-status"><span className={`status-dot ${freshness(status?.lastSuccess)}`}/><span>{status?.status === "error" ? "Your latest iCloud check needs attention." : status?.lastSuccess ? "Your last verified calendar sync is available." : "Your Apple account is verified. Calendar sync is pending."}</span></div><p className="subtle">Your Apple account: <strong>{status?.username}</strong></p></>}
    {(!configured || changingAccount) && <form className="icloud-connect-form" onSubmit={connect} autoComplete="off"><p className="subtle">Connect your own Apple account using an <strong>app-specific password</strong>, never your main Apple password.</p><label className="field">Your Apple ID email<input type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={event => setUsername(event.target.value)} maxLength={320} required disabled={busy}/></label><label className="field">Your Apple app-specific password<input ref={passwordInput} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} placeholder="xxxx-xxxx-xxxx-xxxx" required disabled={busy} maxLength={100}/></label><p className="form-note">Sent privately to this Site and stored encrypted on the server for read-only calendar access. The input clears as soon as you submit, when the tab hides, and when this form closes. The hub does not save it in browser storage. Do not paste it into chat.</p><a className="panel-link" href="https://support.apple.com/en-us/102654" target="_blank" rel="noreferrer">Apple: create an app-specific password <Icon name="arrow" size={13}/></a><p className="form-note">Apple two-factor authentication is required. Create the app password in Apple Account → Sign-In and Security → App-Specific Passwords.</p><div className="actions"><button className="button primary" type="submit" disabled={busy || status?.canConnect === false}>{busyAction === "connect" ? "Testing your Apple connection…" : "Test & connect my account"}</button>{configured && <button className="button ghost" type="button" disabled={busy} onClick={() => { if (passwordInput.current) passwordInput.current.value = ""; setChangingAccount(false); }}>Cancel</button>}</div></form>}
    {configured && !changingAccount && <>
      <div className="icloud-calendar-list"><h3>Choose up to eight of your calendars</h3><p className="form-note">Select the calendars you want to share, then assign each to a family profile or leave it shared. Shared events appear once, even when more than one of you connects the calendar.</p>
        {status?.calendars.length ? status.calendars.map(calendar => {
          const selected = selection.includes(calendar.id);
          const draft = drafts[calendar.id] || { personId: calendar.personId || "", sharedCalendarId: calendar.sharedCalendarId };
          return <section className="icloud-calendar-mapping" key={calendar.id}>
            <label className="icloud-calendar-choice check-row"><input type="checkbox" checked={selected} disabled={busy || (!selected && selection.length >= 8)} onChange={event => setSelection(current => event.target.checked ? [...current, calendar.id] : current.filter(id => id !== calendar.id))}/><span className="person-dot" style={{ background: calendar.color || "#78d3ef" }}/><span>{calendar.displayName}</span></label>
            {selected && <div className="icloud-calendar-settings"><label className="field">Person for {calendar.displayName}<select value={draft.personId} disabled={busy} onChange={event => updateDraft(calendar.id, { personId: event.target.value })}>{personOptions}</select></label><label className="field">Already shared in the hub?<select value={draft.sharedCalendarId} disabled={busy} onChange={event => updateDraft(calendar.id, { sharedCalendarId: event.target.value })}>{sharingOptions(calendar.sharedCalendarId)}</select></label></div>}
          </section>;
        }) : <p className="subtle">No calendars were returned by your account check.</p>}
      </div>
      {!profiles.length && <p className="form-note">Add family profiles in Settings to make person assignments available. Shared / unassigned still works.</p>}
      <p className="form-note">Choose an existing calendar here only if it is the same shared calendar. Otherwise keep it separate. This does not change anything in Apple Calendar.</p>
      <div className="actions"><button className="button primary" disabled={busy} onClick={() => void saveAndSync()}><Icon name="refresh" size={15}/>{busyAction === "sync" ? "Saving choices & syncing…" : selection.length ? "Save choices & sync my calendars" : "Stop sharing my calendars"}</button><button className="button ghost small" disabled={busy} onClick={() => setChangingAccount(true)}>Change my Apple account</button></div>
      <p className="form-note" style={{ marginTop: 14 }}>Read-only manual sync covers the previous 30 days and next 180 days. Changing or disconnecting your account leaves other family members’ private connections intact. Shared events remain when another selected connection still supplies them.</p>
      <dl className="source-facts"><dt>Your last successful calendar sync</dt><dd>{status?.lastSuccess ? `${formatDate(status.lastSuccess)} at ${time(status.lastSuccess)} London time` : "No successful calendar sync yet"}</dd>{status?.lastAttempt && <><dt>Your last connection / sync attempt</dt><dd>{formatDate(status.lastAttempt)} at {time(status.lastAttempt)} London time</dd></>}</dl><button className="panel-link danger" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Disconnect my Apple account</button>
    </>}
    {canManageHousehold && otherMappings.length > 0 && <section className="icloud-household-mappings"><h3>Household calendar assignments</h3><p className="form-note">These selected calendars are already shared with the household. As owner, you can change their person labels and shared calendar links without seeing or changing anyone else’s Apple credentials.</p>{otherMappings.map(calendar => {
      const draft = householdDrafts[calendar.calendarKey] || { personId: calendar.personId || "", sharedCalendarId: calendar.sharedCalendarId };
      const changed = draft.personId !== (calendar.personId || "") || draft.sharedCalendarId !== calendar.sharedCalendarId;
      return <section className="icloud-calendar-mapping" key={calendar.calendarKey}><h4>{calendar.displayName}</h4><label className="field">Person<select value={draft.personId} disabled={busy} onChange={event => updateHouseholdDraft(calendar.calendarKey, { personId: event.target.value })}>{personOptions}</select></label><label className="field">Already shared in the hub?<select value={draft.sharedCalendarId} disabled={busy} onChange={event => updateHouseholdDraft(calendar.calendarKey, { sharedCalendarId: event.target.value })}>{sharingOptions(calendar.sharedCalendarId)}</select></label><button className="button ghost small" disabled={busy || !changed} onClick={() => void saveHouseholdMapping(calendar)}>Save this calendar’s assignment</button></section>;
    })}</section>}
    {confirmDisconnect && <div className="notice warning"><strong>Disconnect your iCloud account?</strong><p>This deletes only your saved encrypted Apple credentials. Other family connections and manual Hub events are kept.</p><label className="icloud-calendar-choice check-row"><input type="checkbox" checked={removeImported} disabled={busy} onChange={event => setRemoveImported(event.target.checked)}/><span>Also remove events supplied only by my connection</span></label><div className="actions"><button className="button danger" disabled={busy} onClick={() => void disconnect()}>{busyAction === "disconnect" ? "Disconnecting…" : "Disconnect my account & remove credentials"}</button><button className="button ghost" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Keep connected</button></div></div>}
    {busyAction && <p className="form-note" role="status">{busyAction === "connect" ? "Testing your credentials with Apple before saving anything…" : busyAction === "sync" ? "Saving your choices, then reading your selected Apple calendars…" : busyAction === "mapping" ? "Saving household calendar labels; private credentials are unchanged…" : "Removing your private connection…"}</p>}
    {(requestError || status?.error) && <p className="error-text" role="alert">{requestError || status?.error}</p>}
    {message && <p className="notice success" role="status">{message}</p>}
    <button className="panel-link" disabled={busy} onClick={() => { setRequestError(""); void readStatus().then(() => refreshRef.current()).catch(error => setRequestError(error.message)); }}>Refresh my saved connection status <Icon name="refresh" size={13}/></button>
  </div>;
}
