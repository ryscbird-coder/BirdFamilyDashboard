import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest,MODEL,RECOGNITION_SCHEMA,RECIPE_SCHEMA} from './worker.mjs';
const token='synthetic-test-only-token-32-bytes-or-longer';
const jpeg=(width=640,height=480)=>Buffer.from([255,216,255,192,0,11,8,height>>8,height&255,width>>8,width&255,1,1,17,0,255,217]).toString('base64');
const payload={operation:'recognize',image:{mimeType:'image/jpeg',base64:jpeg()}};
function request(data=payload,headers={},path='/infer',method='POST',signal){return new Request('https://relay.example.test'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:method==='POST'?JSON.stringify(data):undefined,signal});}
const fixtureIngredients={ingredients:[{name:'Carrot',uncertain:true,note:'Check that this is a carrot.'}],warnings:['Review before cooking.']};
const env=(fn)=>({HUB_RECIPE_AI_TOKEN:token,AI:{run:fn}});

test('relay authenticates before parsing or calling AI and refuses browser Origin',async()=>{let calls=0;const e=env(async()=>{calls++;return{response:'{}'};});assert.equal((await handleRequest(request(payload,{Authorization:'Bearer '+'x'.repeat(40)}),e)).status,401);assert.equal((await handleRequest(request(payload,{Origin:'https://family.example.test'}),e)).status,403);assert.equal((await handleRequest(request(),{AI:e.AI})).status,503);assert.equal(calls,0);});

test('authenticated health check is read-only and exposes no secret or inference input',async()=>{let calls=0;const r=await handleRequest(request(undefined,{},'/health','GET'),env(async()=>{calls++;}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.model,MODEL);assert.equal(data.originalImagesStored,false);assert.equal(data.ready,true);assert.equal(calls,0);assert.equal(JSON.stringify(data).includes(token),false);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);});

test('recognition invokes only the fixed vision model with data URI and bounded guided output',async()=>{let captured;const r=await handleRequest(request({...payload,model:'untrusted-other-model'}),env(async(model,input,options)=>{captured={model,input:structuredClone(input),options};return{response:JSON.stringify({...fixtureIngredients,photo:'never-return-this-image'})};}));assert.equal(r.status,200);assert.deepEqual(await r.json(),fixtureIngredients);assert.equal(captured.model,MODEL);assert.deepEqual(captured.input.response_format,{type:"json_schema",json_schema:RECOGNITION_SCHEMA});assert.equal(captured.input.max_tokens,1000);assert.equal(captured.input.stream,false);assert.ok(captured.input.messages[1].content[1].image_url.url.startsWith('data:image/jpeg;base64,'));assert.equal(captured.options.rejectIfBusy,true);assert.ok(captured.options.signal instanceof AbortSignal);assert.equal(captured.options.gateway,undefined);assert.equal(captured.input.tools,undefined);});

test('images over dimensions/bytes, HTTP image URLs and malformed JSON never invoke AI',async()=>{let calls=0;const e=env(async()=>{calls++;});for(const image of [{mimeType:'image/jpeg',base64:jpeg(1281,480)},{mimeType:'image/png',base64:jpeg()},{mimeType:'image/jpeg',base64:'https://private.example.test/photo'},{mimeType:'image/jpeg',base64:Buffer.alloc(1_048_577).toString('base64')}]){const r=await handleRequest(request({operation:'recognize',image}),e);assert.ok([400,413].includes(r.status));}const huge=await handleRequest(new Request('https://relay.example.test/infer',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':'1450001'},body:'{}'}),e);assert.equal(huge.status,413);const invalid=await handleRequest(new Request('https://relay.example.test/infer',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'private malformed input'}),e);assert.equal(invalid.status,400);assert.equal((await invalid.text()).includes('private malformed'),false);assert.equal(calls,0);});

test('recipe proposal uses reviewed text only and returns a draft without saving or extra provider fields',async()=>{let captured;const draft={title:'Carrot soup proposal',servings:2,ingredients:[{name:'Carrot',amount:200,unit:'g'},{name:'Water',amount:500,unit:'ml'}],instructions:'Simmer the carrots in the water until tender, then blend.',notes:'Proposed amounts; review them.',prepMinutes:5,cookMinutes:20,tags:['Soup']};const response={draft,missingIngredients:[{name:'Water',uncertain:false}],warnings:['Check your dietary requirements.']};const r=await handleRequest(request({operation:'suggest',ingredients:[{name:'Carrot',amount:200,unit:'g',uncertain:false}],servings:2,preferences:'A simple soup'}),env(async(model,input)=>{captured={model,input:structuredClone(input)};return{response:JSON.stringify({...response,storedImage:'discard'})};}));assert.equal(r.status,200);assert.deepEqual(await r.json(),response);assert.equal(captured.model,MODEL);assert.deepEqual(captured.input.response_format,{type:"json_schema",json_schema:RECIPE_SCHEMA});assert.equal(captured.input.max_tokens,2200);assert.equal(typeof captured.input.messages[1].content,'string');assert.ok(!JSON.stringify(captured.input).includes('data:image'));});

test('provider failures and malformed or inconsistent outputs fail without echoing content',async()=>{const secret='private-provider-body-and-photo';const failed=await handleRequest(request(),env(async()=>{throw Error(secret);}));assert.equal(failed.status,503);assert.equal((await failed.text()).includes(secret),false);const malformed=await handleRequest(request(),env(async()=>({response:'<html>'+secret+'</html>'})));assert.equal(malformed.status,502);assert.equal((await malformed.text()).includes(secret),false);const servings=await handleRequest(request({operation:'suggest',ingredients:[{name:'Rice',uncertain:false}],servings:2}),env(async()=>({response:JSON.stringify({draft:{title:'Rice',servings:8,ingredients:[{name:'Rice'}],instructions:'Cook.'},missingIngredients:[],warnings:[]})})));assert.equal(servings.status,502);});

test('incoming cancellation is passed to the AI binding and no automatic retry occurs',async()=>{const controller=new AbortController();let calls=0;const pending=handleRequest(request(payload,{},'/infer','POST',controller.signal),env(async(_model,_input,options)=>{calls++;return new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});setTimeout(()=>controller.abort(),0);});}));const response=await pending;assert.equal(response.status,504);assert.equal(calls,1);});

