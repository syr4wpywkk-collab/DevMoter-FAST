import test from 'node:test';
import assert from 'node:assert/strict';
import * as i18nCore from '../src/i18n-core.mjs';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import ts from 'typescript';
const source=await readFile(new URL('../src/advanced.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
test('Files & Preview tabs show only their matching sections, avoid duplicate headings, and reopen cleanly',async t=>{
 const dom=new JSDOM('<body><button id="entry">Files</button></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.exports={};w.require=name=>name==='./i18n'?i18nCore:({});const requests=[];
 w.fetch=async(url,options)=>{requests.push({url,method:options?.method||'GET'});return new Response(JSON.stringify({projects:[],models:[],grants:[],mode:'disabled'}))};
 w.eval(compiled);w.exports.mountAdvancedTools();
 const d=w.document;d.querySelector('#entry').focus();d.querySelector('.adv-fab').click();
 const drawer=d.querySelector('.adv-drawer');assert.equal(drawer.classList.contains('hidden'),false);assert.equal(d.activeElement.getAttribute('data-close'),'');

 const tablist=d.querySelector('.adv-tabs[role="tablist"]');assert.ok(tablist);
 const tabs=[...tablist.querySelectorAll('[role="tab"]')];
 assert.deepEqual(tabs.map(t=>t.dataset.advTab),['files','outputs','preview','models']);
 assert.deepEqual(tabs.map(t=>t.textContent),['Files & documents','Generated outputs','Web preview & browser','Models & access']);

 const panels=[...d.querySelectorAll('[data-adv-panel][role="tabpanel"]')];
 assert.deepEqual(panels.map(p=>p.dataset.advPanel),['files','outputs','preview','models']);

 const visiblePanels=()=>panels.filter(p=>!p.hidden&&!p.classList.contains('hidden'));
 const visibleHeadings=()=>[...drawer.querySelectorAll('.adv-panel:not(.hidden) h1, .adv-panel:not(.hidden) h2, .adv-panel:not(.hidden) h3')].map(h=>h.textContent);

 // Default tab: files
 assert.deepEqual(visiblePanels().map(p=>p.dataset.advPanel),['files']);
 assert.equal(tabs[0].getAttribute('aria-selected'),'true');
 assert.deepEqual(visibleHeadings(),['Project files','Safe file preview','URL attachment']);
 assert.equal(d.querySelector('.adv-group-title'),null);
 assert.ok(!d.querySelector('.adv-project').closest('.hidden, [hidden]'));

 // Switch to outputs: no duplicate "Generated outputs" heading inside panel
 tabs[1].click();
 assert.deepEqual(visiblePanels().map(p=>p.dataset.advPanel),['outputs']);
 assert.equal(tabs[1].getAttribute('aria-selected'),'true');
 assert.equal(tabs[0].getAttribute('aria-selected'),'false');
 assert.deepEqual(visibleHeadings(),[]);
 assert.ok(d.querySelector('[data-artifact-add]').closest('[data-adv-panel="outputs"]')&&!d.querySelector('[data-artifact-add]').closest('.hidden, [hidden]'));
 assert.ok(d.querySelector('[data-file-open]').closest('.hidden, [hidden]'));

 // Switch to preview
 tabs[2].click();
 assert.deepEqual(visiblePanels().map(p=>p.dataset.advPanel),['preview']);
 assert.deepEqual(visibleHeadings(),['Live web preview','Browser automation']);
 assert.ok(!d.querySelector('[data-preview-start]').closest('.hidden, [hidden]'));
 assert.ok(!d.querySelector('[data-agent-browser-start]').closest('.hidden, [hidden]'));
 assert.ok(d.querySelector('[data-artifact-add]').closest('.hidden, [hidden]'));

 // Keyboard navigation moves to models and back
 tabs[2].focus();
 tablist.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
 assert.equal(d.activeElement,tabs[3]);
 assert.deepEqual(visiblePanels().map(p=>p.dataset.advPanel),['models']);
 assert.deepEqual(visibleHeadings(),['Models','Directory grants','OS sandbox']);
 assert.ok(!d.querySelector('[data-model-run]').closest('.hidden, [hidden]'));
 assert.ok(!d.querySelector('[data-grant-add]').closest('.hidden, [hidden]'));

 tablist.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));
 assert.equal(d.activeElement,tabs[0]);
 assert.deepEqual(visiblePanels().map(p=>p.dataset.advPanel),['files']);

 // Close on preview tab and re-open: previously selected tab remains active and functional
 tabs[2].click();
 drawer.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(drawer.classList.contains('hidden'),true);assert.equal(d.body.style.overflow,'');assert.equal(d.activeElement.id,'entry');
 await new Promise(r=>setImmediate(r));assert.equal(d.querySelector('[data-project-status]').textContent,'Register a project first.');assert.ok(requests.every(r=>r.method==='GET'));

 d.querySelector('.adv-fab').click();
 assert.equal(drawer.classList.contains('hidden'),false);
 assert.equal(tabs[2].getAttribute('aria-selected'),'true');
 assert.deepEqual(visiblePanels().map(p=>p.dataset.advPanel),['preview']);
 assert.deepEqual(visibleHeadings(),['Live web preview','Browser automation']);

 // Tab focus trap skips hidden panels and wraps within the active tab
 d.querySelector('[data-close]').focus();
 drawer.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true}));
 assert.ok(!d.activeElement.closest('.hidden, [hidden]'));
 assert.equal(d.activeElement.closest('[data-adv-panel]')?.dataset.advPanel,'preview');

 tabs[0].click();
 assert.deepEqual(visiblePanels().map(p=>p.dataset.advPanel),['files']);
});

