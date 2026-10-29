export type Ingredient = {name:string;amount?:number;unit?:string};
const fractions:Record<string,string>={'½':' 1/2','¼':' 1/4','¾':' 3/4','⅓':' 1/3','⅔':' 2/3','⅛':' 1/8'};
export function parseIngredient(line:string):Ingredient {
 const text=line.trim().replace(/^[•*-]\s*/,'').replace(/[½¼¾⅓⅔⅛]/g,c=>fractions[c]).replace(/(\d)(g|kg|ml|l)\b/gi,'$1 $2').trim();
 const m=text.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)\s*(.*)$/);
 const n=text.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
 if(!m&&!n)return {name:line.trim()};
 const amount=m?Number(m[1]||0)+Number(m[2])/Number(m[3]):Number(n![1].replace(',','.'));
 const rest=(m?m[4]:n![2]).trim();
 if(!Number.isFinite(amount)||!rest)return {name:line.trim()};
 const u=rest.match(/^(kg|g|mg|ml|l|tsp|tbsp|cups?|oz|lb|pinch|cloves?|cans?|cartons?|sachets?|pots?|packs?|bags?)\b\s*(.*)$/i);
 return u&&u[2]?{amount,unit:u[1].toLowerCase(),name:u[2]}:{amount,name:rest};
}
export function quantity(ingredient:Ingredient,servings:number,base:number){return [ingredient.amount===undefined?'':Number((ingredient.amount*servings/base).toFixed(3)),ingredient.unit||''].filter(x=>x!=='').join(' ');}
export function methodSteps(text:string){return text.split(/\n\s*\n|\n(?=\s*\d+[.)]\s)/).map(s=>s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);}