test('only the two fixed inference operations and JPEG data are accepted',async()=>{let calls=0;const e=env(async()=>{calls++;return{response:JSON.stringify(fixtureIngredients)};});assert.equal((await handleRequest(request({operation:'arbitrary-proxy',url:'https://example.test'}),e)).status,400);assert.equal((await handleRequest(request(undefined,{},'/admin','GET'),e)).status,404);assert.equal((await handleRequest(request(undefined,{},'/infer','GET'),e)).status,405);assert.equal((await handleRequest(request({operation:'suggest',ingredients:[],servings:2}),e)).status,400);assert.equal(calls,0);});

test('deadline settles when AI ignores cancellation and clears image references',async()=>{
  const realTimeout=globalThis.setTimeout,realParse=JSON.parse;
  let capturedInput,capturedPayload,capturedSignal,calls=0;
  JSON.parse=(value,...args)=>{const parsed=realParse(value,...args);if(parsed.operation==='recognize')capturedPayload=parsed;return parsed;};
  globalThis.setTimeout=(callback,delay)=>{assert.equal(delay,40000);queueMicrotask(callback);return realTimeout(()=>{},1000);};
  try {
    const response=await handleRequest(request(),env((_model,input,options)=>{calls++;capturedInput=input;capturedSignal=options.signal;return new Promise(()=>{});}));
    assert.equal(response.status,504);assert.equal((await response.json()).error.code,'ai_timeout');assert.equal(calls,1);
    assert.equal(capturedSignal.aborted,true);assert.equal(capturedPayload.image.base64,'');assert.equal(capturedInput.messages[1].content[1].image_url.url,'');
  }finally{globalThis.setTimeout=realTimeout;JSON.parse=realParse;}
});

test('success, provider failure and user cancellation release both application image references',async()=>{
  const realParse=JSON.parse;
  try{
    for(const outcome of ['success','error','cancel']){
      let capturedPayload,capturedInput;
      JSON.parse=(value,...args)=>{const parsed=realParse(value,...args);if(parsed.operation==='recognize')capturedPayload=parsed;return parsed;};
      const controller=new AbortController();
      const response=await handleRequest(request(payload,{},'/infer','POST',controller.signal),env(async(_model,input)=>{capturedInput=input;if(outcome==='error')throw Error('private-provider-error');if(outcome==='cancel'){queueMicrotask(()=>controller.abort());return new Promise(()=>{});}return{response:JSON.stringify(fixtureIngredients)};}));
      assert.equal(response.status,outcome==='success'?200:outcome==='error'?503:504);
      assert.equal(capturedPayload.image.base64,'');assert.equal(capturedInput.messages[1].content[1].image_url.url,'');
    }
  }finally{JSON.parse=realParse;}
});

test('reviewed recipe ingredient count accepts forty and rejects forty-one before inference',async()=>{
  let calls=0;
  const e=env(async()=>{calls++;return{response:JSON.stringify({draft:{title:'Reviewed vegetable soup',servings:2,ingredients:[{name:'Vegetable',amount:200,unit:'g'}],instructions:'Prepare the reviewed ingredients and simmer until cooked.'},missingIngredients:[],warnings:[]})};});
  const rows=Array.from({length:40},(_,i)=>({name:'Reviewed ingredient '+i,uncertain:false}));
  assert.equal((await handleRequest(request({operation:'suggest',ingredients:rows,servings:2}),e)).status,200);
  assert.equal((await handleRequest(request({operation:'suggest',ingredients:[...rows,{name:'Forty first ingredient'}],servings:2}),e)).status,400);
  assert.equal(calls,1);
});

