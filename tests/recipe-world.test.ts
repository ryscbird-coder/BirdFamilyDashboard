import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {countryCounts,countryName,inferredCountries} from '../app/recipe-world.ts';
test('countries count each dish once and leave uncertain origins unassigned',()=>{const counts=countryCounts([{data:{countryCodes:['IT','IT']}},{data:{countryCodes:['IN','GB']}},{data:{}},{data:{countryCodes:[]}}]);assert.equal(counts.get('IT'),1);assert.equal(counts.get('GB'),1);assert.equal(counts.get('__unassigned'),2);assert.equal(countryName('IT'),'Italy');});
test('map contains real country geometries and the recipe list supports a country tab',()=>{const countries=JSON.parse(readFileSync(new URL('../app/data/world-countries.json',import.meta.url),'utf8'));assert.ok(countries.length>160);for(const code of ['GB','FR','IT','CN','IN','US','AU','BR']){const country=countries.find((c:any)=>c.code===code);assert.ok(country?.path.startsWith('M'));assert.ok(country.path.length>20);}const ui=readFileSync(new URL('../app/RecipeWorld.tsx',import.meta.url),'utf8');assert.ok(ui.includes('onKeyDown'));assert.ok(ui.includes('world-country-list'));assert.ok(ui.includes('__unassigned'));});

test("obvious cuisine hints suggest editable country associations while generic food stays unassigned",()=>{assert.deepEqual(inferredCountries(["Italian","Tomato risotto"]),["IT"]);assert.deepEqual(inferredCountries(["Chicken tikka masala"]),["GB","IN"]);assert.deepEqual(inferredCountries(["Chicken with vegetables"]),[]);});
