import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeFromText} from '../app/recipe-ocr.ts';

test('printed recipe preserves supported quantities, units, servings and exact method',()=>{
 const recipe=recipeFromText('Lemon Rice\nServes 4\n\nIngredients\n200 g rice\n500 ml water\n2 tbsp lemon juice\n\nMethod\n1. Rinse the rice.\n2. Add water and simmer for 15 minutes.\n3. Stir in the lemon juice and serve.');
 assert.equal(recipe.title,'Lemon Rice');
 assert.equal(recipe.servings,4);
 assert.deepEqual(recipe.ingredients,[{amount:200,unit:'g',name:'rice'},{amount:500,unit:'ml',name:'water'},{amount:2,unit:'tbsp',name:'lemon juice'}]);
 assert.equal(recipe.instructions,'1. Rinse the rice.\n2. Add water and simmer for 15 minutes.\n3. Stir in the lemon juice and serve.');
 assert.match(recipe.notes||'',/Check every quantity and step/);
});

test('uncertain fractions, free quantities and misspelt units remain verbatim',()=>{
 const recipe=recipeFromText('Pancakes\nServings: 2\nIngredients\n1/2 cup milk\nA pinch of salt\n200 rng flour\nDirections\nMix.');
 assert.deepEqual(recipe.ingredients,[{name:'1/2 cup milk'},{name:'A pinch of salt'},{name:'200 rng flour'}]);
 assert.equal(recipe.instructions,'Mix.');
});

test('missing section headings preserve raw text for review instead of inventing method',()=>{
 const raw='A smudged recipe\n200 g flour\nThe next line cannot be read';
 const recipe=recipeFromText(raw);
 assert.deepEqual(recipe.ingredients,[]);
 assert.equal(recipe.instructions,'');
 assert.match(recipe.notes||'',/Section headings were not clear/);
 assert.ok(recipe.notes?.includes(raw));
});

test('an ingredients-only page does not invent cooking steps',()=>{
 const recipe=recipeFromText('Soup\nServes 3\nIngredients\n300 ml stock\n1 tbsp oil');
 assert.equal(recipe.instructions,'');
 assert.deepEqual(recipe.ingredients,[{amount:300,unit:'ml',name:'stock'},{amount:1,unit:'tbsp',name:'oil'}]);
 assert.match(recipe.notes||'',/Section headings were not clear/);
});

test('compatible units are kept distinct and blank capture remains a blank draft',()=>{
 const recipe=recipeFromText('Measured recipe\nYield: 2\nIngredients\n10 g sugar\n10 ml milk\nMethod\nStir.');
 assert.equal(recipe.ingredients[0].unit,'g');
 assert.equal(recipe.ingredients[1].unit,'ml');
 const blank=recipeFromText(' \n  ');
 assert.equal(blank.title,'');
 assert.deepEqual(blank.ingredients,[]);
 assert.equal(blank.instructions,'');
});
