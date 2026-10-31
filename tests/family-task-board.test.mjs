import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const dir=path.resolve('.sites-runtime/family-task-board-tests');await mkdir(dir,{recursive:true});
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
const compile=source=>ts.transpileModule(source,{compilerOptions:options}).outputText;
const source=(await readFile(new URL('../app/FamilyTasks.tsx',import.meta.url),'utf8')).replace('import "./family-tasks.css";','').replace('from "../shared/family-tasks"','from "./family-tasks.mjs"');
await writeFile(path.join(dir,'family-tasks.mjs'),compile(await readFile(new URL('../shared/family-tasks.ts',import.meta.url),'utf8')));
await writeFile(path.join(dir,'FamilyTasks.mjs'),compile(source));
const {default:FamilyTasks}=await import(pathToFileURL(path.join(dir,'FamilyTasks.mjs')).href);
await writeFile(path.join(dir,'task-hook-host.mjs'),`let current;
export function withHost(host,render){current=host;try{return render();}finally{current=undefined;}}
export function useState(initial){return current.useState(initial);}
export function useRef(initial){return current.useRef(initial);}
export function useMemo(fn){return fn();}
`);
const handlerSource=source.replace('import React, { useMemo, useRef, useState } from "react";','import React from "react";\nimport {useMemo,useRef,useState} from "./task-hook-host.mjs";');
assert.notEqual(handlerSource,source);
await writeFile(path.join(dir,'FamilyTasks.handlers.mjs'),compile(handlerSource));
const {default:HandlerTasks}=await import(pathToFileURL(path.join(dir,'FamilyTasks.handlers.mjs')).href);
const {withHost}=await import(pathToFileURL(path.join(dir,'task-hook-host.mjs')).href);
const today='2026-10-31';
const item=(id,data)=>({id,kind:'reminder',version:1,createdAt:'2026-10-30T12:00:00Z',updatedAt:'2026-10-31T08:00:00Z',data:{title:id,done:false,repeat:'none',...data}});
const profiles=[{id:'profile-one',kind:'profile',data:{name:'Nate',color:'#78b8cf'}},{id:'profile-two',kind:'profile',data:{name:'Bella',color:'#bf96c7'}}];
const tasks=[
 item('Morning fixture',{period:'morning',assignedTo:'Nate',dueAt:'2026-10-31'}),
 item('Legacy all-day fixture',{assignedTo:'Bella'}),
 item('Completed night routine',{assignedTo:'Nate',period:'night',repeat:'daily',dueAt:'2026-11-01',lastCompletedAt:'2026-10-31T08:00:00Z',lastCompletedDueAt:'2026-10-31'}),
 item('Future recurring fixture',{assignedTo:'Nate',period:'morning',repeat:'daily',dueAt:'2026-11-02'}),
 item('Future one-off fixture',{dueAt:'2026-11-02'}),
 item('Old completed fixture',{assignedTo:'Bella',done:true,lastCompletedAt:'2026-10-30T10:00:00Z'}),
 item('Overdue fixture',{dueAt:'2026-10-29',period:'all_day'}),
];
const props={tasks,profiles,today,busy:false,onAdd(){},onComplete(){},onEdit(){},onAddPerson(){}};
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
const walk=(node,found=[])=>{if(Array.isArray(node)){node.forEach(child=>walk(child,found));return found;}if(node&&typeof node==='object'&&node.props){found.push(node);walk(node.props.children,found);}return found;};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function host(overrides={}){
 const slots=[];let cursor=0,tree;const adds=[],completions=[];
 const values={...props,onAdd:initial=>adds.push(initial),onComplete:(task,done)=>completions.push({id:task.id,done}),...overrides};
 const hooks={useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];},useRef(initial){const index=cursor++;if(!slots[index])slots[index]={value:{current:initial}};return slots[index].value;}};
 const render=()=>{cursor=0;tree=withHost(hooks,()=>HandlerTasks(values));return tree;};
 const nodes=()=>walk(render());
 const find=predicate=>{const match=nodes().find(predicate);assert.ok(match,'Expected task-board element');return match;};
 const button=label=>find(node=>node.type==='button'&&(text(node).trim()===label||node.props['aria-label']===label));
 render();return{render,nodes,find,button,adds,completions};
}

