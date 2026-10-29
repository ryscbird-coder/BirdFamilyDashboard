import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const dir=path.resolve('.sites-runtime/calendar-tests');await mkdir(dir,{recursive:true});
for(const [sourceFile,targetFile] of [['calendar-layout.ts','calendar-layout.mjs'],['CalendarGrid.tsx','CalendarGrid.mjs']]){
  let source=await readFile(new URL('../app/'+sourceFile,import.meta.url),'utf8');
  source=source.replace('import "./calendar-spans.css";','').replace('from "./calendar-layout"','from "./calendar-layout.mjs"');
  await writeFile(path.join(dir,targetFile),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText);
}
const {default:CalendarGrid}=await import(pathToFileURL(path.join(dir,'CalendarGrid.mjs')).href);
const event=(id,startAt,endAt,allDay=true)=>({id,data:{title:id,startAt,endAt,allDay,origin:'icloud'}});
const render=(events,props={})=>renderToStaticMarkup(React.createElement(CalendarGrid,{events,startDay:'2026-10-26',weeks:1,today:'2026-10-29',onAdd:()=>{},onOpenEvent:()=>{},eventColour:()=>'#559988',...props}));

test('week render has one continuous clickable multi-day bar instead of repeated day cards',()=>{
  const html=render([event('Hull work','2026-10-29','2026-11-05'),event('Doctor','2026-10-29T13:00:00Z','2026-10-29T14:00:00Z',false)]);
  assert.equal((html.match(/class="calendar-span-event /g)||[]).length,1);
  assert.equal((html.match(/class="calendar-event"/g)||[]).length,1);
  assert.match(html,/grid-column:4 \/ 8/);
  assert.match(html,/aria-label="Hull work, 29 Oct to 4 Nov, all day, Apple Calendar, read-only"/);
  assert.match(html,/continues-after/);
  assert.match(html,/Add event for Thursday,? 29 October 2026/);
  assert.ok(html.indexOf('aria-label="Hull work')<html.indexOf('aria-label="Doctor'),'spanning bars precede lower day cards in keyboard order');
});
test('empty month keeps its day cells and valid minimum-height rows without invalid repeat-zero CSS',()=>{
  const html=render([],{weeks:6,month:'2026-11'});
  assert.equal((html.match(/class="calendar-span-week"/g)||[]).length,6);
  assert.equal((html.match(/class="calendar-day calendar-span-day /g)||[]).length,42);
  assert.match(html,/grid-template-rows:auto minmax\(75px, auto\)/);
  assert.doesNotMatch(html,/repeat\(0,/);
  assert.match(html,/outside/);
});
test('month continuation renders each week segment once and retains original event text as inert content',()=>{
  const html=render([event('Away <script>bad()</script>','2026-10-30','2026-11-04')],{weeks:6,month:'2026-11'});
  assert.equal((html.match(/class="calendar-span-event /g)||[]).length,2);
  assert.match(html,/continues-before/);
  assert.match(html,/continues-after/);
  assert.match(html,/Away &lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>/);
});
