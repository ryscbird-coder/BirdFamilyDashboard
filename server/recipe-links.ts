import { ApiError } from './domain.ts';
import { parseIngredient } from '../app/recipe-utils.ts';
import { inferredCountries } from '../app/recipe-world.ts';
import { recipePhotoSource } from './recipe-photo-source.ts';
const HOSTS=new Set(['www.bbcgoodfood.com','bbcgoodfood.com','www.goodfood.com','goodfood.com','www.hellofresh.co.uk','hellofresh.co.uk','www.gousto.co.uk','gousto.co.uk']);
export function recipeURL(raw:string){let url:URL;try{url=new URL(raw);}catch{throw new ApiError(400,'invalid_url','Paste a full recipe link.');}if(url.protocol!=='https:'||url.port||url.username||url.password||!HOSTS.has(url.hostname))throw new ApiError(400,'unsupported_recipe_site','Use a BBC Good Food, HelloFresh or Gousto HTTPS recipe link. You can also add any recipe manually.');return url;}
function text(value:unknown):string {return String(value??'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();}
function minutes(value:unknown){const m=String(value||'').match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?/);return m?Number(m[1]||0)*1440+Number(m[2]||0)*60+Number(m[3]||0):undefined;}
export function recipeFromHTML(html:string,sourceUrl:string){
 let found:any;
 function walk(value:any,depth=0){if(!value||depth>12||found)return;if(Array.isArray(value)){for(const x of value)walk(x,depth+1);}else if(typeof value==='object'){const types=[value['@type']].flat();if(types.includes('Recipe')){found=value;return;}for(const x of Object.values(value))walk(x,depth+1);}}
 for(const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(script[1]));}catch{}}
 if(!found||!Array.isArray(found.recipeIngredient)||!found.recipeIngredient.length)throw new ApiError(422,'recipe_not_found','This page does not expose readable recipe ingredients. Add it manually or paste the ingredients and method from the page.');
 const steps:string[]=[];function step(v:any){if(Array.isArray(v))v.forEach(step);else if(typeof v==='string')steps.push(text(v));else if(v?.itemListElement)step(v.itemListElement);else if(v?.text)steps.push(text(v.text));}step(found.recipeInstructions);
 const yieldText=text([found.recipeYield].flat()[0]);const match=yieldText.match(/\d+/);const servings=match?Math.max(1,Math.min(100,Number(match[0]))):1;
 return {photoSourceUrl:recipePhotoSource(found.thumbnailUrl||found.image),title:text(found.name).slice(0,500),servings,ingredients:found.recipeIngredient.slice(0,100).map((x:unknown)=>parseIngredient(text(x))),instructions:steps.join('\n\n').slice(0,20000),sourceUrl,collection:'Online recipes',countryCodes:inferredCountries([found.recipeCuisine,found.name]),tags:['Online recipes'],prepMinutes:minutes(found.prepTime),cookMinutes:minutes(found.cookTime),notes:`Imported from ${new URL(sourceUrl).hostname}. Check the portions, ingredient quantities and method before saving. Country suggestions use the page’s cuisine or a clear dish name and remain editable.${!match?' The page did not specify servings; set the correct number (currently 1).':''}${!steps.length?' Method could not be extracted; copy it from the original page.':''}`};
}
export async function importRecipeLink(raw:string,fetcher:typeof fetch=fetch){
 let url=recipeURL(raw);const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
 try{for(let redirects=0;redirects<4;redirects++){
 const response=await fetcher(url.href,{redirect:'manual',signal:controller.signal,headers:{Accept:'text/html'}});
 if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)break;url=recipeURL(new URL(location,url).href);continue;}
 if(!response.ok)throw new ApiError(422,'recipe_unavailable','This recipe website could not be read. You can still add the recipe manually.');
 if(!response.headers.get('content-type')?.includes('text/html'))throw new ApiError(422,'not_recipe_page','Open a recipe page and paste its link.');
 const reader=response.body?.getReader();if(!reader)break;let size=0;const chunks:Uint8Array[]=[];try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1500000){await reader.cancel();throw new ApiError(413,'page_too_large','This page is too large to import. Add the recipe manually.');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return recipeFromHTML(new TextDecoder().decode(bytes),url.href);
 }throw new ApiError(422,'recipe_redirects','This link redirects too many times. Paste the final recipe page link.');
 }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(422,'recipe_unavailable','The recipe website did not respond. Try again or add the recipe manually.');}finally{clearTimeout(timeout);}
}
