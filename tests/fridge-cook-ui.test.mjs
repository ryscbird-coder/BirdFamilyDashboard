import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Real component handlers with synthetic hooks, camera and HTTP replies.
// These tests do not exercise a browser camera or an external AI provider.
const dir=path.resolve('.sites-runtime/fridge-ui-tests');await mkdir(dir,{recursive:true});
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
await writeFile(path.join(dir,'hook-host.mjs'),`export {default} from 'react';
let host;
export function withHost(next,render){host=next;try{return render();}finally{host=undefined;}}
export function useState(initial){return host.useState(initial);}
export function useRef(initial){return host.useRef(initial);}
export function useEffect(effect,deps){return host.useEffect(effect,deps);}
`);
await writeFile(path.join(dir,'capture-host.mjs'),`let next;
export function setCaptureHost(host){next=host;}
export class FridgeCaptureSession {
 constructor(options){this.host=next;this.host.instances++;this.host.options=options;}
 async start(){this.host.starts++;if(this.host.startError)throw this.host.startError;}
 capture(){this.host.captures++;if(this.host.captureError)throw this.host.captureError;}
 async image(){this.host.images++;return new Blob([this.host.imageBytes?new Uint8Array(this.host.imageBytes):'synthetic fridge bytes'],{type:'image/jpeg'});}
 clear(){this.host.clears++;}
}
`);
await writeFile(path.join(dir,'focus-host.mjs'),'export function modalFocusables(){return [];} export function trapModalFocus(){return false;}');
let source=await readFile(new URL('../app/FridgeCook.tsx',import.meta.url),'utf8');
source=source.replace('from "react"','from "./hook-host.mjs"').replace('from "./fridge-capture"','from "./capture-host.mjs"').replace('from "./modal-focus"','from "./focus-host.mjs"').replace('from "./recipe-utils"','from "./recipe-utils.mjs"').replace('import "./fridge-cook.css";','');
await writeFile(path.join(dir,'FridgeCook.mjs'),compile(source));
await writeFile(path.join(dir,'recipe-utils.mjs'),compile(await readFile(new URL('../app/recipe-utils.ts',import.meta.url),'utf8')));
const {withHost}=await import(pathToFileURL(path.join(dir,'hook-host.mjs')).href);
const {setCaptureHost}=await import(pathToFileURL(path.join(dir,'capture-host.mjs')).href);
const {default:FridgeCook}=await import(pathToFileURL(path.join(dir,'FridgeCook.mjs')).href);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
const walk=(node,out=[])=>{if(Array.isArray(node)){node.forEach(child=>walk(child,out));return out;}if(node&&typeof node==='object'&&node.props){out.push(node);walk(node.props.children,out);}return out;};
const enabledStatus=()=>({configured:true,visionEnabled:true,textEnabled:true,provider:'fixture-provider',retention:{providerName:'Fixture service',disclosure:'Synthetic service disclosure: this fixture does not contact a provider.',policyUrl:'https://example.test/privacy'},limits:{imageBytes:1048576,dailyCalls:20}});
const recognition=()=>({ingredients:[{name:'fixture spinach',amount:200,unit:'g',uncertain:true,note:'Check the unclear package label.'},{name:'fixture mushrooms',uncertain:false}],warnings:['Photo quantities require review.']});
const suggestion=()=>({draft:{title:'Fixture supper',servings:2,ingredients:[{name:'fixture spinach',amount:200,unit:'g'},{name:'fixture mushrooms',amount:2}],instructions:'Cook the fixture ingredients completely.',notes:'Synthetic proposal only.'},missingIngredients:[{name:'fixture oil',amount:1,unit:'tbsp',uncertain:true}],warnings:['Check fixture dietary requirements.']});
const response=(value,ok=true)=>({ok,json:async()=>structuredClone(value)});

