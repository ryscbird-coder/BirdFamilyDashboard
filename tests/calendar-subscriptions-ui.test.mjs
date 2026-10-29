import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Synthetic hook/event host for the real component's handlers. This is not browser or provider QA.
const dir=path.resolve('.sites-runtime/subscription-ui-tests');
await mkdir(dir,{recursive:true});
await writeFile(path.join(dir,'hook-host.mjs'),`export {default} from 'react';
let host;
export function withHost(next,render){host=next;try{return render();}finally{host=undefined;}}
export function useState(initial){return host.useState(initial);}
export function useRef(initial){return host.useRef(initial);}
export function useEffect(effect,deps){return host.useEffect(effect,deps);}
`);
let source=await readFile(new URL('../app/ICloudSetup.tsx',import.meta.url),'utf8');
source=source.replace('from "react"','from "./hook-host.mjs"').replace('from "../shared/calendar-limits"','from "./calendar-limits.mjs"').replace('import "./calendar-subscriptions.css";','');
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
await writeFile(path.join(dir,'ICloudSetup.mjs'),compile(source));
await writeFile(path.join(dir,'calendar-limits.mjs'),compile(await readFile(new URL('../shared/calendar-limits.ts',import.meta.url),'utf8')));
const {withHost}=await import(pathToFileURL(path.join(dir,'hook-host.mjs')).href);
const {default:ICloudSetup}=await import(pathToFileURL(path.join(dir,'ICloudSetup.mjs')).href);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
const walk=(node,output=[])=>{if(Array.isArray(node)){node.forEach(child=>walk(child,output));return output;}if(node&&typeof node==='object'&&node.props){output.push(node);walk(node.props.children,output);}return output;};
const defaultStatus=()=>({scope:'self',canConnect:true,configured:false,calendars:[],selectedCalendarIds:[],householdCalendars:[],subscriptions:[],status:'unconfigured'});
const subscription=()=>({id:'feed_fixture',title:'Fixture sessions',status:'ready',lastSuccess:'2026-10-29T11:00:00Z',calendarId:'feed_fixture',calendarKey:'calendar_fixture',personId:null,version:3,mappingVersion:7});

