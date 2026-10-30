import type {D1Database,R2Bucket} from '@cloudflare/workers-types';
import {ApiError,object,string} from './domain.ts';
import type {HubRecord} from './domain.ts';

export const MAX_RECIPE_PHOTO_BYTES=40_000;
export const MAX_RECIPE_PHOTO_EDGE=480;
interface PhotoRow{recipe_id:string;object_key:string;sha256:string;width:number;height:number;size_bytes:number;version:number;updated_at:string}
export interface RecipePhotoBindings{DB:D1Database;BUCKET?:R2Bucket;HUB_RECIPE_PHOTO_IMPORT_TOKEN?:string}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const invalid=()=>new ApiError(400,'invalid_recipe_photo','Use a complete, metadata-free, non-animated WebP dish thumbnail.');
const uint24=(v:Uint8Array,i:number)=>v[i]|v[i+1]<<8|v[i+2]<<16;
/** Check actual container/frame dimensions; no metadata or animated frames enter storage. */
export function validateRecipePhoto(bytes:Uint8Array):{width:number;height:number}{
 if(bytes.length>MAX_RECIPE_PHOTO_BYTES)throw new ApiError(413,'recipe_photo_too_large','Use a WebP thumbnail no larger than 40 KB and 480 pixels per edge.');
 const ascii=(i:number,n:number)=>String.fromCharCode(...bytes.subarray(i,i+n));const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<26||ascii(0,4)!=='RIFF'||ascii(8,4)!=='WEBP'||view.getUint32(4,true)+8!==bytes.length)throw invalid();
 let at=12,width=0,height=0,canvas:{width:number;height:number}|undefined,frames=0;
 while(at<bytes.length){if(at+8>bytes.length)throw invalid();const type=ascii(at,4),size=view.getUint32(at+4,true),start=at+8,end=start+size;if(end>bytes.length)throw invalid();
 if(type==='VP8X'){if(size!==10||canvas||frames||bytes[start]&~0x10)throw invalid();canvas={width:uint24(bytes,start+4)+1,height:uint24(bytes,start+7)+1};}
 else if(type==='VP8 '){if(size<10||frames++||bytes[start]&1||ascii(start+3,3)!=='\x9d\x01\x2a')throw invalid();width=view.getUint16(start+6,true)&0x3fff;height=view.getUint16(start+8,true)&0x3fff;}
 else if(type==='VP8L'){if(size<5||frames++||bytes[start]!==0x2f)throw invalid();const bits=view.getUint32(start+1,true);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;if(bits>>>29)throw invalid();}
 else if(type!=='ALPH'||frames)throw invalid();
 at=end+(size%2);if(at>bytes.length)throw invalid();
 }
 if(at!==bytes.length||frames!==1||!width||!height||canvas&&(canvas.width!==width||canvas.height!==height))throw invalid();
 if(width>MAX_RECIPE_PHOTO_EDGE||height>MAX_RECIPE_PHOTO_EDGE)throw new ApiError(413,'recipe_photo_too_large','Use a WebP thumbnail no larger than 40 KB and 480 pixels per edge.');
 return{width,height};
}
export function recipePhotoMetadata(photo:PhotoRow){return{url:'/api/recipes/'+photo.recipe_id+'/photo?v='+photo.sha256,sha256:photo.sha256,width:photo.width,height:photo.height,bytes:photo.size_bytes,version:photo.version};}
export async function attachRecipePhotos(db:D1Database,records:HubRecord[]):Promise<HubRecord[]>{
 const ids=records.filter(r=>r.kind==='recipe').map(r=>r.id);if(!ids.length)return records;
 const rows=await db.prepare('SELECT * FROM hub_recipe_photos WHERE recipe_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<PhotoRow>();const photos=new Map(rows.results.map(row=>[row.recipe_id,recipePhotoMetadata(row)]));return records.map(r=>photos.has(r.id)?{...r,data:{...r.data,photo:photos.get(r.id)}}:r);
}
async function photoBody(request:Request){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new ApiError(415,'invalid_content_type','Use JSON for this action.');
 const max=180_000;if(Number(request.headers.get('Content-Length'))>max)throw new ApiError(413,'too_large','This thumbnail batch is too large.');const reader=request.body?.getReader();if(!reader)throw invalid();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max){await reader.cancel();throw new ApiError(413,'too_large','This thumbnail batch is too large.');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}try{return object(JSON.parse(new TextDecoder().decode(bytes)));}catch{throw new ApiError(400,'invalid_json','The thumbnail batch could not be read.');}finally{bytes.fill(0);chunks.length=0;}
}
function decodePhoto(value:unknown){const encoded=string(value,'Thumbnail',Math.ceil(MAX_RECIPE_PHOTO_BYTES/3)*4);if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw invalid();try{return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));}catch{throw invalid();}}
function validateBatch(entries:unknown[]){let total=0;for(const entry of entries){const b=object(entry);const data=decodePhoto(b.imageBase64);try{validateRecipePhoto(data);total+=data.length;}finally{data.fill(0);}}if(total>120_000)throw new ApiError(413,'too_large','Use a thumbnail batch no larger than 120 KB.');}
async function savePhoto(env:RecipePhotoBindings,input:unknown){
 if(!env.BUCKET)throw new ApiError(503,'recipe_photo_storage_unavailable','Dish thumbnail storage is not connected.');const b=object(input);const id=string(b.recipeId,'Recipe ID',150);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw invalid();
 const recipe=await env.DB.prepare("SELECT id,version FROM hub_records WHERE id=? AND kind='recipe'").bind(id).first<{id:string;version:number}>();if(!recipe)throw new ApiError(404,'not_found','Choose a saved recipe.');
 if(!Number.isSafeInteger(b.version)||Number(b.version)<1)throw new ApiError(400,'invalid_input','Include the current recipe version.');if(recipe.version!==b.version)throw new ApiError(409,'version_conflict','This recipe changed. Refresh before adding its thumbnail.');
 const previous=await env.DB.prepare('SELECT * FROM hub_recipe_photos WHERE recipe_id=?').bind(id).first<PhotoRow>();const bytes=decodePhoto(b.imageBase64);let dimensions:{width:number;height:number};let sha:string;
 try{dimensions=validateRecipePhoto(bytes);sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(c=>c.toString(16).padStart(2,'0')).join('');
 if(previous?.sha256===sha)return{recipeId:id,photo:recipePhotoMetadata(previous),unchanged:true};
 const expected=b.photoVersion??0;if(!Number.isSafeInteger(expected)||Number(expected)<0)throw new ApiError(400,'invalid_input','Include a valid thumbnail version.');if((previous?.version??0)!==expected)throw new ApiError(409,'version_conflict','This thumbnail changed. Refresh before replacing it.');
 const key='recipe-thumbnails/'+sha+'.webp';if(!await env.BUCKET.head(key))await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/webp',cacheControl:'private, max-age=3600'},customMetadata:{purpose:'recipe-dish-thumbnail'}});
 const now=new Date().toISOString();const result=await env.DB.prepare("INSERT INTO hub_recipe_photos(recipe_id,object_key,sha256,width,height,size_bytes,version,updated_at) SELECT ?,?,?,?,?,?,1,? WHERE EXISTS(SELECT 1 FROM hub_records WHERE id=? AND kind='recipe' AND version=?) ON CONFLICT(recipe_id) DO UPDATE SET object_key=excluded.object_key,sha256=excluded.sha256,width=excluded.width,height=excluded.height,size_bytes=excluded.size_bytes,version=hub_recipe_photos.version+1,updated_at=excluded.updated_at WHERE hub_recipe_photos.version=?").bind(id,key,sha,dimensions.width,dimensions.height,bytes.length,now,id,b.version,expected).run();
 if(!result.meta.changes)throw new ApiError(409,'version_conflict','This recipe or thumbnail changed. Refresh before retrying.');
 const saved=await env.DB.prepare('SELECT * FROM hub_recipe_photos WHERE recipe_id=?').bind(id).first<PhotoRow>();return{recipeId:id,photo:recipePhotoMetadata(saved!),unchanged:false};
 }finally{bytes.fill(0);}
}
/** Called only after shared membership and same-origin write checks. */
export async function handleRecipePhotoRoute(request:Request,env:RecipePhotoBindings,path:string,admin:boolean):Promise<Response|null>{
 const image=path.match(/^\/api\/recipes\/([a-zA-Z0-9_-]+)\/photo$/);
 if(image&&request.method==='GET'){
 const photo=await env.DB.prepare("SELECT p.* FROM hub_recipe_photos p JOIN hub_records r ON r.id=p.recipe_id AND r.kind='recipe' WHERE p.recipe_id=?").bind(image[1]).first<PhotoRow>();if(!photo||!env.BUCKET)throw new ApiError(404,'not_found','No dish thumbnail is saved for this recipe.');const file=await env.BUCKET.get(photo.object_key);if(!file)throw new ApiError(404,'not_found','The dish thumbnail is unavailable.');
 return new Response(await file.arrayBuffer(),{headers:{'Content-Type':'image/webp','Cache-Control':'private, max-age=3600','Vary':'Cookie','X-Content-Type-Options':'nosniff','ETag':'"'+photo.sha256+'"','Content-Length':String(photo.size_bytes)}});
 }
 if((image&&request.method==='POST')||(path==='/api/recipes/photos-import'&&request.method==='POST')){if(!admin)throw new ApiError(403,'owner_only','Only the household owner can import dish thumbnails.');const b=await photoBody(request);const entries=image?[{...b,recipeId:image[1]}]:b.entries;if(!Array.isArray(entries)||entries.length<1||entries.length>20)throw new ApiError(400,'invalid_input','Import one to twenty thumbnails at a time.');validateBatch(entries);const results=[];for(const entry of entries)results.push(await savePhoto(env,entry));return json({results});}
 if(path==='/api/recipes/photos-status'&&request.method==='GET'){if(!admin)throw new ApiError(403,'owner_only','Only the household owner can inspect thumbnail storage.');const rows=await env.DB.prepare("SELECT p.* FROM hub_recipe_photos p JOIN hub_records r ON r.id=p.recipe_id AND r.kind='recipe' ORDER BY p.recipe_id").all<PhotoRow>();const objects=new Map(rows.results.map(r=>[r.object_key,r.size_bytes]));return json({configured:!!env.BUCKET,photoCount:rows.results.length,objectCount:objects.size,bytes:[...objects.values()].reduce((a,b)=>a+b,0),photos:rows.results.map(row=>({recipeId:row.recipe_id,...recipePhotoMetadata(row)}))});}
 return null;
}