async function createHost(status=enabledStatus()){
  const names=['document','navigator','localStorage','sessionStorage'];
  const original=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  original.fetch=globalThis.fetch;original.setTimeout=globalThis.setTimeout;original.clearTimeout=globalThis.clearTimeout;
  const listeners=new Map(),timers=new Map(),calls=[],drafts=[],pending=new Map(),modes=new Map();let timerId=0,closed=0,realCameraCalls=0;
  const previous={focusCount:0,focus(){this.focusCount++;}};
  const document={hidden:false,visibilityState:'visible',activeElement:previous,body:{style:{overflow:'auto'}},addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);}};
  const storage=new Proxy({}, {get(){throw Error('Fridge images must never use browser storage.');},set(){throw Error('Fridge images must never use browser storage.');}});
  for(const [name,value] of Object.entries({document,navigator:{mediaDevices:{getUserMedia(){realCameraCalls++;throw Error('Physical camera must not run in this test.');}}},localStorage:storage,sessionStorage:storage}))Object.defineProperty(globalThis,name,{configurable:true,value});
  globalThis.setTimeout=(callback,ms)=>{assert.equal(ms,60000);const id=++timerId;timers.set(id,callback);return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  const capture={instances:0,starts:0,captures:0,images:0,clears:0};setCaptureHost(capture);
  globalThis.fetch=async(url,init={})=>{
    const call={url:String(url),method:init.method||'GET',body:init.body,headers:init.headers,signal:init.signal};calls.push(call);
    const mode=modes.get(call.url);
    if(mode==='defer')return await new Promise(resolve=>pending.set(call.url,resolve));
    if(mode instanceof Error)throw mode;
    if(typeof mode==='string')return response({error:{message:mode}},false);
    if(call.url==='/api/recipes/fridge/status')return response(status);
    if(call.url==='/api/recipes/fridge/recognize')return response(recognition());
    if(call.url==='/api/recipes/fridge/suggest')return response(suggestion());
    throw Error(`Unexpected request ${call.method} ${call.url}`);
  };
  const slots=[];let cursor=0,dirty=true,tree,effects=[],mounted=true,lateUpdates=0;
  const host={
    useState(initial){const index=cursor++;if(!slots[index])slots[index]={kind:'state',value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{if(!mounted){lateUpdates++;return;}slots[index].value=typeof next==='function'?next(slots[index].value):next;dirty=true;}];},
    useRef(initial){const index=cursor++;if(!slots[index])slots[index]={kind:'ref',value:{current:initial}};return slots[index].value;},
    useEffect(effect,deps){const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){slots[index]={kind:'effect',deps,cleanup:old?.cleanup};effects.push({index,effect});}},
    render(){cursor=0;dirty=false;tree=withHost(host,()=>FridgeCook({onClose:()=>{closed++;},onDraft:draft=>drafts.push(draft)}));for(const node of walk(tree)){const ref=node.props.ref;if(ref&&typeof ref==='object'&&!ref.current)ref.current={focus(){},srcObject:null,width:0,height:0};}const ready=effects;effects=[];for(const {index,effect} of ready){slots[index].cleanup?.();slots[index].cleanup=effect();}return tree;},
    async settle(){for(let i=0;i<12;i++){await tick();if(mounted&&dirty)host.render();}},
    nodes(){if(mounted&&dirty)host.render();return walk(tree);},
    find(predicate){const result=host.nodes().find(predicate);assert.ok(result,'Expected fridge UI element is not rendered.');return result;},
    button(label){return host.find(node=>node.type==='button'&&(text(node)===label||node.props['aria-label']===label));},
    field(label,index=0){const labels=host.nodes().filter(node=>node.type==='label'&&text(node).startsWith(label));assert.ok(labels[index],`Missing field ${label} #${index}`);const input=walk(labels[index]).find(node=>['input','textarea','select'].includes(node.type));assert.ok(input);return input;},
    change(label,value,index=0){host.field(label,index).props.onChange({target:{value}});},
    check(label,checked,index=0){host.field(label,index).props.onChange({target:{checked}});},
    defer(url){modes.set(url,'defer');},
    fail(url,message){modes.set(url,message);},
    resolve(url,value){assert.ok(pending.has(url),'No pending fixture request');pending.get(url)(response(value));pending.delete(url);},
    hide(){document.hidden=true;document.visibilityState='hidden';listeners.get('visibilitychange')?.();},
    timeout(){assert.equal(timers.size,1,'Expected exactly one active request timeout');const [id,callback]=timers.entries().next().value;timers.delete(id);callback();},
    stateValues(){return slots.filter(slot=>slot.kind==='state').map(slot=>slot.value);},
    unmount(){if(!mounted)return;mounted=false;for(const slot of slots)if(slot.kind==='effect')slot.cleanup?.();},
    close(){host.unmount();globalThis.fetch=original.fetch;globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;for(const name of names){if(original[name])Object.defineProperty(globalThis,name,original[name]);else delete globalThis[name];}},
    get closed(){return closed;},get lateUpdates(){return lateUpdates;},get realCameraCalls(){return realCameraCalls;},capture,calls,drafts,timers,document,previous,
  };
  host.render();await host.settle();return host;
}
const recognizeUrl='/api/recipes/fridge/recognize',suggestUrl='/api/recipes/fridge/suggest';
async function photographed(host){host.button('Start fridge camera').props.onClick();await host.settle();host.button('Capture fridge ingredients').props.onClick();host.nodes();}
async function reviewed(host){await photographed(host);host.button('Read ingredients').props.onClick();await host.settle();}
function confirm(host){host.check('I have checked these ingredients.',true);host.nodes();}

