"use client";

import React, { useMemo, useRef, useState } from "react";
import { TASK_PERIODS, londonTaskDay, taskCompletedToday, taskIsForToday, taskPeriod } from "../shared/family-tasks";
import "./family-tasks.css";

type Item = { id: string; kind: string; data: Record<string, any>; version: number; createdAt: string; updatedAt: string };
type Props = {
  tasks: Item[];
  profiles: Item[];
  today: string;
  busy: boolean;
  onAdd: (initial: Record<string, any>) => void;
  onComplete: (item: Item, done: boolean) => Promise<void> | void;
  onEdit: (item: Item) => void;
  onAddPerson: () => void;
};

const UNASSIGNED = "__family_unassigned__";
const isRecurring = (item: Item) => ["daily", "weekly", "monthly"].includes(item.data.repeat);
const dayLabel = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(new Date(value + "T12:00:00Z"));
const readableDate = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" }).format(new Date(value));
};

function Plus() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>; }
function PeriodIcon({ id }: { id: string }) {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">{id === "night" ? <path d="M19.5 15.5A8.5 8.5 0 0 1 8.5 4.5a8.5 8.5 0 1 0 11 11Z"/> : id === "morning" ? <><path d="M3 17h18M6 17a6 6 0 0 1 12 0M12 3v3M4 8l2 2m14-2-2 2"/></> : <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>}</svg>;
}

function Progress({ tasks, today, label }: { tasks: Item[]; today: string; label: string }) {
  const complete = tasks.filter(item => taskCompletedToday(item.data, today)).length;
  return <div className="routine-progress"><div><span>{tasks.length ? `${complete} of ${tasks.length} complete` : "A little room in the day"}</span>{tasks.length > 0 && complete === tasks.length && <strong>All done today <span aria-hidden="true">✧</span></strong>}</div><progress value={complete} max={Math.max(1, tasks.length)} aria-label={`${label}: ${complete} of ${tasks.length} tasks complete today`}/></div>;
}

