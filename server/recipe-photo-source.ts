import {ApiError} from './domain.ts';
const PHOTO_HOSTS=new Set(['images.immediate.co.uk','img.hellofresh.com','image.hellofresh.co.uk','production-media.gousto.co.uk','www.gousto.co.uk']);
export function validateRecipePhotoSourceUrl(value:unknown):string|undefined{
 if(value===undefined||value===null||value==='')return undefined;
 if(typeof value!=='string'||value.length>2000)throw new ApiError(400,'invalid_photo_source','Use a supported publisher dish image.');
 let url:URL;try{url=new URL(value);}catch{throw new ApiError(400,'invalid_photo_source','Use a supported publisher dish image.');}
 if(url.protocol!=='https:'||url.port||url.username||url.password||!PHOTO_HOSTS.has(url.hostname))throw new ApiError(400,'invalid_photo_source','Use a supported publisher dish image.');
 return url.href;
}
export function recipePhotoSource(value:unknown):string|undefined{
 const candidates:Array<string>=[];
 function collect(v:any,depth=0){if(depth>3||!v)return;if(typeof v==='string')candidates.push(v);else if(Array.isArray(v))v.forEach(x=>collect(x,depth+1));else if(typeof v==='object')collect(v.thumbnailUrl||v.contentUrl||v.url,depth+1);}
 collect(value);
 for(const candidate of candidates){try{const valid=validateRecipePhotoSourceUrl(candidate);if(!valid)continue;const url=new URL(valid);if(url.hostname==='images.immediate.co.uk'){url.searchParams.set('resize','480,320');url.searchParams.set('quality','60');url.searchParams.set('webp','true');}return url.href;}catch{}}
 return undefined;
}