test('unconfigured service keeps camera and uploads off while manual ingredients produce only an unfinished draft',async()=>{
  const host=await createHost({configured:false,visionEnabled:false,textEnabled:false,reason:'Synthetic service is not configured.'});try{
    assert.equal(host.button('Start fridge camera').props.disabled,true);
    host.button('Start fridge camera').props.onClick();await host.settle();
    assert.equal(host.capture.starts,0);assert.equal(host.realCameraCalls,0);assert.equal(host.calls.length,1);
    host.button('Enter ingredients myself').props.onClick();host.change('Ingredient 1','fixture tomatoes');host.change('Servings','3');
    assert.equal(host.button('Build a recipe manually').props.disabled,true);confirm(host);
    assert.equal(host.button('Suggest a recipe').props.disabled,true);
    host.button('Build a recipe manually').props.onClick();
    assert.equal(host.drafts.length,1);const draft=host.drafts[0];assert.equal(draft.title,'');assert.equal(draft.instructions,'');assert.equal(draft.servings,3);assert.equal(draft.ingredients[0].name,'fixture tomatoes');assert.equal(draft.ingredients[0].amount,undefined);assert.match(draft.notes,/No recipe has been generated/);
    assert.ok(host.capture.clears>0);assert.ok(host.calls.every(call=>call.method==='GET'));
  }finally{host.close();}
});

test('a configured service without retention disclosure cannot enable the camera',async()=>{
  const status=enabledStatus();delete status.retention;
  const host=await createHost(status);try{
    assert.equal(host.button('Start fridge camera').props.disabled,true);
    host.button('Start fridge camera').props.onClick();await host.settle();
    assert.equal(host.capture.starts,0);assert.equal(host.realCameraCalls,0);assert.ok(!host.calls.some(call=>call.method==='POST'));
  }finally{host.close();}
});

