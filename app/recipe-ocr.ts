export type RecipeDraft={title:string;ingredients:{name:string;amount?:number;unit?:string}[];instructions:string;servings:number;notes?:string};
// OCR never invents absent fields. Ambiguous lines remain verbatim for review.
export function recipeFromText(text:string):RecipeDraft {
 const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const title=lines.find(x=>!/^ingredients|^method|^directions|^instructions|^serves/i.test(x))||'';
 const servings=Number(text.match(/(?:serves|servings|yield)\s*:?\s*(\d+)/i)?.[1]||1);
 const start=lines.findIndex(x=>/^ingredients\s*:?$/i.test(x));
 const end=lines.findIndex((x,i)=>i>start&&/^(method|directions|instructions|preparation)\s*:?$/i.test(x));
 const ingredients=start>=0?lines.slice(start+1,end>=0?end:undefined).map(x=>{
  const m=x.replace(/^[•*-]\s*/,'').match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|tsp|tbsp|cups?|oz|lb)\s+(.+)$/i);
  return m?{amount:Number(m[1]),unit:m[2].toLowerCase(),name:m[3]}:{name:x};
 }):[];
 return {title,servings,ingredients,instructions:end>=0?lines.slice(end+1).join('\n'):'',notes:'Scanned with on-device OCR. Check every quantity and step against the page. '+(!/(?:serves|servings|yield)\s*:?\s*\d+/i.test(text)?'Servings were not readable and default to 1; please correct them. ':'')+(start<0||end<0?'Section headings were not clear; review the original recognised text:\n'+text:'')};
}
