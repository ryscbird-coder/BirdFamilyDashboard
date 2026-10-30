import type {D1Database,D1PreparedStatement} from '@cloudflare/workers-types';
import {ApiError,object,stable,string,validateData} from './domain.ts';
import type {Data} from './domain.ts';
interface Correction{id:string;version:number;data:Data}
interface Envelope{batchId:string;recipes:Correction[]}
function parseCorrections(raw:string):Envelope{
 if(raw.length>200_000||new TextEncoder().encode(raw).byteLength>200_000)throw new Error('Size limit.');const value=object(JSON.parse(raw));if(Object.keys(value).some(key=>!['batchId','recipes'].includes(key)))throw new Error('Recipe corrections only.');
 const batchId=string(value.batchId,'Correction batch',100);if(!/^[a-zA-Z0-9_-]+$/.test(batchId)||!Array.isArray(value.recipes)||!value.recipes.length||value.recipes.length>40)throw new Error('Invalid correction batch.');
 const recipes=value.recipes.map(rawEntry=>{const entry=object(rawEntry);if(Object.keys(entry).some(key=>!['id','version','data'].includes(key)))throw new Error('Invalid correction entry.');const id=string(entry.id,'Recipe ID',150);if(!/^[a-zA-Z0-9_-]+$/.test(id)||!Number.isSafeInteger(entry.version)||Number(entry.version)<1)throw new Error('Invalid recipe version.');return{id,version:Number(entry.version),data:validateData('recipe',entry.data)};});
 if(new Set(recipes.map(recipe=>recipe.id)).size!==recipes.length)throw new Error('Duplicate correction IDs.');return{batchId,recipes};
}
async function digest(value:string){const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));return[...hash].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
/** Owner-only, one-time source corrections; never inserts records or changes other kinds. */
export async function applyRecipeCorrections(db:D1Database,raw:string|undefined,userId:string):Promise<void>{
 if(!raw)return;const owner=await db.prepare('SELECT user_id FROM hub_owner WHERE singleton=1').first<{user_id:string}>();if(owner?.user_id!==userId)return;
 let envelope:Envelope;try{envelope=parseCorrections(raw);}catch{throw new ApiError(503,'recipe_corrections_invalid','The recipe correction import needs checking. No corrections were applied.');}
 const operation='recipe-corrections:'+envelope.batchId;const fingerprint=await digest(stable(envelope));const prior=await db.prepare('SELECT fingerprint FROM hub_operations WHERE operation_key=?').bind(operation).first<{fingerprint:string}>();if(prior){if(prior.fingerprint!==fingerprint)throw new ApiError(409,'recipe_corrections_conflict','This correction batch was already used. Existing recipes are unchanged.');return;}
 const now=new Date().toISOString(),nonce=crypto.randomUUID();const expected=JSON.stringify(envelope.recipes.map(({id,version})=>({id,version})));
 // Admission checks every current row/version inside the same D1 transaction as
 // all updates. If any recipe changed after review, no marker or row is written.
 const statements:D1PreparedStatement[]=[db.prepare("INSERT INTO hub_operations(operation_key,fingerprint,result_json,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM hub_owner WHERE singleton=1 AND user_id=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) c LEFT JOIN hub_records r ON r.id=json_extract(c.value,'$.id') WHERE r.id IS NULL OR r.kind!='recipe' OR r.version!=json_extract(c.value,'$.version')) ON CONFLICT(operation_key) DO NOTHING").bind(operation,fingerprint,JSON.stringify({batchId:envelope.batchId,nonce}),now,userId,expected)];
 const admitted="EXISTS(SELECT 1 FROM hub_operations WHERE operation_key=? AND fingerprint=? AND json_extract(result_json,'$.nonce')=?)";
 for(const recipe of envelope.recipes)statements.push(db.prepare(`UPDATE hub_records SET data=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND kind='recipe' AND version=? AND ${admitted}`).bind(JSON.stringify(recipe.data),now,userId,recipe.id,recipe.version,operation,fingerprint,nonce));
 await db.batch(statements);
 const saved=await db.prepare('SELECT fingerprint FROM hub_operations WHERE operation_key=?').bind(operation).first<{fingerprint:string}>();if(!saved||saved.fingerprint!==fingerprint)throw new ApiError(409,'recipe_corrections_conflict','A recipe changed or is no longer available. No corrections were applied; review current versions before retrying.');
}
