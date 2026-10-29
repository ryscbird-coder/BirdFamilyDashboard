export const KINDS = ['calendar','shopping','reminder','recipe','meal','profile','source'] as const;
export type Kind = typeof KINDS[number];
export type Data = Record<string, unknown>;
export interface HubRecord { id:string; kind:Kind; data:Data; version:number; createdAt:string; updatedAt:string; }
export class ApiError extends Error { status:number; code:string; constructor(status:number, code:string, message:string) { super(message); this.status=status;this.code=code; } }
export function object(value:unknown):Data { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400,'invalid_input','Expected an object.'); return value as Data; }
export function string(value:unknown, name:string, max=200, required=true):string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new ApiError(400,'invalid_input',`${name} must be ${required?'a non-empty':'a'} text value, up to ${max} characters.`);
  return value.trim();
}
function optional(value:unknown,name:string,max=200):string|undefined { return value == null || value === '' ? undefined : string(value,name,max,false); }
function number(value:unknown,name:string,min:number,max:number,fallback?:number):number {
  if(value == null && fallback !== undefined)return fallback;
  if(typeof value !== 'number'||!Number.isFinite(value)||value<min||value>max)throw new ApiError(400,'invalid_input',`${name} must be between ${min} and ${max}.`);return value;
}
function bool(value:unknown,fallback=false):boolean { if(value===undefined)return fallback; if(typeof value!=='boolean')throw new ApiError(400,'invalid_input','Expected a checkbox value.');return value; }
function choice(value:unknown,name:string,values:readonly string[],fallback?:string):string { if(value===undefined&&fallback)return fallback;if(typeof value!=='string'||!values.includes(value))throw new ApiError(400,'invalid_input',`${name} must be ${values.join(', ')}.`);return value; }
function date(value:unknown,name:string,required=true):string|undefined { if(!required&&(value==null||value===''))return undefined;const s=string(value,name,40);if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==s.slice(0,10))throw new ApiError(400,'invalid_input',`${name} must be a valid date.`);return s; }
function url(value:unknown,name:string):string|undefined { const s=optional(value,name,1000);if(!s)return undefined;try{const u=new URL(s);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw 0;return s;}catch{throw new ApiError(400,'invalid_input',`${name} must be an HTTP or HTTPS link.`);} }
function strings(value:unknown,name:string,max=20):string[] { if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)throw new ApiError(400,'invalid_input',`${name} has too many entries.`);return value.map(v=>string(v,name,100)); }
function clean(value:Data):Data { return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined)); }
export function validateData(kind:Kind, raw:unknown):Data {
 const d=object(raw);
 switch(kind){
 case 'calendar': {
  const startAt=date(d.startAt,'Start')!;const endAt=date(d.endAt??d.startAt,'End')!;if(Date.parse(endAt)<Date.parse(startAt))throw new ApiError(400,'invalid_input','End must follow start.');
  return clean({title:string(d.title,'Title'),startAt,endAt,allDay:bool(d.allDay),person:optional(d.person,'Person'),location:optional(d.location,'Location',500),notes:optional(d.notes,'Notes',4000),status:choice(d.status,'Status',['confirmed','tentative'],'confirmed'),origin:choice(d.origin,'Origin',['manual','icloud'],'manual'),sourceId:optional(d.sourceId,'Source ID'),providerId:optional(d.providerId,'Provider ID',2000),calendarId:optional(d.calendarId,'Calendar ID',2000),calendarTitle:optional(d.calendarTitle,'Calendar title',300),color:optional(d.color,'Calendar colour',40)});
 }
 case 'shopping':return clean({title:string(d.title,'Item'),listName:string(d.listName??'Groceries','List'),quantity:optional(d.quantity,'Quantity'),done:bool(d.done),category:optional(d.category,'Category'),amount:d.amount==null?undefined:number(d.amount,'Amount',0,100000),unit:optional(d.unit,'Unit',40),sourceMealId:optional(d.sourceMealId,'Meal ID'),sourceRecipeId:optional(d.sourceRecipeId,'Recipe ID')});
 case 'reminder':return clean({title:string(d.title,'Title'),dueAt:date(d.dueAt,'Due date',false),done:bool(d.done),assignedTo:optional(d.assignedTo,'Assigned to'),repeat:choice(d.repeat,'Repeat',['none','daily','weekly','monthly'],'none'),notes:optional(d.notes,'Notes',4000),lastCompletedAt:date(d.lastCompletedAt,'Completed date',false)});
 case 'recipe': {
  if(!Array.isArray(d.ingredients)||d.ingredients.length>100)throw new ApiError(400,'invalid_input','Recipes need an ingredients list, up to 100 ingredients.');
  return clean({title:string(d.title,'Recipe title'),ingredients:d.ingredients.map(v=>{const x=object(v);return clean({name:string(x.name,'Ingredient'),amount:x.amount==null?undefined:number(x.amount,'Amount',0,100000),unit:optional(x.unit,'Unit',40)});}),instructions:string(d.instructions,'Instructions',20000,false),servings:number(d.servings,'Servings',1,100,4),notes:optional(d.notes,'Notes',5000),tags:strings(d.tags,'Tags'),prepMinutes:d.prepMinutes==null?undefined:number(d.prepMinutes,'Preparation time',0,10000),cookMinutes:d.cookMinutes==null?undefined:number(d.cookMinutes,'Cooking time',0,10000),sourceUrl:url(d.sourceUrl,'Recipe source')});
 }
 case 'meal': {
  const day=date(d.day,'Meal day')!;if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new ApiError(400,'invalid_input','Meal day must be YYYY-MM-DD.');
  if(!d.recipeId&&!d.title&&!d.recipeSnapshot)throw new ApiError(400,'invalid_input','Choose a recipe or enter a meal title.');
  return clean({day,slot:choice(d.slot,'Meal',['breakfast','lunch','dinner'],'dinner'),recipeId:optional(d.recipeId,'Recipe ID'),title:optional(d.title,'Meal title'),servings:d.servings==null?undefined:number(d.servings,'Servings',1,100),recipeSnapshot:d.recipeSnapshot?validateData('recipe',d.recipeSnapshot):undefined});
 }
 case 'profile':return {name:string(d.name,'Name'),color:string(d.color??'#7dd3fc','Colour',40)};
 case 'source':return clean({title:string(d.title,'Source title'),sourceId:string(d.sourceId,'Source ID'),observedAt:date(d.observedAt,'Observed time',false),lastSuccess:date(d.lastSuccess,'Last success',false),runStatus:choice(d.runStatus,'Run status',['ready','stale','error','awaiting_access','paused'],'awaiting_access'),sourceLink:url(d.sourceLink,'Source link'),detail:optional(d.detail,'Detail',4000),adapter:choice(d.adapter,'Adapter',['workflow','manual','icloud'],'manual'),connectionEnabled:bool(d.connectionEnabled),connectionConfiguredAt:date(d.connectionConfiguredAt,'Connection configured time',false),scheduleLabel:optional(d.scheduleLabel,'Schedule',500),nextRunAt:date(d.nextRunAt,'Next scheduled run',false),schedulePaused:d.schedulePaused===undefined?undefined:bool(d.schedulePaused),automationId:optional(d.automationId,'Automation ID')});
 }
}
export function validateAdmin(raw:unknown):Data {
 const d=object(raw);return clean({workflow:string(d.workflow,'Workflow'),sourceId:string(d.sourceId,'Source ID'),summary:string(d.summary,'Summary',12000),action:optional(d.action,'Action',4000),owner:optional(d.owner,'Owner'),dueAt:date(d.dueAt,'Due date',false),sourceLink:url(d.sourceLink,'Source link'),observedAt:date(d.observedAt,'Observed time'),lastSuccess:date(d.lastSuccess,'Last success',false),runStatus:choice(d.runStatus,'Run status',['ready','stale','error','awaiting_access','paused'],'ready')});
}
export function freshness(lastSuccess:unknown,now=Date.now()):'green'|'yellow'|'red'|'unknown' { if(typeof lastSuccess!=='string'||!Number.isFinite(Date.parse(lastSuccess)))return 'unknown';if(Date.parse(lastSuccess)-now>300000)return 'unknown';const age=Math.max(0,now-Date.parse(lastSuccess));return age<=3600000?'green':age<=86400000?'yellow':'red'; }
export function stable(value:unknown):string { if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';return JSON.stringify(value)??'null'; }
export function nextReminderDue(current:string,repeat:string):string {
 const d=new Date(current);if(repeat==='daily')d.setUTCDate(d.getUTCDate()+1);if(repeat==='weekly')d.setUTCDate(d.getUTCDate()+7);if(repeat==='monthly'){const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,max));}return /^\d{4}-\d{2}-\d{2}$/.test(current)?d.toISOString().slice(0,10):d.toISOString();
}
export function scaledIngredients(recipe:Data,servings:number,excluded:string[]=[]):Data[] {
 const original=number(recipe.servings,'Recipe servings',1,100,4);const scale=number(servings,'Servings',1,100)/original;const groups=new Map<string,Data>();
 for(const v of recipe.ingredients as Data[]){if(excluded.includes(String(v.name)))continue;const unit=String(v.unit??'').trim();const name=String(v.name).trim();const amount=typeof v.amount==='number'?Math.round(v.amount*scale*1000)/1000:undefined;const key=name.toLowerCase()+'|'+unit.toLowerCase()+'|'+(amount===undefined?'text':'number');const old=groups.get(key);if(old&&amount!==undefined)old.amount=Math.round((Number(old.amount)+amount)*1000)/1000;else if(!old)groups.set(key,clean({name,amount,unit:unit||undefined}));}
 return [...groups.values()];
}

export function validateFeed(raw:unknown):Data {const d=object(raw);const summary=optional(d.summary,'Summary',12000);const body=optional(d.body,'Body',20000);if(!summary&&!body)throw new ApiError(400,'invalid_input','A household update needs a summary or body.');return clean({workflow:string(d.workflow,'Workflow'),sourceId:string(d.sourceId,'Source ID'),title:string(d.title,'Title'),summary,body,sourceLink:url(d.sourceLink,'Source link'),observedAt:date(d.observedAt,'Observed time'),lastSuccess:date(d.lastSuccess,'Last success',false),runStatus:choice(d.runStatus,'Run status',['ready','stale','error','awaiting_access','paused'],'ready')});}
