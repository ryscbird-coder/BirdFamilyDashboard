const helloFreshBrand=/\bhello[\s._-]*fresh\b/i;
/** Present a single publisher category while retaining original import provenance. */
export function recipeCollectionName(data:Record<string,any>):string{
 if(helloFreshBrand.test(String(data.collection||''))||(Array.isArray(data.tags)&&data.tags.some(tag=>typeof tag==='string'&&helloFreshBrand.test(tag))))return 'HelloFresh';
 try{const host=new URL(String(data.sourceUrl||'')).hostname.toLowerCase();if(['hellofresh.co.uk','www.hellofresh.co.uk','hellofresh.com','www.hellofresh.com'].includes(host))return 'HelloFresh';}catch{}
 return typeof data.collection==='string'?data.collection:'';
}
export function recipeTagLabels(tags:unknown):string[]{
 return Array.isArray(tags)?[...new Set(tags.filter((tag):tag is string=>typeof tag==='string').map(tag=>helloFreshBrand.test(tag)?'HelloFresh':tag))]:[];
}