test('Files & Preview avoids duplicate headings in Japanese locale',async t=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.exports={};
 w.require=name=>name==='./i18n'?{...i18nCore,t:(key,vars)=>i18nCore.translate('ja',key,vars)}:({});
 w.fetch=async()=>new Response(JSON.stringify({projects:[],models:[],grants:[],mode:'disabled'}));
 w.eval(compiled);w.exports.mountAdvancedTools();
 const d=w.document;d.querySelector('.adv-fab').click();
 const tabs=[...d.querySelectorAll('.adv-tabs [role="tab"]')];
 assert.deepEqual(tabs.map(tab=>tab.textContent),['ファイルとドキュメント','生成された出力','Web プレビューとブラウザ','モデルとアクセス']);
 const visibleHeadings=()=>[...d.querySelectorAll('.adv-panel:not(.hidden) h1, .adv-panel:not(.hidden) h2, .adv-panel:not(.hidden) h3')].map(h=>h.textContent);
 assert.deepEqual(visibleHeadings(),['プロジェクトファイル','安全なファイルプレビュー','URL 添付']);
 tabs[1].click();
 assert.deepEqual(visibleHeadings(),[]);
 tabs[2].click();
 assert.deepEqual(visibleHeadings(),['ライブ Web プレビュー','ブラウザ自動操作']);
 tabs[3].click();
 assert.deepEqual(visibleHeadings(),['モデル','ディレクトリ権限','OS サンドボックス']);
});

