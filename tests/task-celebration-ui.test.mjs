import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import postcss from 'postcss';

// Execute the actual component with deterministic hook/browser hosts. This does
// not claim a physical Safari rendering test; CSS cascade checks use its real CSS.
const dir=path.resolve('.sites-runtime/task-celebration-ui-tests');await mkdir(dir,{recursive:true});
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
await writeFile(path.join(dir,'hooks.mjs'),`export {default} from 'react';
let current;
export function withHost(host,render){current=host;try{return render();}finally{current=undefined;}}
export function useState(value){return current.useState(value);}
export function useRef(value){return current.useRef(value);}
export function useMemo(fn,deps){return current.useMemo(fn,deps);}
export function useEffect(fn,deps){return current.useEffect(fn,deps);}
`);
let source=await readFile(new URL('../app/TaskCelebration.tsx',import.meta.url),'utf8');
source=source.replace("from 'react'","from './hooks.mjs'").replace("from './task-celebration'","from './task-celebration.mjs'").replace("import './task-celebration.css';",'');
await writeFile(path.join(dir,'TaskCelebration.mjs'),compile(source));
await writeFile(path.join(dir,'task-celebration.mjs'),compile((await readFile(new URL('../app/task-celebration.ts',import.meta.url),'utf8')).replace("from '../shared/family-tasks.ts'","from './family-tasks.mjs'")));
await writeFile(path.join(dir,'family-tasks.mjs'),compile(await readFile(new URL('../shared/family-tasks.ts',import.meta.url),'utf8')));
const {withHost}=await import(pathToFileURL(path.join(dir,'hooks.mjs')).href);
const {default:TaskCelebration}=await import(pathToFileURL(path.join(dir,'TaskCelebration.mjs')).href);
const {TASK_CELEBRATION_DURATION_MS,TASK_CELEBRATION_PARTICLES}=await import(pathToFileURL(path.join(dir,'task-celebration.mjs')).href);
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
const walk=(node,out=[])=>{if(Array.isArray(node)){node.forEach(child=>walk(child,out));return out;}if(node&&typeof node==='object'&&node.props){out.push(node);walk(node.props.children,out);}return out;};
const classes=node=>String(node.props?.className||'').split(/\s+/).filter(Boolean);