/** The same saved family tasks, arranged by person and part of the London day. */
export default function FamilyTasks({ tasks, profiles, today, busy, onAdd, onComplete, onEdit, onAddPerson }: Props) {
  const [person, setPerson] = useState("");
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const completing = useRef(false);
  const names = useMemo(() => [...new Set([...profiles.map(profile => String(profile.data.name || "")).filter(Boolean), ...tasks.map(task => String(task.data.assignedTo || "")).filter(Boolean)])], [profiles, tasks]);
  const colour = (name: string) => {
    const value = profiles.find(profile => profile.data.name === name)?.data.color;
    return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value) ? value : "#6c9c8a";
  };
  const assigned = (item: Item) => String(item.data.assignedTo || "");
  const filtered = tasks.filter(task => !person || (person === UNASSIGNED ? !assigned(task) : assigned(task) === person));
  const todaysTasks = filtered.filter(task => taskIsForToday(task.data, today));
  const householdToday = tasks.filter(task => taskIsForToday(task.data, today));
  const upcoming = filtered.filter(task => !taskIsForToday(task.data, today) && (!task.data.done || isRecurring(task)));
  const history = filtered.filter(task => task.data.done && !isRecurring(task) && !taskIsForToday(task.data, today));
  const sortTasks = (items: Item[]) => [...items].sort((a, b) => Number(taskCompletedToday(a.data, today)) - Number(taskCompletedToday(b.data, today)) || String(a.data.dueAt || "9999").localeCompare(String(b.data.dueAt || "9999")) || String(a.data.title).localeCompare(String(b.data.title)));
  const complete = async (item: Item, done: boolean) => {
    if (busy || completing.current) return;
    completing.current = true;
    setPending(item.id);
    setError("");
    try { await onComplete(item, done); }
    catch (reason: any) { setError(reason?.message || "This task could not be saved. Please try again."); }
    finally { completing.current = false; setPending(""); }
  };
  const initial = (period: string, name?: string) => ({ period, ...(name ? { assignedTo: name } : {}) });
  const taskRow = (item: Item, mode: "today" | "upcoming" | "history", showPerson = false) => {
    const checked = mode === "history" || (mode === "today" && taskCompletedToday(item.data, today));
    const repeated = isRecurring(item);
    const scheduledRoutine = mode === "upcoming" && repeated;
    const meta = [showPerson ? assigned(item) || "Family" : "", checked ? mode === "history" ? `Completed${readableDate(item.data.lastCompletedAt) ? ` ${readableDate(item.data.lastCompletedAt)}` : ""}` : "Done today" : item.data.dueAt ? `${mode === "upcoming" ? "Due " : londonTaskDay(item.data.dueAt) < today ? "Overdue · " : ""}${readableDate(item.data.dueAt)}` : "Any time", repeated ? ({ daily: "Every day", weekly: "Every week", monthly: "Every month" } as Record<string, string>)[item.data.repeat] : ""].filter(Boolean).join(" · ");
    return <div key={item.id} className={`routine-task ${checked ? "is-complete" : ""}`} aria-busy={pending === item.id}>
      {scheduledRoutine ? <span className="routine-scheduled" aria-label={`Scheduled routine, available ${readableDate(item.data.dueAt)}`}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-12 4h2m4 0h2"/></svg></span> : <button type="button" className="routine-checkbox" role="checkbox" aria-checked={checked} aria-label={`${checked ? "Undo completion of" : "Complete"} ${item.data.title}`} disabled={busy || !!pending} onClick={() => void complete(item, !checked)}>{checked && <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>}</button>}
      <button type="button" className="routine-task-copy" onClick={() => onEdit(item)} aria-label={`Edit ${item.data.title}`}><strong>{item.data.title}</strong><span>{meta}</span></button>
      <button type="button" className="routine-edit" aria-label={`Task details for ${item.data.title}`} onClick={() => onEdit(item)}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/></svg></button>
    </div>;
  };
  const sections = (items: Item[], name?: string, showPerson = false) => <div className="routine-periods">{TASK_PERIODS.map(period => {
    const rows = sortTasks(items.filter(item => taskPeriod(item.data) === period.id));
    const done = rows.filter(item => taskCompletedToday(item.data, today)).length;
    return <section className={`routine-period period-${period.id}`} key={period.id} aria-label={`${name || "Family"} ${period.label} tasks`}><div className="routine-period-heading"><span className="routine-period-icon"><PeriodIcon id={period.id}/></span><h3>{period.label}</h3>{rows.length > 0 && <span className="routine-period-count">{done}/{rows.length}</span>}</div>{rows.length ? rows.map(item => taskRow(item, "today", showPerson)) : <p className="routine-empty">Nothing planned here yet.</p>}<button type="button" className="routine-add" onClick={() => onAdd(initial(period.id, name))}><Plus/> Add {period.label.toLowerCase()} task</button></section>;
  })}</div>;

  const boardNames = person ? [person === UNASSIGNED ? "" : person] : [...names, ""];
  return <section className="panel family-routines" aria-label="Family tasks by time of day">
    <div className="routine-topline"><div><span className="panel-kicker">TODAY’S LITTLE WINS</span><h2>{dayLabel(today)}</h2></div><button type="button" className="button ghost small" onClick={onAddPerson}><Plus/> Add family member</button></div>
    <Progress tasks={householdToday} today={today} label="Whole family"/>
    <div className="routine-toolbar"><div className="routine-person-filters" aria-label="Filter tasks by family member"><button type="button" aria-pressed={!person} className={!person ? "active" : ""} onClick={() => setPerson("")}>Everyone</button>{names.map(name => <button type="button" key={name} aria-pressed={person === name} className={person === name ? "active" : ""} onClick={() => setPerson(name)}><span className="routine-person-dot" style={{ background: colour(name) }}/>{name}</button>)}<button type="button" aria-pressed={person === UNASSIGNED} className={person === UNASSIGNED ? "active" : ""} onClick={() => setPerson(UNASSIGNED)}>Family / unassigned</button></div><div className="segmented" aria-label="Task layout"><button type="button" aria-pressed={layout === "board"} className={layout === "board" ? "active" : ""} onClick={() => setLayout("board")}>Family board</button><button type="button" aria-pressed={layout === "list"} className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")}>List</button></div></div>
    {error && <p className="notice warning" role="alert">{error}</p>}
    {layout === "board" ? <div className="routine-board">{boardNames.map(name => {
      const items = todaysTasks.filter(item => assigned(item) === name);
      return <section className="routine-person" key={name || UNASSIGNED} style={{ "--routine-person-colour": colour(name) } as React.CSSProperties}><div className="routine-person-heading"><span className="routine-avatar" aria-hidden="true">{name ? name.slice(0, 1).toUpperCase() : "✧"}</span><h2>{name || "Family"}</h2></div><Progress tasks={items} today={today} label={name || "Family unassigned"}/>{sections(items, name)}</section>;
    })}</div> : <div className="routine-list">{person && <Progress tasks={todaysTasks} today={today} label={person === UNASSIGNED ? "Family unassigned" : person}/>} {sections(todaysTasks, person === UNASSIGNED || !person ? undefined : person, true)}</div>}
    <div className="routine-later"><details><summary>Upcoming <span>{upcoming.length}</span></summary>{upcoming.length ? sortTasks(upcoming).map(item => taskRow(item, "upcoming", true)) : <p className="routine-empty">No tasks waiting for a later day.</p>}</details><details><summary>Completed history <span>{history.length}</span></summary>{history.length ? history.sort((a, b) => String(b.data.lastCompletedAt || b.updatedAt).localeCompare(String(a.data.lastCompletedAt || a.updatedAt))).map(item => taskRow(item, "history", true)) : <p className="routine-empty">Earlier completed tasks will appear here.</p>}</details></div>
    <p className="routine-footnote">Morning, all day or night — tick things off as you go. Today’s completed tasks stay checked, and repeating routines are ready again on their next day.</p>
  </section>;
}