test('camera capture does not upload until Read ingredients explicitly acknowledges processing',async()=>{
  const host=await createHost();try{
    await photographed(host);
    assert.equal(host.capture.starts,1);assert.equal(host.capture.captures,1);assert.equal(host.capture.images,0);
    assert.ok(host.calls.every(call=>call.method==='GET'));
    host.button('Read ingredients').props.onClick();await host.settle();
    const request=host.calls.find(call=>call.url===recognizeUrl);assert.ok(request);assert.equal(request.method,'POST');assert.ok(request.body instanceof Blob);assert.equal(request.body.type,'image/jpeg');assert.equal(request.headers['Content-Type'],'image/jpeg');assert.equal(request.headers['X-Fridge-Processing-Acknowledged'],'true');assert.equal(host.capture.images,1);
    assert.equal(host.field('Ingredient 1').props.value,'fixture spinach');assert.equal(host.field('Amount').props.value,'200');assert.equal(host.field('Unit').props.value,'g');
    assert.ok(host.nodes().some(node=>node.type==='p'&&text(node).includes('unclear package')));
    assert.ok(!host.stateValues().some(value=>value instanceof Blob),'image bytes must not enter component state');
    assert.equal(host.drafts.length,0);assert.ok(!host.calls.some(call=>call.url===suggestUrl));
  }finally{host.close();}
});

test('review edits reset confirmation and only reviewed text goes to recipe suggestions',async()=>{
  const host=await createHost();try{
    await reviewed(host);confirm(host);assert.equal(host.button('Suggest a recipe').props.disabled,false);
    host.change('Ingredient 1','reviewed spinach');assert.equal(host.button('Suggest a recipe').props.disabled,true);assert.equal(host.field('I have checked these ingredients.').props.checked,false);
    host.change('Amount','150');host.change('Unit','g');host.check('Identification still uncertain',false);host.change('Amount','2',1);host.change('Unit','whole',1);host.change('Servings','2');host.change('Dietary preferences','No fixture nuts.');confirm(host);
    host.button('Suggest a recipe').props.onClick();await host.settle();
    const request=host.calls.find(call=>call.url===suggestUrl);assert.ok(request);assert.equal(request.headers['Content-Type'],'application/json');assert.equal(typeof request.body,'string');
    const input=JSON.parse(request.body);assert.equal(input.servings,2);assert.equal(input.preferences,'No fixture nuts.');assert.equal(input.ingredients[0].name,'reviewed spinach');assert.equal(input.ingredients[0].amount,150);assert.equal(input.ingredients[0].unit,'g');assert.equal(input.ingredients[0].uncertain,false);assert.equal(input.ingredients[1].amount,2);
    assert.ok(!Object.keys(input).some(key=>/image|photo|blob/i.test(key)));assert.equal(host.calls.filter(call=>call.url===recognizeUrl).length,1);
    assert.equal(host.drafts.length,0,'a proposal must never save itself');assert.ok(!host.calls.some(call=>/shopping|\/api\/items/.test(call.url)));
  }finally{host.close();}
});

test('recipe proposal is editable and missing ingredients stay separate without automatic shopping or saving',async()=>{
  const host=await createHost();try{
    await reviewed(host);confirm(host);host.button('Suggest a recipe').props.onClick();await host.settle();
    assert.equal(host.field('Recipe title').props.value,'Fixture supper');assert.ok(!host.field('Recipe ingredients').props.value.includes('fixture oil'));
    const missing=host.find(node=>node.type==='aside'&&node.props.className==='fridge-missing-ingredients');assert.match(text(missing),/1 tbsp fixture oil/);assert.match(text(missing),/Nothing is added to shopping automatically/);
    assert.equal(host.field('Missing ingredients').props.value,'1 tbsp fixture oil');
    assert.equal(host.drafts.length,0);host.change('Recipe title','Reviewed fixture supper');host.change('Recipe ingredients','150 g fixture spinach\n2 fixture mushrooms');host.change('Method','Cook fully using the reviewed method.');host.change('Notes','Reviewed dietary needs.');host.change('Missing ingredients','2 tbsp reviewed fixture dressing');host.change('Servings','3');
    host.button('Continue to recipe editor').props.onClick();assert.equal(host.drafts.length,1);
    const draft=host.drafts[0];assert.equal(draft.title,'Reviewed fixture supper');assert.equal(draft.instructions,'Cook fully using the reviewed method.');assert.equal(draft.servings,3);assert.deepEqual(draft.ingredients,[{amount:150,unit:'g',name:'fixture spinach'},{amount:2,name:'fixture mushrooms'}]);assert.match(draft.notes,/Reviewed dietary needs/);assert.match(draft.notes,/You may still need: 2 tbsp reviewed fixture dressing/);assert.doesNotMatch(draft.notes,/fixture oil/);
    assert.ok(host.calls.every(call=>call.url.startsWith('/api/recipes/fridge/')));assert.ok(host.capture.clears>0);
  }finally{host.close();}
});

