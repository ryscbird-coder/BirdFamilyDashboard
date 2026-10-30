const regionNames=(()=>{try{return new Intl.DisplayNames(['en-GB'],{type:'region'});}catch{return undefined;}})();
const countryNames=new Map<string,string>();
export function countryName(code:string){if(code==='__unassigned')return 'Origin not assigned';const cached=countryNames.get(code);if(cached)return cached;let name=code;try{name=regionNames?.of(code)||code;}catch{}countryNames.set(code,name);return name;}
export function countryCounts(recipes:Array<{data:Record<string,any>}>){const counts=new Map<string,number>();for(const r of recipes){const codes=[...new Set<string>(r.data.countryCodes||[])];if(!codes.length)counts.set('__unassigned',(counts.get('__unassigned')||0)+1);for(const code of codes)counts.set(code,(counts.get(code)||0)+1);}return counts;}
export function inferredCountries(hints:unknown[]):string[]{
 const text=hints.flat().filter(v=>typeof v==='string').join(' ').toLowerCase();
 const rules:Array<[RegExp,string[]]>=[[/\bitalian|bolognese|bolognaise|risotto|carbonara|tiramisu\b/,['IT']],[/\bgreek|souvlaki|tzatziki|moussaka\b/,['GR']],[/\bjapanese|ramen|katsu|teriyaki|sushi\b/,['JP']],[/\bspanish|paella|gazpacho\b/,['ES']],[/\btikka masala\b/,['GB','IN']],[/\bindian|rogan josh|biryani\b/,['IN']],[/\bmexican|barbacoa|tacos\b/,['MX']],[/\bthai\b/,['TH']],[/\bchinese\b/,['CN']],[/\bfrench\b/,['FR']],[/\bturkish|doner\b/,['TR']],[/\bkorean|kimchi|bulgogi\b/,['KR']],[/\bvietnamese\b/,['VN']],[/\bmoroccan|tagine\b/,['MA']]];
 return [...new Set(rules.filter(([pattern])=>pattern.test(text)).flatMap(([,codes])=>codes))];
}