test('Files & Preview retains all section behaviors across all four tabs',async t=>{
 const dom=new JSDOM('<body><div id="codexView"><textarea id="cxPromptInput"></textarea></div></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.exports={};w.require=name=>name==='./i18n'?i18nCore:({});
 let grants=[{id:'g1',path:'/shared/ro',mode:'read'}];
 let artifacts=[{id:'a1',name:'report.json',path:'dist/report.json',size:42}];
 let livePreview=null;
 let browserSession=null;
 w.fetch=async(url,options)=>{
  const path=String(url);const method=(options?.method||'GET').toUpperCase();
  const ok=body=>new Response(JSON.stringify(body),{status:200});
  if(path==='/api/projects')return ok({projects:[{id:'p1',name:'App',path:'/tmp/app'}]});
  if(path.includes('/files?path='))return ok({browser:{path:'',parent:null,entries:[{name:'src',path:'src',kind:'directory',size:null},{name:'README.md',path:'README.md',kind:'file',size:12,previewable:true}],truncated:false}});
  if(path.includes('/preview?path=README.md'))return ok({preview:{kind:'text',name:'README.md',path:'README.md',size:12,language:'markdown',content:'# Hello'}});
  if(path==='/api/attachments/url/preview'&&method==='POST')return ok({preview:{normalizedUrl:'https://example.com/docs',host:'example.com',port:443,path:'/docs'}});
  if(path==='/api/attachments/url/fetch'&&method==='POST')return ok({attachment:{name:'Docs',source:'https://example.com/docs',size:15,mime:'text/plain'},text:'Example content',redirects:[]});
  if(path.includes('/artifacts?'))return ok({artifacts});
  if(path==='/api/artifacts/a1/preview')return ok({artifact:artifacts[0],preview:{kind:'text',name:'report.json',path:'dist/report.json',size:42,language:'json',content:'{"ok":true}'}});
  if(path.endsWith('/artifacts')&&method==='POST'){artifacts=[...artifacts,{id:'a2',name:'bundle.js',path:'dist/bundle.js',size:99}];return ok({artifact:artifacts[1]});}
  if(path.endsWith('/web-preview')&&method==='GET')return ok({preview:livePreview});
  if(path.endsWith('/web-preview')&&method==='POST'){livePreview={host:'127.0.0.1',port:3000,url:'/api/live-preview/proxy/p1/'};return ok({preview:livePreview});}
  if(path.endsWith('/web-preview')&&method==='DELETE'){livePreview=null;return ok({ok:true});}
  if(path.startsWith('/api/advanced/browser?'))return ok({capability:{enabled:true,available:true,binary:'chromium'},session:browserSession});
  if(path==='/api/advanced/browser/start'&&method==='POST'){browserSession={active:true,sandboxed:true,startedAt:1};return ok({session:browserSession});}
  if(path==='/api/advanced/browser/inspect'&&method==='POST')return ok({inspection:{content:'<h1>App</h1>',truncated:false,sandboxed:true}});
  if(path==='/api/advanced/browser/stop'&&method==='POST'){browserSession=null;return ok({ok:true});}
  if(path==='/api/advanced/models')return ok({models:[{id:'gpt-mini',label:'GPT Mini',providerId:'openai',local:false,available:true,capabilities:{vision:false,tools:true,reasoning:true}},{id:'vision-pro',label:'Vision Pro',providerId:'openai',local:false,available:true,capabilities:{vision:true,tools:true,reasoning:true}}]});
  if(path==='/api/advanced/models/run'&&method==='POST')return ok({text:'Model OK',handledBy:{providerId:'openai',model:'vision-pro'},routing:{}});
  if(path==='/api/advanced/grants'&&method==='GET')return ok({grants});
  if(path==='/api/advanced/grants'&&method==='POST'){const b=JSON.parse(options.body);grants=[...grants,{id:'g2',path:b.path,mode:b.mode}];return ok({grant:grants[1]});}
  if(path.startsWith('/api/advanced/grants/')&&method==='DELETE'){grants=grants.filter(g=>!path.endsWith('/'+g.id));return ok({ok:true});}
  if(path==='/api/advanced/sandbox')return ok({mode:'preferred',backend:'bwrap',available:true,enforced:true,scope:'devmoter-owned-agent-tools',externalBackends:'allowed'});
  throw new Error('Unhandled '+method+' '+path);
 };
 w.eval(compiled);w.exports.mountAdvancedTools();
 const d=w.document;d.querySelector('.adv-fab').click();
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));

 // Files & documents tab: file browser, safe preview, URL attach
 const fileButtons=[...d.querySelectorAll('[data-file-browser] button')];
 assert.equal(fileButtons.length,2);
 fileButtons[1].click();
 await new Promise(r=>setImmediate(r));
 assert.match(d.querySelector('[data-preview]').textContent,/README\.md.*# Hello/);
 d.querySelector('[data-url-input]').value='https://example.com/docs';
 d.querySelector('[data-url-preview]').click();
 await new Promise(r=>setImmediate(r));
 assert.equal(d.querySelector('[data-url-attach]').disabled,false);
 d.querySelector('[data-url-attach]').click();
 await new Promise(r=>setImmediate(r));
 assert.match(d.querySelector('#cxPromptInput').value,/Example content/);

 // Generated outputs tab: list, preview in place, add
 d.querySelector('[data-adv-tab="outputs"]').click();
 assert.match(d.querySelector('[data-artifacts]').textContent,/report\.json/);
 const artifactPreviewBtn=d.querySelector('[data-artifacts] .adv-item button');
 assert.equal(artifactPreviewBtn.textContent,'Preview');
 artifactPreviewBtn.click();
 assert.equal(d.querySelector('[data-artifact-preview]').textContent,'Loading preview…');
 await new Promise(r=>setImmediate(r));
 const artifactPreview=d.querySelector('[data-artifact-preview]');
 assert.ok(artifactPreview.closest('[data-adv-panel="outputs"]')&&!artifactPreview.closest('.hidden, [hidden]'));
 assert.equal(d.querySelector('[data-adv-tab="outputs"]').getAttribute('aria-selected'),'true');
 assert.equal(artifactPreview.querySelector('.adv-status'),null);
 assert.match(artifactPreview.textContent,/\{"ok":true\}/);
 assert.match(d.querySelector('[data-preview]').textContent,/README\.md.*# Hello/);
 assert.ok(d.querySelector('[data-preview]').closest('.hidden, [hidden]'));
 d.querySelector('[data-artifact-path]').value='dist/bundle.js';
 d.querySelector('[data-artifact-add]').click();
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.match(d.querySelector('[data-artifacts]').textContent,/bundle\.js/);

 // Web preview & browser tab: live preview start/stop + browser start/inspect/stop
 d.querySelector('[data-adv-tab="preview"]').click();
 d.querySelector('[data-preview-port]').value='3000';
 d.querySelector('[data-preview-start]').click();
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.equal(d.querySelector('[data-live-frame]').classList.contains('hidden'),false);
 d.querySelector('[data-agent-browser-start]').click();
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 d.querySelector('[data-agent-browser-inspect]').click();
 await new Promise(r=>setImmediate(r));
 assert.equal(d.querySelector('[data-agent-browser-result]').textContent,'<h1>App</h1>');
 d.querySelector('[data-preview-stop]').click();
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.equal(d.querySelector('[data-live-frame]').classList.contains('hidden'),true);

 // Models & access tab: capability filter, model run, directory grants, OS sandbox
 d.querySelector('[data-adv-tab="models"]').click();
 d.querySelector('[data-cap="vision"]').click();
 assert.equal(d.querySelector('[data-model]').options[0].disabled,true);
 assert.equal(d.querySelector('[data-model]').options[1].disabled,false);
 d.querySelector('[data-model]').value='openai/vision-pro';
 d.querySelector('[data-model-prompt]').value='Ping';
 d.querySelector('[data-model-run]').click();
 await new Promise(r=>setImmediate(r));
 assert.match(d.querySelector('[data-model-result]').textContent,/Model OK/);
 d.querySelector('[data-grant-path]').value='/shared/rw';
 d.querySelector('[data-grant-add]').click();
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.match(d.querySelector('[data-grants]').textContent,/\/shared\/rw/);
 assert.match(d.querySelector('[data-sandbox]').textContent,/bwrap: available/);
});

test('Files & Preview distinguishes project, file and preview loading from empty and error states',async t=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.exports={};w.require=name=>name==='./i18n'?i18nCore:({});
 let resolveProjects,resolveFiles,resolvePreview;
 const projectsPending=new Promise(resolve=>{resolveProjects=resolve});
 const filesPending=new Promise(resolve=>{resolveFiles=resolve});
 const previewPending=new Promise(resolve=>{resolvePreview=resolve});
 const ok=body=>new Response(JSON.stringify(body),{status:200});
 w.fetch=async url=>{
  const path=String(url);
  if(path==='/api/projects')return projectsPending;
  if(path.includes('/files?'))return filesPending;
  if(path.includes('/preview?'))return previewPending;
  return ok({projects:[],models:[],grants:[],artifacts:[],preview:null,mode:'disabled',backend:'test',available:false,enforced:false,externalBackends:'none',capability:{enabled:false,available:false},session:null});
 };
 w.eval(compiled);w.exports.mountAdvancedTools();
 const d=w.document;d.querySelector('.adv-fab').click();
 assert.equal(d.querySelector('[data-project-status]').textContent,'Loading projects…');
 resolveProjects(ok({projects:[{id:'project-1',name:'Project',path:'/tmp/project'}]}));
 await new Promise(r=>setImmediate(r));
 assert.equal(d.querySelector('[data-project-status]').textContent,'1 project(s)');
 assert.equal(d.querySelector('[data-file-browser]').textContent,'Loading files…');
 resolveFiles(ok({browser:{path:'',parent:null,entries:[],truncated:false}}));
 await new Promise(r=>setImmediate(r));
 assert.equal(d.querySelector('[data-file-browser]').textContent,'No visible files in this directory.');
 d.querySelector('[data-file-path]').value='src/main.ts';d.querySelector('[data-file-open]').click();
 assert.equal(d.querySelector('[data-preview]').textContent,'Loading preview…');
 resolvePreview(new Response(JSON.stringify({error:'Permission denied'}),{status:403}));
 await new Promise(r=>setImmediate(r));
 assert.equal(d.querySelector('[data-preview]').textContent,'Permission denied');
 assert.equal(d.querySelector('[data-preview] .error')!==null,true);
});

