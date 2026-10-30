import type {D1Database} from '@cloudflare/workers-types';
import {ApiError,object,string} from './domain.ts';
import {applyBootstrap} from './bootstrap.ts';

/** Owner-provided text only. No cookbook or household content is bundled with source. */
export async function applyRecipeCatalog(db:D1Database,env:Record<string,unknown>,userId:string){
 const count=Number(env.HUB_RECIPE_CATALOG_PARTS||0);if(!count)return;
 const owner=await db.prepare('SELECT user_id FROM hub_owner WHERE singleton=1').first<{user_id:string}>();if(owner?.user_id!==userId)return;
 const configuredBatch=typeof env.HUB_RECIPE_CATALOG_BATCH==='string'?env.HUB_RECIPE_CATALOG_BATCH:undefined;
 if(configuredBatch&&await db.prepare('SELECT operation_key FROM hub_operations WHERE operation_key=?').bind('catalog-complete:'+configuredBatch).first())return;
 if(!Number.isInteger(count)||count<1||count>64)throw new ApiError(503,'recipe_import_invalid','The cookbook import configuration needs correction.');
 let encoded='';for(let i=1;i<=count;i++){const part=env['HUB_RECIPE_CATALOG_'+String(i).padStart(2,'0')];if(typeof part!=='string')throw new ApiError(503,'recipe_import_invalid','A cookbook import part is missing.');encoded+=part;}
 let parsed:ReturnType<typeof object>;
 try{
 const binary=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
 const stream=new Blob([binary]).stream().pipeThrough(new DecompressionStream('gzip'));
 const reader=stream.getReader();const chunks:Uint8Array[]=[];let size=0;try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>8_000_000){await reader.cancel();throw new Error('too large');}chunks.push(p.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}parsed=object(JSON.parse(new TextDecoder().decode(bytes)));
 }catch{throw new ApiError(503,'recipe_import_invalid','The cookbook import could not be read. Existing recipes are unchanged.');}
 const batch=string(parsed.batchId,'Cookbook batch',100);if((configuredBatch&&configuredBatch!==batch)||!/^[a-zA-Z0-9_-]+$/.test(batch)||!Array.isArray(parsed.recipes)||parsed.recipes.length>10000)throw new ApiError(503,'recipe_import_invalid','The cookbook import needs correction.');
 const recipes=parsed.recipes;const size=40;const chunks=Math.ceil(recipes.length/size);
 const imports=Array.from({length:chunks},(_,index)=>{const batchId='catalog_'+batch+'_'+String(index).padStart(5,'0');return{batchId,operationKey:'bootstrap:'+batchId,raw:JSON.stringify({batchId,recipes:recipes.slice(index*size,(index+1)*size)})};});
 if(imports.some(chunk=>chunk.raw.length>200000))throw new ApiError(503,'recipe_import_invalid','A cookbook import chunk exceeds the supported size. Existing recipes are unchanged.');
 // Each completed chunk has the same durable replay protection as ordinary owner imports.
 // Two chunks per request keep SQL work bounded while owner reads advance a large migration.
 const done=await db.prepare('SELECT operation_key FROM hub_operations WHERE operation_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(imports.map(chunk=>chunk.operationKey))).all<{operation_key:string}>();
 const completed=new Set(done.results.map(r=>r.operation_key));let work=0;
 for(const chunk of imports){
 if(work>=2)break;if(completed.has(chunk.operationKey))continue;
 await applyBootstrap(db,chunk.raw,userId);completed.add(chunk.operationKey);work++;
 }
 if(imports.every(chunk=>completed.has(chunk.operationKey)))await db.prepare('INSERT INTO hub_operations(operation_key,fingerprint,result_json,created_at) VALUES(?,?,?,?) ON CONFLICT(operation_key) DO NOTHING').bind('catalog-complete:'+batch,batch,JSON.stringify({total:recipes.length}),new Date().toISOString()).run();
}