function createHost({mode='shower',reduced=true,preview=false}={}){
 const descriptors={window:Object.getOwnPropertyDescriptor(globalThis,'window'),document:Object.getOwnPropertyDescriptor(globalThis,'document')};
 const motionListeners=new Set(),keyListeners=new Set(),visibleListeners=new Set(),timers=new Map(),durations=[],modeChanges=[];
 let timerId=0,dismissed=0,dirty=true,mounted=true,cursor=0,tree,effects=[];
 const motion={matches:reduced,addEventListener:(_name,fn)=>motionListeners.add(fn),removeEventListener:(_name,fn)=>motionListeners.delete(fn)};
 const window={matchMedia:()=>motion,setTimeout:(fn,duration)=>{const id=++timerId;timers.set(id,fn);durations.push(duration);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(_name,fn)=>keyListeners.add(fn),removeEventListener:(_name,fn)=>keyListeners.delete(fn)};
 const document={visibilityState:'visible',addEventListener:(_name,fn)=>visibleListeners.add(fn),removeEventListener:(_name,fn)=>visibleListeners.delete(fn)};
 Object.defineProperty(globalThis,'window',{configurable:true,value:window});Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 const values={mode,celebration:{id:'synthetic-celebration',preview},onDismiss:()=>{dismissed++;values.celebration=null;dirty=true;},onModeChange:next=>{modeChanges.push(next);values.mode=next;dirty=true;}};
 const slots=[];
 const changed=(left,right)=>!left||right.some((value,index)=>!Object.is(value,left[index]));
 const hooks={
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{if(!mounted)return;const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
  useRef(initial){const index=cursor++;if(!slots[index])slots[index]={value:{current:initial}};return slots[index].value;},
  useMemo(fn,deps){const index=cursor++;if(!slots[index]||changed(slots[index].deps,deps))slots[index]={value:fn(),deps};return slots[index].value;},
  useEffect(fn,deps){const index=cursor++,old=slots[index];if(!old||changed(old.deps,deps)){slots[index]={deps,cleanup:old?.cleanup};effects.push({index,fn});}},
 };
 const render=()=>{cursor=0;dirty=false;tree=withHost(hooks,()=>TaskCelebration(values));const pending=effects;effects=[];for(const {index,fn}of pending){slots[index].cleanup?.();slots[index].cleanup=fn();}return tree;};
 const flush=()=>{let passes=0;while(mounted&&dirty){assert.ok(++passes<12,'Unexpected celebration render loop');render();}return tree;};
 const nodes=()=>walk(flush());
 const particles=()=>nodes().filter(node=>classes(node).includes('task-celebration-particle'));
 const button=label=>{const node=nodes().find(node=>node.type==='button'&&(text(node)===label||node.props['aria-label']===label));assert.ok(node,`Expected button ${label}`);return node;};
 const unmount=()=>{if(!mounted)return;mounted=false;for(const slot of slots)slot?.cleanup?.();};
 const close=()=>{unmount();for(const [name,descriptor]of Object.entries(descriptors)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}};
 flush();return{values,nodes,particles,button,flush,timers,durations,modeChanges,motionListeners,keyListeners,visibleListeners,document,get dismissed(){return dismissed;},setMode(next){values.mode=next;dirty=true;flush();},setCelebration(next){values.celebration=next;dirty=true;flush();},setReduced(next){motion.matches=next;for(const fn of motionListeners)fn();flush();},unmount,close};
}

test('explicit Shower renders the actual falling shapes even with the device reduced-motion preference on',()=>{
 const fixture=createHost({mode:'shower',reduced:true});try{
  const particles=fixture.particles();assert.equal(particles.length,TASK_CELEBRATION_PARTICLES);
  assert.equal(new Set(particles.map(text)).size,1,'One randomly selected shape rains per celebration');
  assert.ok(fixture.nodes().some(node=>classes(node).includes('task-celebration--force-motion')));
  for(const particle of particles){assert.ok(parseFloat(particle.props.style['--task-duration'])>0);assert.ok(parseFloat(particle.props.style['--task-delay'])>=0);}
  assert.equal(fixture.nodes().filter(node=>node.props.role==='status').length,1);
  assert.equal(fixture.timers.size,1);assert.deepEqual(fixture.durations,[TASK_CELEBRATION_DURATION_MS]);
 }finally{fixture.close();}
});

test('Calm renders a still congratulations card and no falling shapes regardless of device preference',()=>{
 for(const reduced of [false,true]){const fixture=createHost({mode:'calm',reduced});try{
  assert.equal(fixture.particles().length,0);assert.ok(fixture.nodes().some(node=>classes(node).includes('task-celebration--still')));
  assert.ok(!fixture.nodes().some(node=>classes(node).includes('task-celebration--force-motion')));
  assert.ok(text(fixture.flush()).includes('All the tasks for today are complete.'));
 }finally{fixture.close();}}
});

test('Device setting follows live reduced-motion changes without overriding the device preference',()=>{
 const fixture=createHost({mode:'system',reduced:true});try{
  assert.equal(fixture.particles().length,0);fixture.setReduced(false);assert.equal(fixture.particles().length,TASK_CELEBRATION_PARTICLES);
  assert.ok(!fixture.nodes().some(node=>classes(node).includes('task-celebration--force-motion')));
  fixture.setReduced(true);assert.equal(fixture.particles().length,0);assert.equal(fixture.timers.size,1);
 }finally{fixture.close();}
});

test('Show shower changes the actual mode and restarts a full bounded shower lifetime without duplicate listeners',()=>{
 const fixture=createHost({mode:'calm',reduced:true});try{
  const firstTimer=[...fixture.timers.keys()][0];fixture.button('Show shower').props.onClick();fixture.flush();
  assert.deepEqual(fixture.modeChanges,['shower']);assert.equal(fixture.particles().length,TASK_CELEBRATION_PARTICLES);
  assert.ok(!fixture.timers.has(firstTimer));assert.equal(fixture.timers.size,1);
  assert.deepEqual(fixture.durations,[TASK_CELEBRATION_DURATION_MS,TASK_CELEBRATION_DURATION_MS]);
  assert.equal(fixture.motionListeners.size,1);assert.equal(fixture.keyListeners.size,1);assert.equal(fixture.visibleListeners.size,1);
  fixture.setMode('calm');assert.equal(fixture.particles().length,0);assert.equal(fixture.timers.size,1);
  fixture.button('Dismiss task celebration').props.onClick();fixture.flush();assert.equal(fixture.dismissed,1);
  assert.equal(fixture.timers.size+fixture.motionListeners.size+fixture.keyListeners.size+fixture.visibleListeners.size,0);
 }finally{fixture.close();}
});

test('a new preview remounts the particle layer and starts a fresh bounded CSS animation lifetime',()=>{
 const fixture=createHost({mode:'shower',reduced:false,preview:true});try{
  const layer=()=>fixture.nodes().find(node=>classes(node).includes('task-celebration-shower'));
  const originalKey=layer().key,originalTimer=[...fixture.timers.keys()][0];
  fixture.setCelebration({id:'second-synthetic-preview',preview:true});
  assert.notEqual(layer().key,originalKey);assert.equal(layer().key,'second-synthetic-preview:shower');
  assert.ok(!fixture.timers.has(originalTimer));assert.equal(fixture.timers.size,1);
  assert.deepEqual(fixture.durations,[TASK_CELEBRATION_DURATION_MS,TASK_CELEBRATION_DURATION_MS]);
  fixture.setMode('system');assert.equal(layer().key,'second-synthetic-preview:system');
  assert.equal(fixture.particles().length,TASK_CELEBRATION_PARTICLES);
 }finally{fixture.close();}
});

test('preview copy never claims tasks were completed, and tab-hide/unmount clean up the actual component',()=>{
 const fixture=createHost({mode:'shower',reduced:true,preview:true});try{
  const copy=text(fixture.flush());assert.ok(copy.includes('Celebration preview'));assert.ok(copy.includes('Your tasks haven’t changed.'));assert.ok(!copy.includes('tasks for today are complete'));
  const queued=[...fixture.timers.values()][0];fixture.document.visibilityState='hidden';for(const fn of [...fixture.visibleListeners])fn();fixture.flush();assert.equal(fixture.dismissed,1);
  assert.equal(fixture.timers.size+fixture.motionListeners.size+fixture.keyListeners.size+fixture.visibleListeners.size,0);
  fixture.unmount();queued();assert.equal(fixture.dismissed,1);
 }finally{fixture.close();}
});

// A bounded cascade evaluator for the actual descendant-class/universal rules
// affecting these elements. No browser is installed or implied by this check.
function cascade(styles,path,reduced){
 const values=new Map();let order=0;
 const matches=selector=>{if(selector.includes(':')||/[>+~\[\]#]/.test(selector))return false;const parts=selector.trim().split(/\s+/);let index=path.length-1;for(let p=parts.length-1;p>=0;p--){const part=parts[p];if(part!=='*'&&!/^(?:\.[\w-]+)+$/.test(part))return false;const wanted=part==='*'?[]:part.slice(1).split('.');if(p===parts.length-1&&!wanted.every(value=>path[index].includes(value)))return false;while(index>=0&&!wanted.every(value=>path[index].includes(value)))index--;if(index<0)return false;index--;}return true;};
 const offer=(prop,value,important,specificity)=>{const rank=[important?1:0,specificity,++order],old=values.get(prop);if(!old||rank[0]>old.rank[0]||(rank[0]===old.rank[0]&&(rank[1]>old.rank[1]||(rank[1]===old.rank[1]&&rank[2]>old.rank[2]))))values.set(prop,{value,rank});};
 for(const css of styles)postcss.parse(css).walkRules(rule=>{
  let ancestor=rule.parent;while(ancestor&&ancestor.type!=='root'){if(ancestor.type==='atrule'&&ancestor.name.includes('keyframes'))return;if(ancestor.type==='atrule'&&ancestor.name==='media'&&ancestor.params.includes('prefers-reduced-motion')&&!reduced)return;ancestor=ancestor.parent;}
  for(const selector of rule.selectors||[]){if(!matches(selector))continue;const specificity=(selector.match(/\./g)||[]).length;for(const declaration of rule.nodes||[]){if(declaration.type!=='decl')continue;if(declaration.prop==='animation'&&declaration.value==='none'){for(const [prop,value]of Object.entries({'animation-name':'none','animation-duration':'0s','animation-delay':'0s','animation-timing-function':'ease','animation-fill-mode':'none','animation-iteration-count':'1','animation-direction':'normal','animation-play-state':'running'}))offer(prop,value,declaration.important,specificity);}else offer(declaration.prop,declaration.value,declaration.important,specificity);}}
 });return values;
}

test('the rendered Shower explicitly wins the real global reduced-motion CSS while Device setting stays suppressed',async()=>{
 const styles=await Promise.all(['../app/hub.css','../app/task-celebration.css'].map(url=>readFile(new URL(url,import.meta.url),'utf8')));
 const fixture=createHost({mode:'shower',reduced:true});try{
  const root=classes(fixture.flush()),shower=fixture.nodes().find(node=>classes(node).includes('task-celebration-shower')),particle=fixture.particles()[0];
  const forced=cascade(styles,[root,classes(shower),classes(particle)],true);
  assert.equal(forced.get('animation-name').value,'task-celebration-fall');
  assert.equal(forced.get('animation-duration').value,'var(--task-duration, 3.5s)');
  assert.equal(forced.get('animation-delay').value,'var(--task-delay, 0s)');
  assert.equal(forced.get('animation-fill-mode').value,'both');
  const displayed=cascade(styles,[root,classes(shower)],true);assert.equal(displayed.get('display').value,'block');
  const devicePath=[['task-celebration'],classes(shower),classes(particle)];assert.equal(cascade(styles,devicePath,true).get('animation-name').value,'none');
  assert.equal(cascade(styles,devicePath.slice(0,2),true).get('display').value,'none');
 }finally{fixture.close();}
});