test('Generated outputs artifact Preview renders visibly in Outputs tab and resets scroll after drawer is visible',async t=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.exports={};w.require=name=>name==='./i18n'?i18nCore:({});
 const ok=(body,status=200)=>new Response(JSON.stringify(body),{status});
 const artifacts=[
  {id:'a-text',name:'summary.ts',path:'dist/summary.ts',size:24},
  {id:'a-img',name:'chart.png',path:'dist/chart.png',size:128},
  {id:'a-bin',name:'archive.bin',path:'dist/archive.bin',size:512},
  {id:'a-err',name:'missing.log',path:'dist/missing.log',size:16}
 ];
 w.fetch=async url=>{
  const path=String(url);
  if(path==='/api/projects')return ok({projects:[{id:'p1',name:'App',path:'/tmp/app'}]});
  if(path.includes('/artifacts?'))return ok({artifacts});
  if(path==='/api/artifacts/a-text/preview')return ok({artifact:artifacts[0],preview:{kind:'text',name:'summary.ts',path:'dist/summary.ts',size:24,language:'typescript',content:'export const ok = true;'}});
  if(path==='/api/artifacts/a-img/preview')return ok({artifact:artifacts[1],preview:{kind:'image',name:'chart.png',path:'dist/chart.png',size:128,mime:'image/png',data:'AQID'}});
  if(path==='/api/artifacts/a-bin/preview')return ok({artifact:artifacts[2],preview:{kind:'binary',name:'archive.bin',path:'dist/archive.bin',size:512,reason:'binary-or-unsupported'}});
  if(path==='/api/artifacts/a-err/preview')return ok({error:'Artifact not found'},404);
  return ok({browser:{path:'',parent:null,entries:[],truncated:false},models:[],grants:[],preview:null,mode:'disabled',backend:'test',available:false,enforced:false,externalBackends:'none',capability:{enabled:false,available:false},session:null});
 };
 w.eval(compiled);w.exports.mountAdvancedTools();
 const d=w.document;
 const drawer=d.querySelector('.adv-drawer');
 const scrollBox=d.querySelector('.adv-scroll');
 const scrollHiddenStates=[];
 let scrollTopValue=75;
 Object.defineProperty(scrollBox,'scrollTop',{
  configurable:true,
  get(){return scrollTopValue;},
  set(v){scrollTopValue=v;scrollHiddenStates.push({value:v,drawerHidden:drawer.classList.contains('hidden')});}
 });

 d.querySelector('.adv-fab').click();
 assert.deepEqual(scrollHiddenStates,[{value:0,drawerHidden:false}]);
 assert.equal(scrollBox.scrollTop,0);
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));

 d.querySelector('[data-adv-tab="outputs"]').click();
 const previewButtons=[...d.querySelectorAll('[data-artifacts] .adv-item button')];
 assert.equal(previewButtons.length,4);
 const artifactPreview=d.querySelector('[data-artifact-preview]');

 // Text artifact preview stays visible inside Outputs tab
 previewButtons[0].click();
 await new Promise(r=>setImmediate(r));
 assert.ok(!artifactPreview.closest('.hidden, [hidden]'));
 assert.equal(d.querySelector('[data-adv-tab="outputs"]').getAttribute('aria-selected'),'true');
 assert.equal(artifactPreview.querySelector('.adv-status'),null);
 assert.equal(artifactPreview.querySelector('pre.adv-code.language-typescript')?.textContent,'export const ok = true;');
 assert.ok(artifactPreview.querySelector('pre.adv-code.language-typescript'));
 assert.ok(artifactPreview.querySelector('.adv-token-keyword'));

 // Image artifact preview
 previewButtons[1].click();
 await new Promise(r=>setImmediate(r));
 const img=artifactPreview.querySelector('img');
 assert.ok(img);
 assert.equal(img.alt,'chart.png');
 assert.equal(img.src,'data:image/png;base64,AQID');

 // Binary artifact preview
 previewButtons[2].click();
 await new Promise(r=>setImmediate(r));
 assert.ok(artifactPreview.querySelector('.adv-binary'));
 assert.match(artifactPreview.textContent,/Preview unavailable: binary or unsupported file type/);

 // Error clears prior preview inside Outputs preview box and keeps project status intact
 previewButtons[3].click();
 await new Promise(r=>setImmediate(r));
 assert.equal(artifactPreview.querySelector('.adv-binary'),null);
 assert.equal(artifactPreview.querySelector('.adv-status.error')?.textContent,'Artifact not found');
 assert.equal(d.querySelector('[data-project-status]').textContent,'1 project(s)');
});