test('oversized and failed request streams clear chunks already read without invoking AI',async()=>{
  for(const failure of ['oversized','failed']){
    const first=new TextEncoder().encode('private-image-request-prefix'),second=new Uint8Array(1_450_001).fill(101);
    let pulls=0,calls=0;
    const stream=new ReadableStream({pull(controller){if(pulls++===0){controller.enqueue(first);return;}if(failure==='oversized'){controller.enqueue(second);controller.close();}else controller.error(Error('private-body-error'));}});
    const r=new Request('https://relay.example.test/infer',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:stream,duplex:'half'});
    const response=await handleRequest(r,env(async()=>{calls++;}));
    assert.equal(response.status,failure==='oversized'?413:503);assert.equal(calls,0);assert.equal(first.every(byte=>byte===0),true);
    if(failure==='oversized')assert.equal(second.every(byte=>byte===0),true);
    assert.equal((await response.text()).includes('private-body-error'),false);
  }
});

test('current JSON Mode structured-object responses are validated like JSON text',async()=>{
  let captured;
  const recognized=await handleRequest(request(),env(async(_model,input)=>{captured=input;return{response:{...fixtureIngredients,privateImage:'discard-extra-field'}};}));
  assert.equal(recognized.status,200);assert.deepEqual(await recognized.json(),fixtureIngredients);
  assert.equal(captured.guided_json,undefined);assert.equal(captured.response_format.type,'json_schema');
  const draft={title:'Reviewed carrot soup',servings:2,ingredients:[{name:'Carrot',amount:200,unit:'g'}],instructions:'Prepare and cook the carrots until tender.'};
  const suggested=await handleRequest(request({operation:'suggest',ingredients:[{name:'Carrot',uncertain:false}],servings:2}),env(async()=>({response:{draft,missingIngredients:[],warnings:[]}})));
  assert.equal(suggested.status,200);assert.deepEqual(await suggested.json(),{draft,missingIngredients:[],warnings:[]});
});

test('structured response byte bounds, schemas and strict JSON reject malformed output',async()=>{
  const invalid=[null,[],{ingredients:'not-an-array',warnings:[]},{...fixtureIngredients,oversized:'x'.repeat(32_001)},{...fixtureIngredients,oversized:'😀'.repeat(10_000)},'```json\n'+JSON.stringify(fixtureIngredients)+'\n```'];
  for(const value of invalid){const r=await handleRequest(request(),env(async()=>({response:value})));assert.equal(r.status,502);}
  const cyclic={};cyclic.self=cyclic;
  assert.equal((await handleRequest(request(),env(async()=>({response:cyclic})))).status,502);
});

test('recipe quantities must be positive structured proposals while photo amounts remain optional',async()=>{
  const recipeSchema=RECIPE_SCHEMA.properties.draft.properties.ingredients.items;
  assert.ok(recipeSchema.required.includes('amount'));assert.equal(recipeSchema.properties.amount.exclusiveMinimum,0);
  assert.equal(RECOGNITION_SCHEMA.properties.ingredients.items.required.includes('amount'),false);
  const draft={title:'Lemon drink proposal',servings:2,ingredients:[{name:'Lemon',amount:1,unit:'count'}],instructions:'Squeeze the lemon and prepare the drink.',notes:'These proposed quantities should be reviewed.'};
  for(const quantity of [undefined,0,-1,'1',100001]){
    const invalid={...draft,ingredients:[{name:'Lemon',amount:quantity,unit:'count'}]};
    const response=await handleRequest(request({operation:'suggest',ingredients:[{name:'Lemon',uncertain:false}],servings:2}),env(async()=>({response:{draft:invalid,missingIngredients:[],warnings:[]}})));
    assert.equal(response.status,502);
  }
  const proposed=await handleRequest(request({operation:'suggest',ingredients:[{name:'Lemon',uncertain:false}],servings:2}),env(async()=>({response:{draft,missingIngredients:[],warnings:[]}})));
  assert.equal(proposed.status,200);assert.equal((await proposed.json()).draft.ingredients[0].amount,1);
});

test('proposal preserves reviewed names and excludes reviewed items from missing ingredients',async()=>{
  let prompt;
  const draft={title:'Lemon and honey drink',servings:2,ingredients:[{name:'lemon',amount:1,unit:'count'},{name:'Honey',amount:1,unit:'tsp'}],instructions:'Squeeze the lemon and stir with the honey.',notes:'Proposed quantities; review before saving.'};
  const response=await handleRequest(request({operation:'suggest',ingredients:[{name:'Lemon',uncertain:false}],servings:2}),env(async(_model,input)=>{prompt=input.messages[0].content;return{response:{draft,missingIngredients:[{name:' lemon ',uncertain:false},{name:'Honey',uncertain:false}],warnings:[]}};}));
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.draft.ingredients[0].name,'Lemon');assert.deepEqual(data.missingIngredients,[{name:'Honey',uncertain:false}]);
  assert.ok(prompt.includes('EXACT reviewed ingredient names'));assert.ok(prompt.includes('a reviewed Lemon stays Lemon, never lemon juice'));
  assert.ok(prompt.includes('NEW PROPOSED RECIPE QUANTITIES'));assert.ok(prompt.includes('Do not list any reviewed ingredient under missingIngredients'));
});
