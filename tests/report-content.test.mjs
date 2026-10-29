import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import {renderToStaticMarkup} from 'react-dom/server';
const source=await readFile(new URL('../app/ReportContent.tsx',import.meta.url),'utf8');
const dir=path.resolve('.sites-runtime/report-tests');await mkdir(dir,{recursive:true});
const compilerOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
const gfmSource=await readFile(new URL('../app/report-gfm.ts',import.meta.url),'utf8');
await writeFile(path.join(dir,'report-gfm.mjs'),ts.transpileModule(gfmSource,{compilerOptions}).outputText);
const {default:remarkReportGfm}=await import(pathToFileURL(path.join(dir,'report-gfm.mjs')).href);
const reportSource=source.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm,'').replace(/(["'])\.\/report-gfm\1/g,'"./report-gfm.mjs"');
const file=path.join(dir,'ReportContent.mjs');await writeFile(file,ts.transpileModule(reportSource,{compilerOptions}).outputText);
const {default:ReportContent,reportMarkdown}=await import(pathToFileURL(file).href);
// Exercise actual tab handlers with synthetic hooks; React/JSX and Children stay real.
// This verifies component state and focus requests, not physical browser behaviour.
await writeFile(path.join(dir,'report-hook-host.mjs'),`let host;
export function withHost(next,render){host=next;try{return render();}finally{host=undefined;}}
export function useState(initial){return host.useState(initial);}
export function useId(){return ':synthetic-dashboard:';}
`);
const handlerSource=reportSource.replace(/import React,\s*\{\s*useId,\s*useState\s*\}\s*from\s*["']react["'];?/, 'import React from "react";\nimport { useId, useState } from "./report-hook-host.mjs";');
assert.notEqual(handlerSource,reportSource,'the handler harness must replace only the named state/id hooks');
await writeFile(path.join(dir,'ReportContent.handlers.mjs'),ts.transpileModule(handlerSource,{compilerOptions}).outputText);
const {withHost}=await import(pathToFileURL(path.join(dir,'report-hook-host.mjs')).href);
const {DashboardTabs}=await import(pathToFileURL(path.join(dir,'ReportContent.handlers.mjs')).href);
const render=(body,options={})=>renderToStaticMarkup(React.createElement(ReportContent,{body,originalUrl:'https://chatgpt.com/c/synthetic-report',...options}));
const renderDashboard=body=>render(body,{presentation:'dashboard'});
const roleElements=(html,tag,role)=>Array.from(html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`,'g')))
  .filter(match=>new RegExp(`\\brole="${role}"`).test(match[1]))
  .map(match=>({attributes:match[1],content:match[2]}));
const roleOpenings=(html,role)=>Array.from(html.matchAll(/<[a-z][a-z0-9-]*\b([^>]*)>/g))
  .filter(match=>new RegExp(`\\brole="${role}"`).test(match[1]))
  .map(match=>({attributes:match[1]}));
const attribute=(element,name)=>new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(element.attributes)?.[1];
const textContent=value=>value.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#x27;|&#39;/g,"'").replace(/&quot;/g,'"');
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

test('dashboard markdown has accessible tabs while keeping every exact action and table mounted',()=>{
  const body='## Priority actions\n\nFirst exact action; amount £1,234.56.\n\n| Owner | Next step | Due |\n|---|---|---|\n| Fixture person | Check the original document | 30 October |\n\n## Family planning\n\nA tentative plan remains tentative.\n\n## Supporting evidence\n\nFinal original caveat and [source](https://example.com/evidence).';
  const original=body;
  const html=renderDashboard(body);
  assert.match(html,/class="[^"]*\bdashboard-report\b/);
  const tablists=roleOpenings(html,'tablist');
  assert.equal(tablists.length,1);
  assert.equal(attribute(tablists[0],'aria-label'),'Dashboard sections');
  const tabs=roleElements(html,'button','tab');
  const panels=roleOpenings(html,'tabpanel');
  assert.deepEqual(tabs.map(tab=>textContent(tab.content)),['Priority actions','Family planning','Supporting evidence']);
  assert.equal(panels.length,3);
  const ids=new Set();
  tabs.forEach((tab,index)=>{
    const tabId=attribute(tab,'id');
    const panelId=attribute(panels[index],'id');
    assert.ok(tabId&&panelId,'tabs and panels need explicit IDs');
    assert.ok(!ids.has(tabId)&&!ids.has(panelId),'each ARIA ID must be unique');
    ids.add(tabId);ids.add(panelId);
    assert.equal(attribute(tab,'aria-controls'),panelId);
    assert.equal(attribute(panels[index],'aria-labelledby'),tabId);
    assert.equal(attribute(tab,'aria-selected'),index===0?'true':'false');
    assert.equal(/\bhidden(?:=|\s|$)/.test(panels[index].attributes),index!==0);
  });
  for(const exact of ['First exact action; amount £1,234.56.','Fixture person','Check the original document','30 October','A tentative plan remains tentative.','Final original caveat']) assert.ok(html.includes(exact),`lost original text: ${exact}`);
  assert.match(html,/<table>/);
  assert.match(html,/href="https:\/\/example.com\/evidence"/);
  assert.match(html,/Show all sections/);
  assert.equal(body,original,'dashboard presentation must not rewrite the saved report');
});

test('dashboard HTML reuses original tab labels without restoring unsafe source controls or styles',()=>{
  const body='<article><nav role="tablist" onclick="window.sourceHandler=true"><button id="old-tab-a" role="tab" aria-controls="old-panel-a" onclick="window.sourceHandler=true">Original action label</button><button id="old-tab-b" role="tab" aria-controls="old-panel-b">Original evidence label</button></nav><section id="old-panel-a" role="tabpanel" aria-labelledby="old-tab-a"><h2>Detailed priority heading</h2><p>Exact first report paragraph.</p></section><section id="old-panel-b" role="tabpanel" aria-labelledby="old-tab-b" hidden style="display:none"><h2>Detailed evidence heading</h2><p>Exact supporting paragraph.</p><script>window.sourceScript=true</script><a href="javascript:alert(1)">Unsafe source label</a><table><tbody><tr><td>Exact ledger entry</td><td>£987.65</td></tr></tbody></table></section></article>';
  const html=renderDashboard(body);
  const tabs=roleElements(html,'button','tab');
  assert.deepEqual(tabs.map(tab=>textContent(tab.content)),['Original action label','Original evidence label']);
  assert.equal(roleOpenings(html,'tablist').length,1,'source navigation must be replaced, not duplicated');
  assert.equal(roleOpenings(html,'tabpanel').length,2);
  for(const exact of ['Detailed priority heading','Exact first report paragraph.','Detailed evidence heading','Exact supporting paragraph.','Unsafe source label','Exact ledger entry','£987.65']) assert.ok(html.includes(exact),`lost original content: ${exact}`);
  assert.doesNotMatch(html,/<script|window\.source(?:Script|Handler)|\sonclick\s*=|href="javascript:|display\s*:\s*none/i);
});

test('plain uppercase dashboard headings and duplicate labels keep unique section identities',()=>{
  const body='PRIORITY ACTIONS\n\nFirst original action.\n\nSUPPORTING EVIDENCE\n\nSecond original evidence.\n\nPRIORITY ACTIONS\n\nThird original follow-up.';
  const html=renderDashboard(body);
  const tabs=roleElements(html,'button','tab');
  assert.deepEqual(tabs.map(tab=>textContent(tab.content)),['PRIORITY ACTIONS','SUPPORTING EVIDENCE','PRIORITY ACTIONS']);
  const panelIds=roleOpenings(html,'tabpanel').map(panel=>attribute(panel,'id'));
  assert.equal(new Set(panelIds).size,3,'identical titles must not create duplicate panel IDs');
  for(const exact of ['First original action.','Second original evidence.','Third original follow-up.']) assert.ok(html.includes(exact));
});

test('plain dashboard section titles followed immediately by bullets become cards without changing their words',()=>{
  const body='Verified fixture summary.\n\nPRIORITIES AND DECISIONS\n• Exact first action and its original caution.\n• Exact second action.\n\nMONTHLY DOCUMENT CHECKLIST — ORIGINAL DATE\n\nFixture department\n□ Original document requirement.\n□ Original evidence requirement.\n\nSOURCE COVERAGE AND LIMITS\nOriginal final limitation.\n\n```text\n\nUNMODIFIED CODE LABEL\n• Unmodified code bullet.\n```';
  const html=renderDashboard(body);
  assert.equal(roleElements(html,'button','tab').length,3);
  assert.match(html,/<li>Exact first action and its original caution\.<\/li>/);
  assert.match(html,/<li>□ Original document requirement\.<\/li>/);
  assert.match(html,/<h3>Fixture department<\/h3>/);
  for(const exact of ['Exact second action.','Original evidence requirement.','Original final limitation.','UNMODIFIED CODE LABEL\n• Unmodified code bullet.']) assert.ok(html.includes(exact));
  assert.doesNotMatch(html,/## UNMODIFIED CODE LABEL/);
});

test('long backtick and tilde code fences do not promote their uppercase content into dashboard sections',()=>{
  for(const marker of ['````','~~~~']) {
    const shorter=marker.slice(1);
    const body=`## First section\n\nOriginal action.\n\n${marker}text\n${shorter}\n\nIMPORTANT ORIGINAL CODE\n• Original code line.\n${marker}\n\n## Second section\n\nOriginal evidence.`;
    const html=renderDashboard(body);
    assert.equal(roleElements(html,'button','tab').length,2);
    assert.ok(html.includes(`${shorter}\n\nIMPORTANT ORIGINAL CODE\n• Original code line.\n`));
    assert.doesNotMatch(html,/## IMPORTANT ORIGINAL CODE|<h[1-6]>IMPORTANT ORIGINAL CODE/);
  }
});

test('ordinary news and travel reports retain sequential document presentation',()=>{
  const body='<nav role="tablist"><button role="tab">Old source UI</button></nav><section role="tabpanel"><h2>News section</h2><p>Original dated news.</p></section><section role="tabpanel" hidden><h2>Travel section</h2><p>Original offer caveat.</p></section>';
  const html=render(body);
  assert.doesNotMatch(html,/dashboard-report|role="tab(?:list|panel)?"|Show all sections|Old source UI|\shidden(?:[=\s>])/);
  assert.match(html,/Original dated news\./);
  assert.match(html,/Original offer caveat\./);
});

test('Safari-compatible report extensions retain tables, task checkboxes and strikethrough',()=>{
  const body='| Action | Status |\n|---|---|\n| Check fixture | Pending |\n\n- [ ] First original task\n- [x] Completed original task\n\n~~Superseded original wording~~';
  const html=renderToStaticMarkup(React.createElement(ReactMarkdown,{remarkPlugins:[remarkReportGfm],children:body}));
  assert.match(html,/<table>/);
  assert.match(html,/Check fixture/);
  assert.equal((html.match(/type="checkbox"/g)||[]).length,2);
  assert.equal((html.match(/\schecked=""/g)||[]).length,1);
  assert.match(html,/<del>Superseded original wording<\/del>/);
  assert.match(html,/First original task/);
  assert.match(html,/Completed original task/);
});

test('Safari-compatible report extensions retain explicit links without loading literal autolinks',()=>{
  const body='[Original source](https://example.com/evidence)\n\n<https://example.com/explicit>\n\nPlain source text https://example.com/plain remains in the report.';
  const html=renderToStaticMarkup(React.createElement(ReactMarkdown,{remarkPlugins:[remarkReportGfm],children:body}));
  assert.match(html,/href="https:\/\/example.com\/evidence"/);
  assert.match(html,/href="https:\/\/example.com\/explicit"/);
  assert.match(html,/Plain source text https:\/\/example.com\/plain remains in the report\./);
  assert.doesNotMatch(html,/href="https:\/\/example.com\/plain"/);
  assert.doesNotMatch(gfmSource,/from\s*["'](?:remark-gfm|mdast-util-gfm|micromark-extension-gfm)(?:["']|-autolink-literal)/);
});

test('actual dashboard tab handlers switch panels, manage keyboard focus and reveal all sections reversibly',()=>{
  const slots=[];let cursor=0,tree,focused;
  const labels=['Original priorities','Original evidence','Original planning'];
  const children=labels.map((label,index)=>React.createElement('p',{key:index},`Exact section ${index+1} content.`));
  const walk=(node,output=[])=>{if(Array.isArray(node)){node.forEach(child=>walk(child,output));return output;}if(node&&typeof node==='object'&&node.props){output.push(node);walk(node.props.children,output);}return output;};
  const host={
    useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:initial};return[slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];},
    render(){cursor=0;tree=withHost(host,()=>DashboardTabs({labels,children}));return tree;},
    nodes(){return walk(host.render());},
    tabs(){return host.nodes().filter(node=>node.props.role==='tab');},
    panels(){return host.nodes().filter(node=>node.props.role==='tabpanel');},
    showAll(){return host.nodes().find(node=>node.type==='button'&&node.props['aria-pressed']!==undefined);},
    key(index,key){let prevented=false;const tabs=host.tabs();tabs[index].props.onKeyDown({key,preventDefault(){prevented=true;},currentTarget:{parentElement:{querySelectorAll(selector){assert.equal(selector,'[role="tab"]');return tabs.map(tab=>({focus(){focused=tab.props.id;}}));}}}});return prevented;},
  };
  const assertSelected=index=>{
    const tabs=host.tabs(),panels=host.panels();
    assert.deepEqual(tabs.map(tab=>tab.props['aria-selected']),labels.map((_,i)=>i===index));
    assert.deepEqual(tabs.map(tab=>tab.props.tabIndex),labels.map((_,i)=>i===index?0:-1));
    assert.deepEqual(panels.map(panel=>panel.props.hidden),labels.map((_,i)=>i!==index));
  };
  assertSelected(0);
  host.tabs()[1].props.onClick();assertSelected(1);
  for(const [key,from,to] of [['ArrowRight',1,2],['ArrowRight',2,0],['ArrowLeft',0,2],['Home',2,0],['End',0,2]]){
    assert.equal(host.key(from,key),true,`${key} must prevent page scrolling`);
    assertSelected(to);
    assert.equal(focused,host.tabs()[to].props.id,`${key} must focus the selected tab`);
  }
  assert.equal(host.key(2,'PageDown'),false,'unrelated keys retain their usual behaviour');assertSelected(2);
  host.showAll().props.onClick();
  assert.equal(host.showAll().props['aria-pressed'],true);
  assert.deepEqual(host.panels().map(panel=>panel.props.hidden),[false,false,false]);
  const allMarkup=renderToStaticMarkup(host.render());
  for(let index=1;index<=3;index++)assert.ok(allMarkup.includes(`Exact section ${index} content.`),'Show all must retain every original section');
  host.tabs()[0].props.onClick();assertSelected(0);
  assert.equal(host.showAll().props['aria-pressed'],false,'choosing one tab must leave Show all mode');
  host.showAll().props.onClick();host.showAll().props.onClick();assertSelected(0);
});