async function createHost(initial=defaultStatus(),rejectWrites=false){
 const original={fetch:globalThis.fetch,document:Object.getOwnPropertyDescriptor(globalThis,'document'),localStorage:Object.getOwnPropertyDescriptor(globalThis,'localStorage'),sessionStorage:Object.getOwnPropertyDescriptor(globalThis,'sessionStorage')};
 const listeners=new Map();const document={visibilityState:'visible',addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);}};
 const storage=new Proxy({}, {get(){throw Error('Browser storage must not be used by the private URL form.');},set(){throw Error('Browser storage must not be used by the private URL form.');}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});
 const state=structuredClone(initial),calls=[];
 globalThis.fetch=async(url,options={})=>{
  const method=options.method||'GET';const body=options.body?JSON.parse(options.body):undefined;calls.push({url:String(url),method,body});
  if(rejectWrites&&method!=='GET')return{ok:false,json:async()=>({error:{message:'Synthetic provider failure; previous events retained.'}})};
  if(String(url)==='/api/icloud/discover'&&method==='POST')state.calendars.push({id:'calendar_discovered',displayName:'Future child calendar',calendarKey:'key_discovered',personId:null,sharedCalendarId:'shared_discovered',version:1,available:true});
  if(String(url)==='/api/icloud/subscriptions'&&method==='POST')state.subscriptions.push({...subscription(),title:body.title,personId:body.personId});
  if(String(url)==='/api/icloud/calendar-settings'){const found=state.subscriptions.find(item=>item.calendarId===body.calendarId);if(found){found.personId=body.personId;found.mappingVersion++;}}
  if(String(url)==='/api/icloud/subscriptions/feed_fixture'&&method==='POST'){const found=state.subscriptions.find(item=>item.id==='feed_fixture');if(found){found.title=body.title;found.version++;}}
  if(String(url)==='/api/icloud/subscriptions/feed_fixture'&&method==='DELETE')state.subscriptions=state.subscriptions.filter(item=>item.id!=='feed_fixture');
  return{ok:true,json:async()=>structuredClone(state)};
 };
 const slots=[];let cursor=0,dirty=true,tree,effects=[],attached=new Set(),mounted=true;
 const host={
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={kind:'state',value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;dirty=true;}];},
  useRef(initial){const index=cursor++;if(!slots[index])slots[index]={kind:'ref',value:{current:initial}};return slots[index].value;},
  useEffect(effect,deps){const index=cursor++;const slot=slots[index];if(!slot||!deps||deps.some((value,i)=>!Object.is(value,slot.deps?.[i]))){slots[index]={kind:'effect',deps,cleanup:slot?.cleanup};effects.push({index,effect});}},
  render(){cursor=0;dirty=false;tree=withHost(host,()=>ICloudSetup({profiles:[{id:'profile_ryan',data:{name:'Ryan',color:'#447788'}}],canManageHousehold:false,onRefresh:async()=>true}));const nextAttached=new Set();for(const element of walk(tree)){const ref=element.props.ref;if(ref&&typeof ref==='object'){nextAttached.add(ref);if(!ref.current)ref.current={value:element.props.defaultValue||'',focus(){}};}}for(const ref of attached)if(!nextAttached.has(ref))ref.current=null;attached=nextAttached;const pending=effects;effects=[];for(const item of pending){slots[item.index].cleanup?.();slots[item.index].cleanup=item.effect();}return tree;},
  async settle(){for(let i=0;i<12;i++){await tick();if(dirty&&mounted)host.render();}},
  nodes(){if(dirty)host.render();return walk(tree);},
  find(predicate){const found=host.nodes().find(predicate);assert.ok(found,'Requested synthetic UI element was not rendered.');return found;},
  button(label){return host.find(node=>node.type==='button'&&text(node)===label);},
  field(label){const parent=host.find(node=>node.type==='label'&&text(node).startsWith(label));return walk(parent).find(node=>['input','select'].includes(node.type));},
  form(){return host.find(node=>node.type==='form'&&node.props.className==='calendar-subscription-form');},
  stateValues(){return slots.filter(slot=>slot.kind==='state').map(slot=>slot.value);},
  hide(){document.visibilityState='hidden';listeners.get('visibilitychange')?.();},
  unmount(){if(!mounted)return;mounted=false;for(const slot of slots)if(slot.kind==='effect')slot.cleanup?.();},
  close(){host.unmount();globalThis.fetch=original.fetch;for(const name of ['document','localStorage','sessionStorage']){if(original[name])Object.defineProperty(globalThis,name,original[name]);else delete globalThis[name];}},
  calls,state,
 };
 host.render();await host.settle();return host;
}
const change=(node,value)=>node.props.onChange({target:{value}});

test('subscription form works without Apple login and clears its private URL before a create request completes',async()=>{
 const host=await createHost();try{
  host.button('Add subscribed calendar').props.onClick();host.nodes();
  change(host.field('Calendar name'),'Broadcast fixture');change(host.field('Family profile'),'profile_ryan');host.nodes();
  const input=host.field('Calendar subscription link');assert.equal(input.props.value,undefined);assert.equal(input.props.defaultValue,undefined);
  const dom=input.props.ref.current;const secret='webcal://example.test/private-fixture-token/calendar.ics';dom.value=secret;
  assert.ok(!JSON.stringify(host.stateValues()).includes(secret),'secret URL entered React state');
  host.form().props.onSubmit({preventDefault(){}});assert.equal(dom.value,'','private URL must clear synchronously on submit');
  await host.settle();
  const call=host.calls.find(call=>call.method==='POST'&&call.url==='/api/icloud/subscriptions');assert.deepEqual(call.body,{title:'Broadcast fixture',url:secret,personId:'profile_ryan'});
  assert.ok(host.calls.every(call=>!call.url.includes('private-fixture-token')),'secret URL escaped into a request URL');
  assert.ok(!JSON.stringify(host.stateValues()).includes(secret),'secret URL remained in React state after submission');
 }finally{host.close();}
});

test('private subscription URL clears on cancel, hidden tab, unmount and failed submission',async()=>{
 const host=await createHost(defaultStatus(),true);try{
  host.button('Add subscribed calendar').props.onClick();host.nodes();let dom=host.field('Calendar subscription link').props.ref.current;dom.value='https://example.test/cancel-secret.ics';host.button('Cancel').props.onClick();assert.equal(dom.value,'');
  host.button('Add subscribed calendar').props.onClick();host.nodes();dom=host.field('Calendar subscription link').props.ref.current;dom.value='https://example.test/hide-secret.ics';host.hide();assert.equal(dom.value,'');
  change(host.field('Calendar name'),'Failure fixture');host.nodes();dom.value='https://example.test/failure-secret.ics';host.form().props.onSubmit({preventDefault(){}});assert.equal(dom.value,'');await host.settle();assert.ok(host.nodes().some(node=>node.props.role==='alert'&&text(node).includes('Synthetic provider failure')));
  dom=host.field('Calendar subscription link').props.ref.current;dom.value='https://example.test/unmount-secret.ics';host.unmount();assert.equal(dom.value,'');
 }finally{host.close();}
});