test('real task board renders all three periods for each person and keeps today, future and history distinct',()=>{
 const html=renderToStaticMarkup(React.createElement(FamilyTasks,props));
 for(const person of ['Nate','Bella','Family'])for(const period of ['Morning','All day','Night'])assert.ok(html.includes(`aria-label="${person} ${period} tasks"`));
 assert.ok(html.indexOf('Nate Morning tasks')<html.indexOf('Nate All day tasks'));
 assert.ok(html.indexOf('Nate All day tasks')<html.indexOf('Nate Night tasks'));
 assert.ok(html.includes('Whole family: 1 of 4 tasks complete today'));
 assert.ok(html.includes('aria-checked="true" aria-label="Undo completion of Completed night routine"'));
 assert.ok(html.includes('Overdue · 29 Oct'));
 assert.ok(html.indexOf('Future recurring fixture')>html.indexOf('<summary>Upcoming'));
 assert.ok(!html.includes('aria-label="Complete Future recurring fixture"'));
 assert.ok(html.includes('aria-label="Complete Future one-off fixture"'));
 assert.ok(html.indexOf('Old completed fixture')>html.indexOf('<summary>Completed history'));
 assert.match(html,/Saturday,? 31 October/);
});

test('empty days never claim all done and still offer every time-of-day section',()=>{
 const html=renderToStaticMarkup(React.createElement(FamilyTasks,{...props,tasks:[],profiles:[]}));
 assert.equal((html.match(/class="routine-period /g)||[]).length,3);
 assert.ok(!html.includes('All done today'));
 assert.ok(html.includes('Whole family: 0 of 0 tasks complete today'));
});

test('legacy recurring done flags appear only in their current due section, never completed history',()=>{
 const legacy=[item('Legacy due routine',{done:true,repeat:'daily',dueAt:'2026-10-31'}),item('Legacy future routine',{done:true,repeat:'weekly',dueAt:'2026-11-02'})];
 const html=renderToStaticMarkup(React.createElement(FamilyTasks,{...props,tasks:legacy,profiles:[]}));
 assert.equal((html.match(/aria-label="Complete Legacy due routine"/g)||[]).length,1);
 assert.equal((html.match(/aria-label="Task details for Legacy due routine"/g)||[]).length,1);
 assert.ok(html.indexOf('Legacy due routine')<html.indexOf('<summary>Upcoming'));
 assert.ok(html.indexOf('Legacy future routine')>html.indexOf('<summary>Upcoming'));
 assert.ok(!html.includes('aria-label="Complete Legacy future routine"'));
 assert.ok(html.includes('<summary>Completed history <span>0</span>'));
});

test('period add buttons carry the correct person and persisted period without creating a task',()=>{
 const fixture=host();
 const morning=fixture.find(node=>node.type==='section'&&node.props['aria-label']==='Nate Morning tasks');
 walk(morning).find(node=>node.type==='button'&&text(node).trim()==='Add morning task').props.onClick();
 fixture.button('Family / unassigned').props.onClick();
 fixture.button('Add night task').props.onClick();
 assert.deepEqual(fixture.adds,[{period:'morning',assignedTo:'Nate'},{period:'night'}]);
 assert.deepEqual(fixture.completions,[]);
});

test('person and layout controls change visible tasks without changing household progress',()=>{
 const fixture=host();fixture.button('Nate').props.onClick();
 assert.ok(!fixture.nodes().some(node=>node.props['aria-label']==='Complete Legacy all-day fixture'));
 assert.ok(fixture.nodes().some(node=>typeof node.type==='function'&&node.props.label==='Whole family'&&node.props.tasks.length===4));
 fixture.button('List').props.onClick();
 assert.equal(fixture.nodes().filter(node=>node.type==='section'&&String(node.props.className).includes('routine-period ')).length,3);
 assert.ok(fixture.nodes().some(node=>node.props['aria-label']==='Undo completion of Completed night routine'));
});

test('today routine undo uses the saved item rather than changing its checkbox optimistically',async()=>{
 const fixture=host();fixture.button('Undo completion of Completed night routine').props.onClick();await settle();
 assert.deepEqual(fixture.completions,[{id:'Completed night routine',done:false}]);
 assert.equal(fixture.button('Undo completion of Completed night routine').props['aria-checked'],true);
});

test('pending and failed completions cannot double-submit or falsely check a task',async()=>{
 let release;const calls=[];const fixture=host({onComplete:async(task,done)=>{calls.push({id:task.id,done});await new Promise(resolve=>{release=resolve;});throw Error('Synthetic offline save');}});
 const first=fixture.button('Complete Morning fixture');first.props.onClick();first.props.onClick();
 assert.deepEqual(calls,[{id:'Morning fixture',done:true}]);
 assert.equal(fixture.button('Complete Morning fixture').props.disabled,true);
 release();await settle();
 assert.equal(fixture.button('Complete Morning fixture').props['aria-checked'],false);
 assert.equal(fixture.button('Complete Morning fixture').props.disabled,false);
 assert.ok(fixture.nodes().some(node=>node.props.role==='alert'&&text(node)==='Synthetic offline save'));
});