test('retake and explicit recognition cancellation clear the photo and discard late replies',async()=>{
  const host=await createHost();try{
    await photographed(host);const previousClears=host.capture.clears;host.button('Retake photo').props.onClick();await host.settle();assert.equal(host.capture.starts,2);assert.ok(host.capture.clears>previousClears);assert.ok(!host.calls.some(call=>call.url===recognizeUrl));
    host.button('Capture fridge ingredients').props.onClick();host.defer(recognizeUrl);host.button('Read ingredients').props.onClick();await host.settle();
    const request=host.calls.find(call=>call.url===recognizeUrl);const beforeCancel=host.capture.clears;host.button('Cancel identification').props.onClick();assert.equal(request.signal.aborted,true);assert.ok(host.capture.clears>beforeCancel);
    host.resolve(recognizeUrl,recognition());await host.settle();assert.ok(!host.nodes().some(node=>node.type==='label'&&text(node).startsWith('Ingredient 1')));assert.equal(host.button('Start fridge camera').props.disabled,false);assert.equal(host.drafts.length,0);
  }finally{host.close();}
});

test('recognition failure clears captured data and keeps suggestions and saves untouched',async()=>{
  const host=await createHost();try{
    await photographed(host);host.fail(recognizeUrl,'Synthetic identification failure. Photo discarded.');const before=host.capture.clears;host.button('Read ingredients').props.onClick();await host.settle();
    assert.ok(host.capture.clears>before);assert.ok(host.nodes().some(node=>node.props.role==='alert'&&text(node).includes('Synthetic identification failure')));assert.equal(host.button('Start fridge camera').props.disabled,false);assert.equal(host.drafts.length,0);assert.ok(!host.calls.some(call=>call.url===suggestUrl));
  }finally{host.close();}
});

test('recognition timeout aborts work, clears the image and ignores a response that arrives afterward',async()=>{
  const host=await createHost();try{
    await photographed(host);host.defer(recognizeUrl);host.button('Read ingredients').props.onClick();await host.settle();const request=host.calls.find(call=>call.url===recognizeUrl),before=host.capture.clears;
    host.timeout();host.nodes();assert.equal(request.signal.aborted,true);assert.ok(host.capture.clears>before);assert.ok(host.nodes().some(node=>node.props.role==='alert'&&text(node).includes('took too long')));
    host.resolve(recognizeUrl,recognition());await host.settle();assert.equal(host.button('Start fridge camera').props.disabled,false);assert.ok(!host.nodes().some(node=>node.type==='label'&&text(node).startsWith('Ingredient 1')));assert.equal(host.drafts.length,0);
  }finally{host.close();}
});

test('hidden page and unmount abort pending recognition and never apply stale response state',async()=>{
  for(const action of ['hide','unmount']){
    const host=await createHost();try{
      await photographed(host);host.defer(recognizeUrl);host.button('Read ingredients').props.onClick();await host.settle();const request=host.calls.find(call=>call.url===recognizeUrl),before=host.capture.clears;
      host[action]();assert.equal(request.signal.aborted,true);assert.ok(host.capture.clears>before);host.resolve(recognizeUrl,recognition());await host.settle();assert.equal(host.lateUpdates,0);assert.equal(host.drafts.length,0);
      if(action==='hide'){assert.equal(host.button('Start fridge camera').props.disabled,false);assert.ok(host.nodes().some(node=>node.props.role==='status'&&text(node).includes('page was left')));}
      else{assert.equal(host.document.body.style.overflow,'auto');assert.equal(host.previous.focusCount,1);}
    }finally{host.close();}
  }
});