test('subscription person, refresh, replacement and removal use own routes and the correct independent versions',async()=>{
 const status=defaultStatus();status.subscriptions=[subscription()];const host=await createHost(status);try{
  change(host.field('Person for Fixture sessions'),'profile_ryan');host.button('Save person').props.onClick();await host.settle();
  assert.deepEqual(host.calls.find(call=>call.url==='/api/icloud/calendar-settings').body,{calendarId:'feed_fixture',personId:'profile_ryan',version:7});
  host.button('Sync now').props.onClick();await host.settle();assert.deepEqual(host.calls.find(call=>call.url.endsWith('/feed_fixture/sync')).body,{});
  host.button('Replace private link').props.onClick();host.nodes();const input=host.field('Calendar subscription link');assert.equal(input.props.value,undefined);const dom=input.props.ref.current;assert.equal(dom.value,'','saved secret link must never be repopulated');dom.value='https://example.test/replacement-secret.ics';host.form().props.onSubmit({preventDefault(){}});assert.equal(dom.value,'');await host.settle();
  assert.deepEqual(host.calls.find(call=>call.url==='/api/icloud/subscriptions/feed_fixture'&&call.method==='POST').body,{title:'Fixture sessions',url:'https://example.test/replacement-secret.ics',version:3});
  host.button('Remove').props.onClick();host.nodes();const checkbox=host.find(node=>node.type==='input'&&node.props.type==='checkbox');checkbox.props.onChange({target:{checked:true}});host.button('Remove my subscription').props.onClick();await host.settle();
  assert.deepEqual(host.calls.find(call=>call.url==='/api/icloud/subscriptions/feed_fixture'&&call.method==='DELETE').body,{removeImported:true,version:4});
  assert.ok(host.calls.filter(call=>call.method!=='GET').every(call=>!Object.hasOwn(call.body,'userId')&&!Object.hasOwn(call.body,'accountId')),'UI chose another actor account');
 }finally{host.close();}
});

test('the real shared 32-calendar limit permits more than eight and blocks a thirty-third selection',async()=>{
 const status=defaultStatus();status.configured=true;status.status='ready';status.username='fixture@example.test';status.calendars=Array.from({length:33},(_,i)=>({id:'calendar_'+i,displayName:'Calendar '+i,calendarKey:'key_'+i,personId:null,sharedCalendarId:'shared_'+i,version:1}));status.selectedCalendarIds=status.calendars.slice(0,31).map(calendar=>calendar.id);
 const host=await createHost(status);try{
  assert.ok(host.nodes().some(node=>node.type==='h3'&&text(node)==='Choose up to 32 of your calendars'));
  assert.equal(host.field('Calendar 31').props.disabled,false);host.field('Calendar 31').props.onChange({target:{checked:true}});assert.equal(host.field('Calendar 32').props.disabled,true);
  host.field('Calendar 0').props.onChange({target:{checked:false}});assert.equal(host.field('Calendar 32').props.disabled,false);
 }finally{host.close();}
});


