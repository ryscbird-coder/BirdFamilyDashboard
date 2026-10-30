export type Ingredient = {name:string;amount?:number;amountMax?:number;unit?:string};
const fractions:Record<string,string>={'½':' 1/2','¼':' 1/4','¾':' 3/4','⅓':' 1/3','⅔':' 2/3','⅛':' 1/8'};
export function parseIngredient(line:string):Ingredient {
 const text=line.trim().replace(/^[•*-]\s*/,'').replace(/[½¼¾⅓⅔⅛]/g,c=>fractions[c]).replace(/(\d)(g|kg|ml|l)\b/gi,'$1 $2').trim();
 const token='(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:[.,]\\d+)?)';
 const range=text.match(new RegExp('^('+token+')\\s*(?:[-–]|to)\\s*('+token+')\\s+(.+)$'));
 if(range){const value=(s:string)=>s.includes('/')?s.trim().split(/\s+/).reduce((sum,p)=>sum+(p.includes('/')?Number(p.split('/')[0])/Number(p.split('/')[1]):Number(p)),0):Number(s.replace(',','.'));const low=value(range[1]),high=value(range[2]);const rest=parseIngredient('1 '+range[3]);if(Number.isFinite(low)&&Number.isFinite(high)&&high>=low)return {...rest,amount:low,amountMax:high};}
 const m=text.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)\s*(.*)$/);
 const n=text.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
 if(!m&&!n)return {name:line.trim()};
 const amount=m?Number(m[1]||0)+Number(m[2])/Number(m[3]):Number(n![1].replace(',','.'));
 const rest=(m?m[4]:n![2]).trim();
 if(!Number.isFinite(amount)||!rest)return {name:line.trim()};
 const u=rest.match(/^(kg|g|mg|ml|l|tsp|tbsp|cups?|c|teaspoons?|tablespoons?|ounces?|pounds?|quarts?|pints?|oz|lb|pinch|cloves?|cans?|cartons?|sachets?|pots?|packs?|bags?)\b\s*(.*)$/i);
 return u&&u[2]?{amount,unit:({c:'cup',teaspoon:'tsp',teaspoons:'tsp',tablespoon:'tbsp',tablespoons:'tbsp',ounces:'oz',ounce:'oz',pounds:'lb',pound:'lb'} as Record<string,string>)[u[1].toLowerCase()]||u[1].toLowerCase(),name:u[2]}:{amount,name:rest};
}
export function quantity(ingredient:Ingredient,servings:number,base:number){return [ingredient.amount===undefined?'':String(Number((ingredient.amount*servings/base).toFixed(3)))+(ingredient.amountMax!==undefined?'–'+Number((ingredient.amountMax*servings/base).toFixed(3)):''),ingredient.unit||''].filter(x=>x!=='').join(' ');}
export function methodSteps(text:string){return text.split(/\n\s*\n|\n(?=\s*\d+[.)]\s)/).map(s=>s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);}