/** Temporary narrowly scoped grant for an explicitly authorized thumbnail backfill. Disabled without its runtime secret. */
export async function handleRecipePhotoMigration(request:Request,env:RecipePhotoBindings):Promise<Response|null>{
 if(new URL(request.url).pathname!=='/api/recipes/photos-migration')return null;
 if(request.method!=='POST')throw new ApiError(405,'method_not_allowed','Use a thumbnail migration request.');
 const expected=env.HUB_RECIPE_PHOTO_IMPORT_TOKEN;const supplied=request.headers.get('X-Bird-Recipe-Import')??'';
 if(typeof expected!=='string'||expected.length<32||expected.length>128)throw new ApiError(404,'not_found','No thumbnail migration is active.');
 // Compare equal-size digests so neither differing lengths nor prefixes bypass the comparison.
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(expected)));
 const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(supplied)));let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];
 if(mismatch)throw new ApiError(403,'thumbnail_import_denied','The thumbnail migration grant was not accepted.');
 const owner=await env.DB.prepare('SELECT user_id FROM hub_owner WHERE singleton=1').first<{user_id:string}>();if(!owner)throw new ApiError(403,'owner_required','An existing household owner is required.');
 const input=await photoBody(request);
 if(Array.isArray(input.verify)){
  if(input.verify.length<1||input.verify.length>1000||input.verify.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,150}$/.test(id)))throw new ApiError(400,'invalid_input','Verify up to 1000 existing thumbnail IDs.');
  const rows=await env.DB.prepare("SELECT p.* FROM hub_recipe_photos p JOIN hub_records r ON r.id=p.recipe_id AND r.kind='recipe' WHERE p.recipe_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(input.verify)).all<PhotoRow>();
  return json({results:rows.results.map(row=>({recipeId:row.recipe_id,...recipePhotoMetadata(row)}))});
 }
 if(!Array.isArray(input.entries)||input.entries.length<1||input.entries.length>20)throw new ApiError(400,'invalid_input','Import one to twenty thumbnails at a time.');
 validateBatch(input.entries);
 // Distinct recipe writes are independent. Four workers preserve input order while
 // bounding simultaneous R2/D1 work; all started work settles before an error returns.
 const entries=input.entries;const results:Array<Awaited<ReturnType<typeof savePhoto>>&{verified:true}>=new Array(entries.length);let cursor=0;let failed=false;let failure:unknown;
 const worker=async()=>{while(!failed){const index=cursor++;if(index>=entries.length)return;try{const saved=await savePhoto(env,entries[index]);const file=await env.BUCKET!.get('recipe-thumbnails/'+saved.photo.sha256+'.webp');if(!file)throw new ApiError(503,'thumbnail_verification_failed','A stored thumbnail could not be verified.');const bytes=await file.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==saved.photo.sha256||bytes.byteLength!==saved.photo.bytes)throw new ApiError(503,'thumbnail_verification_failed','A stored thumbnail could not be verified.');results[index]={...saved,verified:true};}catch(error){if(!failed){failed=true;failure=error;}}}};
 await Promise.all(Array.from({length:Math.min(4,entries.length)},worker));if(failed)throw failure;
 return json({results});
}
