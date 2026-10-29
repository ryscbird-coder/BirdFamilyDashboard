import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=await readFile(new URL('../app/ReportContent.tsx',import.meta.url),'utf8');
const dir=path.resolve('.sites-runtime/report-tests');await mkdir(dir,{recursive:true});
const file=path.join(dir,'ReportContent.mjs');await writeFile(file,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText);
const {default:ReportContent,reportMarkdown}=await import(pathToFileURL(file).href);
const render=body=>renderToStaticMarkup(React.createElement(ReportContent,{body,originalUrl:'https://chatgpt.com/c/synthetic-report'}));
test('full report retains Humber, all paragraphs, tables and dated figures without changing the source',()=>{const body='**Humber — dated fixture**\n\nHW 07:53 GMT · 8.9 m\n\n| Item | Amount |\n|---|---|\n| Family total | £1,760 |\n\nLast paragraph and caveat.';const before=body;const html=render(body);assert.match(html,/Humber/);assert.match(html,/07:53 GMT/);assert.match(html,/8.9 m/);assert.match(html,/<table>/);assert.match(html,/£1,760/);assert.match(html,/Last paragraph and caveat/);assert.equal(body,before);});
test('platform presentation preserves entity, offer link and every body section while references open original',()=>{const body='<box gap={2}>\n<title size="lg">Fixture family trip</title>\n<Entity category="hotel" value="Example Hotel"/>\n\nFirst detail.\n\n<Link url="https://example.com/offer" title="Full offer"/>\n<Cite refs={["privateInternalRef"]}/>\n<AsyncImage ref="privateImageRef"/>\n\nFinal caution.\n</box>';const html=render(body);assert.match(html,/Fixture family trip/);assert.match(html,/Example Hotel/);assert.match(html,/First detail/);assert.match(html,/Final caution/);assert.match(html,/https:\/\/example.com\/offer/);assert.match(html,/https:\/\/chatgpt.com\/c\/synthetic-report/);assert.doesNotMatch(html,/privateInternalRef|privateImageRef/);});
test('untrusted report HTML and javascript links remain inert',()=>{const html=render('<script>window.bad=true</script>\n\n[bad](javascript:alert(1))\n\n<Link url="javascript:alert(1)" title="Unsafe link"/>\n\n<img src=x onerror="alert(1)"/>');assert.doesNotMatch(html,/<script|<[a-z][^>]*\bonerror\s*=|href="javascript:/i);assert.match(html,/Unsafe link/);assert.equal(reportMarkdown('plain original'),'plain original');});

test('weekly HTML exposes all nine originally hidden tab panels and preserves every table row',()=>{
  const sections=Array.from({length:9},(_,index)=>`<section id="panel-${index}" role="tabpanel" aria-labelledby="tab-${index}" hidden inert aria-hidden="true" class="hidden" style="display:none"><h2>Weekly section ${index+1}</h2><p>Complete synthetic paragraph ${index+1}.</p><table><caption>Ledger ${index+1}</caption><thead><tr><th>Action</th><th>Amount</th></tr></thead><tbody><tr><td>Exact action ${index+1}</td><td>£${index+1},234.56</td></tr></tbody></table></section>`).join('');
  const body=`<article><nav role="tablist"><button role="tab">Inert section navigation</button></nav><main>${sections}</main></article>`;
  const original=body;
  const html=render(body);
  for(let index=0;index<9;index++){
    assert.match(html,new RegExp(`Weekly section ${index+1}`));
    assert.match(html,new RegExp(`Complete synthetic paragraph ${index+1}\\.`));
    assert.match(html,new RegExp(`Exact action ${index+1}`));
    assert.ok(html.includes(`£${index+1},234.56`));
  }
  assert.equal((html.match(/<table>/g)||[]).length,9);
  assert.doesNotMatch(html,/Inert section navigation|role="tablist"|role="tabpanel"|\s(?:hidden|inert|aria-hidden)(?:[=\s>])|display\s*:\s*none/i);
  assert.equal(body,original,'rendering must not rewrite the stored source report');
});

test('closed weekly details and nested hidden content are revealed sequentially',()=>{
  const html=render('<details><summary>Original supporting detail</summary><div hidden aria-hidden="true" style="visibility:hidden"><p>The complete supporting paragraph remains available.</p><details><summary>Nested evidence</summary><p>Final exact evidence.</p></details></div></details>');
  assert.match(html,/<h3>Original supporting detail<\/h3>/);
  assert.match(html,/The complete supporting paragraph remains available\./);
  assert.match(html,/<h3>Nested evidence<\/h3>/);
  assert.match(html,/Final exact evidence\./);
  assert.doesNotMatch(html,/<details|\shidden(?:[=\s>])|aria-hidden|visibility\s*:\s*hidden/i);
});

test('a tabs wrapper containing text-only report sections is not discarded as navigation',()=>{
  const html=render('<div class="tabs"><button role="tab">Inert tab control</button><section role="tabpanel" hidden><h2>Text-only weekly section</h2><p>Do not lose this complete report paragraph.</p></section></div>');
  assert.match(html,/Text-only weekly section/);
  assert.match(html,/Do not lose this complete report paragraph\./);
  assert.doesNotMatch(html,/Inert tab control|\shidden(?:[=\s>])/);
});

test('weekly HTML retains semantic emphasis and evidence links while removing executable content',()=>{
  const body='<article><p style="font-weight:700;font-style:italic">Important original label</p><a href="https://example.com/evidence" onclick="window.bad=true">Original evidence link</a><script>window.privateReportLeak=true</script><iframe src="https://example.com/embedded"></iframe><img src="https://example.com/chart.png" onerror="window.bad=true"><a href="javascript:alert(1)">Unsafe URL label</a><a href="data:text/html,unsafe">Data URL label</a></article>';
  const html=render(body);
  assert.match(html,/<em><strong>Important original label<\/strong><\/em>/);
  assert.match(html,/href="https:\/\/example\.com\/evidence"/);
  assert.match(html,/Original evidence link|Unsafe URL label|Data URL label/);
  assert.match(html,/https:\/\/example\.com\/chart\.png/);
  assert.doesNotMatch(html,/<script|<iframe|window\.privateReportLeak|\son(?:click|error)\s*=|href="(?:javascript|data):/i);
});
