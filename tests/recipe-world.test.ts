import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {countryCounts,countryName,inferredCountries} from '../app/recipe-world.ts';
test('countries count each dish once and leave uncertain origins unassigned',()=>{const counts=countryCounts([{data:{countryCodes:['IT','IT']}},{data:{countryCodes:['IN','GB']}},{data:{}},{data:{countryCodes:[]}}]);assert.equal(counts.get('IT'),1);assert.equal(counts.get('GB'),1);assert.equal(counts.get('__unassigned'),2);assert.equal(countryName('IT'),'Italy');});
test('map contains real country geometries and the recipe list supports a country tab',()=>{const countries=JSON.parse(readFileSync(new URL('../app/data/world-countries.json',import.meta.url),'utf8'));assert.ok(countries.length>160);for(const code of ['GB','FR','IT','CN','IN','US','AU','BR']){const country=countries.find((c:any)=>c.code===code);assert.ok(country?.path.startsWith('M'));assert.ok(country.path.length>20);}const ui=readFileSync(new URL('../app/RecipeWorld.tsx',import.meta.url),'utf8');assert.ok(ui.includes('onKeyDown'));assert.ok(ui.includes('world-country-list'));assert.ok(ui.includes('__unassigned'));});

test("obvious cuisine hints suggest editable country associations while generic food stays unassigned",()=>{assert.deepEqual(inferredCountries(["Italian","Tomato risotto"]),["IT"]);assert.deepEqual(inferredCountries(["Chicken tikka masala"]),["GB","IN"]);assert.deepEqual(inferredCountries(["Chicken with vegetables"]),[]);});


// Publisher grouping must survive different import routes without changing provenance.
import {recipeCollectionName,recipeTagLabels} from '../app/recipe-collections.ts';
test('all HelloFresh import routes share one category while unrelated publishers remain separate',()=>{
 const recipes=[{collection:'Hello Fresh'},{collection:'HelloFresh recipe cards'},{collection:'HelloFresh recipe cards · Downloads'},{collection:'Skylight',sourceUrl:'https://www.hellofresh.co.uk/recipes/a'},{tags:['Vegetarian','HelloFresh']}];
 assert.deepEqual([...new Set(recipes.map(recipeCollectionName))],['HelloFresh']);
 assert.deepEqual(recipeTagLabels(['Hello Fresh','HelloFresh recipe cards · Downloads','Vegetarian']),['HelloFresh','Vegetarian']);
 assert.equal(recipeCollectionName({collection:'World Cook',title:'Fresh pasta'}),'World Cook');
 assert.equal(recipeCollectionName({collection:'Skylight',sourceUrl:'https://hellofresh.co.uk.evil.test/recipes/a'}),'Skylight');
 assert.equal(recipeCollectionName({collection:'Skylight',sourceUrl:'not a URL'}),'Skylight');
 const original={collection:'Hello Fresh',tags:['Vegetarian']};recipeCollectionName(original);assert.equal(original.collection,'Hello Fresh');
});
