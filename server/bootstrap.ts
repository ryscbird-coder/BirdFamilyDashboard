import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { ApiError, object, stable, string, validateAdmin, validateData, validateFeed } from './domain.ts';
import type { Data } from './domain.ts';
interface Invite {email:string;displayName:string;}
interface Entry {id:string;data:Data;}
interface SourceConfiguration {id:string;data:Data;}
interface Bootstrap {batchId:string;invites:Invite[];sources:Entry[];results:Entry[];householdFeed:Entry[];sourceConfigurations:SourceConfiguration[];}
function boundedArray(value:unknown,max:number):unknown[]{if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)throw new Error('Invalid import array.');return value;}
function id(value:unknown):string{const s=string(value,'Bootstrap ID',150);if(!/^[a-zA-Z0-9_-]{1,150}$/.test(s))throw new Error('Invalid import ID.');return s;}
function parseBootstrap(raw:string):Bootstrap{
 if(raw.length>200000)throw new Error('Import exceeds limit.');const value=object(JSON.parse(raw));const batchId=id(value.batchId);
 const invites=boundedArray(value.invites,10).map(v=>{const item=object(v);const email=string(item.email,'Email',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Invalid invitation.');return{email,displayName:string(item.displayName,'Name')};});
 const sources=boundedArray(value.sources,50).map(v=>{const item=object(v);return{id:id(item.id),data:validateData('source',item.data)};});
 const results=boundedArray(value.results,100).map(v=>{const item=object(v);return{id:id(item.id),data:validateAdmin(item.data)};});
 const householdFeed=boundedArray(value.householdFeed,50).map(v=>{const item=object(v);return{id:id(item.id),data:validateFeed(item.data)};});
 const sourceConfigurations=boundedArray(value.sourceConfigurations,50).map(v=>{const item=object(v);if(item.adapter!=='workflow'||typeof item.connectionEnabled!=='boolean')throw new Error('Invalid source configuration.');const checked=validateData('source',{title:'Configuration',sourceId:'configuration',adapter:'workflow',connectionEnabled:item.connectionEnabled,scheduleLabel:item.scheduleLabel,nextRunAt:item.nextRunAt,schedulePaused:item.schedulePaused,automationId:item.automationId});const data:Data={adapter:'workflow',connectionEnabled:item.connectionEnabled};for(const field of ['scheduleLabel','nextRunAt','schedulePaused','automationId'])if(checked[field]!==undefined)data[field]=checked[field];return{id:id(item.id),data};});
 if(new Set(sources.map(s=>s.data.sourceId)).size!==sources.length)throw new Error('Duplicate source identifiers.');
 if(new Set(sources.map(s=>s.id)).size!==sources.length||new Set(results.map(s=>s.id)).size!==results.length)throw new Error('Duplicate import IDs.');
 return{batchId,invites,sources,results,householdFeed,sourceConfigurations};
}
async function digest(value:string):Promise<string>{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
/** One-time owner-authorized deployment import. Configuration stays in runtime settings, never Git or responses. */
export async function applyBootstrap(db:D1Database,raw:string|undefined,userId:string):Promise<void>{
 if(!raw)return;
 // Defense in depth: the first platform-authenticated owner is the only bootstrap actor.
 const owner=await db.prepare('SELECT user_id FROM hub_owner WHERE singleton=1').first<{user_id:string}>();if(owner?.user_id!==userId)return;
 let parsed:Bootstrap;try{parsed=parseBootstrap(raw);}catch{throw new ApiError(503,'bootstrap_configuration_invalid','The owner’s one-time import configuration needs correction. No import was applied.');}
 const op='bootstrap:'+parsed.batchId;const prior=await db.prepare('SELECT operation_key FROM hub_operations WHERE operation_key=?').bind(op).first();if(prior)return;
 const now=new Date().toISOString();const nonce=crypto.randomUUID();const fingerprint=await digest(stable(parsed));
 const condition="EXISTS(SELECT 1 FROM hub_operations WHERE operation_key=? AND json_extract(result_json,'$.nonce')=?)";
 const statements:D1PreparedStatement[]=[db.prepare('INSERT INTO hub_operations(operation_key,fingerprint,result_json,created_at) VALUES(?,?,?,?) ON CONFLICT(operation_key) DO NOTHING').bind(op,fingerprint,JSON.stringify({batchId:parsed.batchId,nonce}),now)];
 for(const invite of parsed.invites)statements.push(db.prepare(`INSERT INTO hub_invites(email,display_name,created_at) SELECT ?,?,? WHERE ${condition} ON CONFLICT DO NOTHING`).bind(invite.email,invite.displayName,now,op,nonce));
 for(const source of parsed.sources)statements.push(db.prepare(`INSERT INTO hub_records(id,kind,data,version,created_at,updated_at,updated_by) SELECT ?,'source',?,1,?,?,? WHERE ${condition} AND NOT EXISTS(SELECT 1 FROM hub_records WHERE kind='source' AND json_extract(data,'$.sourceId')=?) ON CONFLICT DO NOTHING`).bind(source.id,JSON.stringify(source.data),now,now,userId,op,nonce,source.data.sourceId));
 for(const result of parsed.results)statements.push(db.prepare(`INSERT INTO hub_admin_results(id,workflow,source_id,data,version,created_at,updated_at) SELECT ?,?,?,?,1,?,? WHERE ${condition} ON CONFLICT DO NOTHING`).bind(result.id,result.data.workflow,result.data.sourceId,JSON.stringify(result.data),now,now,op,nonce));
 for(const feed of parsed.householdFeed)statements.push(db.prepare(`INSERT INTO hub_household_feed(id,workflow,source_id,data,version,created_at,updated_at) SELECT ?,?,?,?,1,?,? WHERE ${condition} ON CONFLICT DO NOTHING`).bind(feed.id,feed.data.workflow,feed.data.sourceId,JSON.stringify(feed.data),now,now,op,nonce));
 for(const source of parsed.sourceConfigurations)statements.push(db.prepare(`UPDATE hub_records SET data=json_patch(data,json(?)),version=version+1,updated_at=?,updated_by=? WHERE id=? AND kind='source' AND json_extract(data,'$.connectionConfiguredAt') IS NULL AND ${condition}`).bind(JSON.stringify({...source.data,connectionConfiguredAt:now}),now,userId,source.id,op,nonce));
 await db.batch(statements);
}