test('Project file list tap opens text files, navigates directories with Up, and shows clear binary/large limits',async t=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.exports={};w.require=name=>name==='./i18n'?i18nCore:({});
 w.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true'};
 const previewCalls=[];
 const ok=body=>new Response(JSON.stringify(body),{status:200});
 w.fetch=async url=>{
  const path=String(url);
  if(path==='/api/projects')return ok({projects:[{id:'project-1',name:'Project',path:'/tmp/project'}]});
  if(path==='/api/projects/project-1/files?path='){
   return ok({
    browser:{
     path:'',parent:null,truncated:false,
     limits:{textBytes:1048576,imageBytes:8388608},
     entries:[
      {name:'src',path:'src',kind:'directory',hidden:false,size:null},
      {name:'README.md',path:'README.md',kind:'text',hidden:false,size:120,language:'markdown',previewable:true,limit:null},
      {name:'payload.bin',path:'payload.bin',kind:'binary',hidden:false,size:4096,language:null,previewable:false,limit:null},
      {name:'large',path:'large',kind:'large',hidden:false,size:2400000,language:null,previewable:false,limit:1048576}
     ]
    }
   });
  }
  if(path==='/api/projects/project-1/files?path=src'){
   return ok({
    browser:{
     path:'src',parent:'',truncated:false,
     limits:{textBytes:1048576,imageBytes:8388608},
     entries:[
      {name:'index.ts',path:'src/index.ts',kind:'text',hidden:false,size:42,language:'typescript',previewable:true,limit:null}
     ]
    }
   });
  }
  if(path.startsWith('/api/projects/project-1/preview?path=')){
   const rel=decodeURIComponent(path.split('?path=')[1]||'');
   previewCalls.push(rel);
   if(rel==='README.md')return ok({preview:{kind:'text',name:'README.md',path:'README.md',size:120,language:'markdown',content:'# Readme title\n'}});
   if(rel==='src/index.ts')return ok({preview:{kind:'text',name:'index.ts',path:'src/index.ts',size:42,language:'typescript',content:'export const ok = true;\n'}});
   if(rel==='payload.bin')return ok({preview:{kind:'binary',name:'payload.bin',path:'payload.bin',size:4096,reason:'binary-or-unsupported'}});
   if(rel==='large')return ok({preview:{kind:'binary',name:'large',path:'large',size:2400000,reason:'file-too-large',limit:1048576}});
   if(rel==='manual-large')return ok({preview:{kind:'binary',name:'manual-large',path:'manual-large',size:2500000,reason:'file-too-large',limit:1048576}});
   return new Response(JSON.stringify({error:'Not found'}),{status:404});
  }
  return ok({projects:[],models:[],grants:[],artifacts:[],preview:null,mode:'disabled',backend:'test',available:false,enforced:false,externalBackends:'none',capability:{enabled:false,available:false},session:null});
 };
 w.eval(compiled);w.exports.mountAdvancedTools();
 const d=w.document;d.querySelector('.adv-fab').click();
 await new Promise(r=>setImmediate(r));
 await new Promise(r=>setImmediate(r));

 const upBtn=d.querySelector('[data-browser-up]');
 assert.equal(upBtn.disabled,true);
 const btnFor=p=>d.querySelector(`[data-entry-path="${p}"]`);

 assert.equal(btnFor('payload.bin').disabled,false);
 assert.equal(btnFor('payload.bin').classList.contains('is-unpreviewable'),true);
 assert.match(btnFor('payload.bin').textContent,/binary \(no preview\)/);
 assert.equal(btnFor('large').disabled,false);
 assert.equal(btnFor('large').classList.contains('is-unpreviewable'),true);
 assert.match(btnFor('large').textContent,/too large \(max 1 MB\)/);

 // Tapping a text file opens preview directly and scrolls preview section into view.
 btnFor('README.md').click();
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(previewCalls,['README.md']);
 assert.equal(d.querySelector('[data-file-path]').value,'README.md');
 assert.equal(d.querySelector('[data-preview] pre.adv-code').textContent,'# Readme title\n');
 assert.equal(btnFor('README.md').getAttribute('aria-current'),'true');
 assert.equal(d.querySelector('[data-preview]').closest('.adv-section').dataset.scrolled,'true');

 // Tapping a binary file goes through the same preview endpoint and explains why it cannot open.
 btnFor('payload.bin').click();
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(previewCalls,['README.md','payload.bin']);
 assert.equal(d.querySelector('[data-preview] pre.adv-code'),null);
 assert.match(d.querySelector('[data-preview] .adv-binary').textContent,/binary or unsupported file type/);
 assert.equal(btnFor('payload.bin').getAttribute('aria-current'),'true');
 assert.equal(btnFor('README.md').hasAttribute('aria-current'),false);

 // Tapping a huge (~2.4 MB) file explains the exact size limit without rendering it as text.
 btnFor('large').click();
 await new Promise(r=>setImmediate(r));
 assert.match(d.querySelector('[data-preview] .adv-binary').textContent,/1 MB \(1,048,576 bytes\)/);
 assert.match(d.querySelector('[data-preview] .adv-status').textContent,/2,400,000 bytes/);

 // Manual path input uses the exact same limit/error formatting.
 d.querySelector('[data-file-path]').value='manual-large';
 d.querySelector('[data-file-open]').click();
 await new Promise(r=>setImmediate(r));
 assert.equal(previewCalls.at(-1),'manual-large');
 assert.match(d.querySelector('[data-preview] .adv-binary').textContent,/1 MB \(1,048,576 bytes\)/);

 // Tapping a directory enters it, enables Up, lets you tap a nested text file, and Up returns to root.
 btnFor('src').click();
 await new Promise(r=>setImmediate(r));
 assert.equal(d.querySelector('[data-browser-path]').textContent,'/src');
 assert.equal(upBtn.disabled,false);
 btnFor('src/index.ts').click();
 await new Promise(r=>setImmediate(r));
 assert.equal(previewCalls.at(-1),'src/index.ts');
 assert.equal(d.querySelector('[data-preview] pre.adv-code').textContent,'export const ok = true;\n');
 upBtn.click();
 await new Promise(r=>setImmediate(r));
 assert.equal(d.querySelector('[data-browser-path]').textContent,'/');
 assert.equal(upBtn.disabled,true);
});