test('closing aborts in-flight work and a cancelled suggestion keeps reviewed ingredients',async()=>{
  const closed=await createHost();try{
    await photographed(closed);closed.defer(recognizeUrl);closed.button('Read ingredients').props.onClick();await closed.settle();const request=closed.calls.find(call=>call.url===recognizeUrl),before=closed.capture.clears;
    closed.button('Close fridge cooking').props.onClick();assert.equal(closed.closed,1);assert.equal(request.signal.aborted,true);assert.ok(closed.capture.clears>before);closed.resolve(recognizeUrl,recognition());await closed.settle();assert.equal(closed.drafts.length,0);
  }finally{closed.close();}
  const host=await createHost();try{
    await reviewed(host);host.change('Ingredient 1','retained reviewed spinach');confirm(host);host.defer(suggestUrl);host.button('Suggest a recipe').props.onClick();await host.settle();const request=host.calls.find(call=>call.url===suggestUrl);
    host.button('Cancel suggestion').props.onClick();assert.equal(request.signal.aborted,true);host.resolve(suggestUrl,suggestion());await host.settle();assert.equal(host.field('Ingredient 1').props.value,'retained reviewed spinach');assert.equal(host.drafts.length,0);assert.ok(!host.nodes().some(node=>node.type==='section'&&node.props.className==='fridge-proposal'));
  }finally{host.close();}
});

test('failed or timed-out suggestions retain reviewed inventory and cannot create a late recipe',async()=>{
  for(const action of ['failure','timeout']){
    const host=await createHost();try{
      await reviewed(host);host.change('Ingredient 1','saved reviewed fixture inventory');confirm(host);
      if(action==='failure')host.fail(suggestUrl,'Synthetic proposal failure. Reviewed ingredients retained.');else host.defer(suggestUrl);
      const before=host.capture.clears;host.button('Suggest a recipe').props.onClick();await host.settle();
      if(action==='timeout'){
        const request=host.calls.find(call=>call.url===suggestUrl);host.timeout();host.nodes();assert.equal(request.signal.aborted,true);
        host.resolve(suggestUrl,suggestion());await host.settle();
      }
      assert.ok(host.capture.clears>before);assert.equal(host.field('Ingredient 1').props.value,'saved reviewed fixture inventory');
      assert.ok(host.nodes().some(node=>node.props.role==='alert'&&text(node).includes(action==='timeout'?'took too long':'Synthetic proposal failure')));
      assert.equal(host.drafts.length,0);assert.ok(!host.nodes().some(node=>node.type==='section'&&node.props.className==='fridge-proposal'));
      assert.ok(host.calls.every(call=>call.url.startsWith('/api/recipes/fridge/')));
    }finally{host.close();}
  }
});

test('an oversized capture is discarded before any image upload or recipe proposal request',async()=>{
  const host=await createHost();try{
    await photographed(host);host.capture.imageBytes=1048577;const before=host.capture.clears;
    host.button('Read ingredients').props.onClick();await host.settle();
    assert.equal(host.capture.images,1);assert.ok(host.capture.clears>before);
    assert.ok(!host.calls.some(call=>call.method==='POST'),'oversized image bytes must never reach a request');
    assert.ok(host.nodes().some(node=>node.props.role==='alert'&&text(node).includes('too large')));
    assert.equal(host.button('Start fridge camera').props.disabled,false);assert.equal(host.drafts.length,0);
    assert.ok(!host.stateValues().some(value=>value instanceof Blob));
  }finally{host.close();}
});
