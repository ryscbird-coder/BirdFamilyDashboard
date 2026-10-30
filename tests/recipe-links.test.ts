import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {parseIngredient,quantity,methodSteps} from '../app/recipe-utils.ts';
import {recipeFromHTML,recipeURL,importRecipeLink} from '../server/recipe-links.ts';
import {recipePhotoSource,validateRecipePhotoSourceUrl} from '../server/recipe-photo-source.ts';
test('fractional ingredient quantities scale without losing names or units',()=>{
 assert.deepEqual(parseIngredient('1½ tbsp olive oil'),{amount:1.5,unit:'tbsp',name:'olive oil'});
 assert.deepEqual(parseIngredient('½ red onion'),{amount:.5,name:'red onion'});
 assert.equal(quantity(parseIngredient('225g basmati rice'),4,3),'300 g');
 assert.deepEqual(parseIngredient('Salt to taste'),{name:'Salt to taste'});
 assert.equal(methodSteps('1. Prepare\n\n2. Cook').length,2);
});
test('recipe link extraction handles graphs, sections and incomplete yields',()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':['Recipe'],name:'Soup &amp; bread',recipeIngredient:['1½ tbsp oil','200g carrots'],recipeYield:'4 servings',recipeInstructions:[{'@type':'HowToSection',itemListElement:[{text:'<p>Roast vegetables.</p>'},{text:'Blend.'}]}],prepTime:'PT15M',cookTime:'PT1H'}]})+'</script>';
 const draft=recipeFromHTML(html,'https://www.bbcgoodfood.com/recipes/soup');assert.equal(draft.title,'Soup & bread');assert.equal(draft.servings,4);assert.equal(draft.ingredients[0].amount,1.5);assert.equal(draft.instructions,'Roast vegetables.\n\nBlend.');assert.equal(draft.cookMinutes,60);
 assert.throws(()=>recipeFromHTML('<html>blocked</html>','https://www.bbcgoodfood.com/recipes/soup'));
});
test('recipe fetch refuses private URLs and redirects outside supported sites',async()=>{
 for(const url of ['http://www.bbcgoodfood.com/a','https://127.0.0.1/a','https://www.bbcgoodfood.com.evil.test/a','https://www.bbcgoodfood.com:444/a','https://user@www.bbcgoodfood.com/a'])assert.throws(()=>recipeURL(url));
 await assert.rejects(()=>importRecipeLink('https://www.bbcgoodfood.com/recipes/soup',async()=>new Response(null,{status:302,headers:{location:'http://169.254.169.254/'}})));
});

test('printed ingredient ranges retain both endpoints when scaling',()=>{const ingredient=parseIngredient('1/2–1 tsp salt');assert.deepEqual(ingredient,{name:'salt',unit:'tsp',amount:.5,amountMax:1});assert.equal(quantity(ingredient,4,2),'1–2 tsp');});

test('available publisher dish pictures are retained as compact image links and unsafe sources are excluded',()=>{
 const draft=recipeFromHTML('<script type="application/ld+json">'+JSON.stringify({'@type':'Recipe',name:'A dish',recipeIngredient:['200g rice'],image:{'@type':'ImageObject',url:'https://images.immediate.co.uk/production/dish.jpg'}})+'</script>','https://www.bbcgoodfood.com/recipes/dish');
 const image=new URL(draft.photoSourceUrl!);assert.equal(image.searchParams.get('resize'),'480,320');assert.equal(image.searchParams.get('quality'),'60');
 for(const url of ['data:image/png;base64,abc','http://images.immediate.co.uk/a','https://127.0.0.1/a','https://images.immediate.co.uk.evil.test/a','https://user@images.immediate.co.uk/a'])assert.throws(()=>validateRecipePhotoSourceUrl(url));
 assert.equal(recipePhotoSource(['https://evil.test/ad.jpg',{url:'https://img.hellofresh.com/dish.jpg'}]),'https://img.hellofresh.com/dish.jpg');assert.equal(recipePhotoSource('https://evil.test/ad.jpg'),undefined);
});