test('finding new iCloud calendars uses stored credentials and preserves saved and unsaved choices',async()=>{
 const status=defaultStatus();status.configured=true;status.status='ready';status.username='fixture@example.test';status.lastSuccess='2026-10-29T11:00:00Z';
 status.calendars=[
  {id:'calendar_saved',displayName:'Saved family calendar',calendarKey:'key_saved',personId:null,sharedCalendarId:'shared_saved',version:1,available:true},
  {id:'calendar_pending',displayName:'Pending family calendar',calendarKey:'key_pending',personId:null,sharedCalendarId:'shared_pending',version:1,available:true},
  {id:'calendar_missing',displayName:'Last-known family calendar',calendarKey:'key_missing',personId:null,sharedCalendarId:'shared_missing',version:1,available:false,lastKnown:true},
 ];status.selectedCalendarIds=['calendar_saved','calendar_missing'];
 const host=await createHost(status);try{
  host.field('Pending family calendar').props.onChange({target:{checked:true}});
  change(host.field('Person for Saved family calendar'),'profile_ryan');
  assert.equal(host.field('Last-known family calendar').props.disabled,false,'an unavailable saved selection must still be removable');
  assert.ok(host.nodes().some(node=>node.type==='small'&&text(node).includes('Not in latest Apple list')));
  host.button('Find new iCloud calendars').props.onClick();await host.settle();
  const request=host.calls.find(call=>call.url==='/api/icloud/discover');assert.equal(request.method,'POST');assert.deepEqual(request.body,{});
  assert.deepEqual(host.state.selectedCalendarIds,['calendar_saved','calendar_missing'],'discovery must not modify saved sharing choices');
  assert.equal(host.state.username,'fixture@example.test');assert.equal(host.state.lastSuccess,'2026-10-29T11:00:00Z');
  assert.ok(!host.calls.some(call=>call.url==='/api/icloud/connect'),'discovery must not reconnect or resend a password');
  assert.equal(host.field('Saved family calendar').props.checked,true);assert.equal(host.field('Pending family calendar').props.checked,true,'pending selection must survive discovery');
  assert.equal(host.field('Person for Saved family calendar').props.value,'profile_ryan','pending person assignment must survive discovery');
  assert.equal(host.field('Future child calendar').props.checked,false,'a newly discovered calendar must not be shared automatically');
  host.field('Last-known family calendar').props.onChange({target:{checked:false}});assert.equal(host.field('Last-known family calendar').props.disabled,true,'an unavailable calendar cannot be newly selected');
 }finally{host.close();}
});

test('hourly refresh copy requires the confirmed own schedule and never replaces provider success or manual controls',async()=>{
 const scenarios=[
  {refreshMode:'hourly',enabled:true,expected:'checked automatically every hour'},
  {refreshMode:'manual',enabled:false,expected:'Automatic hourly refresh is not configured'},
  {refreshMode:undefined,enabled:undefined,expected:'Automatic refresh status is not available'},
  {refreshMode:'hourly',enabled:false,expected:'Automatic refresh status is not available'},
 ];
 for(const scenario of scenarios){
  const status=defaultStatus();status.configured=true;status.status='ready';status.username='fixture@example.test';status.refreshMode=scenario.refreshMode;
  if(scenario.enabled!==undefined)status.autoRefresh={enabled:scenario.enabled,scope:'self',intervalMinutes:60,verifiedAt:'2026-10-29T12:00:00Z'};
  status.lastSuccess='2026-10-28T11:00:00Z';status.calendars=[{id:'calendar_saved',displayName:'Saved calendar',calendarKey:'key_saved',personId:null,sharedCalendarId:'shared_saved',version:1}];status.selectedCalendarIds=['calendar_saved'];status.subscriptions=[subscription()];
  const host=await createHost(status);try{
   assert.ok(text(host.nodes()).includes(scenario.expected));
   if(!scenario.enabled)assert.ok(!text(host.nodes()).includes('checked automatically every hour'));
   assert.equal(host.button('Save choices & sync my calendars').props.disabled,false);
   assert.equal(host.button('Sync now').props.disabled,false);
   assert.ok(host.nodes().some(node=>node.type==='dd'&&/28 Oct.*11:00/.test(text(node))),'provider success must keep its actual older date');
   host.button('Refresh my saved connection status ').props.onClick();await host.settle();
   assert.ok(host.calls.every(call=>call.method==='GET'),'reading schedule status must not trigger any sync or schedule writes');
   assert.equal(host.state.lastSuccess,'2026-10-28T11:00:00Z');assert.equal(host.state.subscriptions[0].lastSuccess,'2026-10-29T11:00:00Z');
  }finally{host.close();}
 }
 const status=defaultStatus();status.configured=true;status.status='configured';status.refreshMode='hourly';status.autoRefresh={enabled:true,scope:'self',intervalMinutes:60,verifiedAt:'2026-10-29T12:00:00Z'};status.subscriptions=[{...subscription(),lastSuccess:undefined}];
 const host=await createHost(status);try{
  assert.ok(text(host.nodes()).includes('checked automatically every hour'));
  assert.ok(text(host.nodes()).includes('No successful calendar sync yet'));
  assert.ok(text(host.nodes()).includes('No successful refresh has been recorded yet.'));
  assert.ok(!text(host.nodes()).includes('last verified calendar sync is available'));
 }finally{host.close();}
});
