import test from 'node:test';
import assert from 'node:assert/strict';
import * as i18nCore from '../src/i18n-core.mjs';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import ts from 'typescript';
const source=await readFile(new URL('../src/advanced.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
test('Files & Preview section shortcuts retain controls and move focus, Escape closes without changing data',async t=>{
 const dom=new JSDOM('<body><button id="entry">Files</button></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.exports={};w.require=name=>name==='./i18n'?i18nCore:({});const requests=[];
 w.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true'};
 w.fetch=async(url,options)=>{requests.push({url,method:options?.method||'GET'});return new Response(JSON.stringify({projects:[],models:[],grants:[],mode:'disabled'}))};
 w.eval(compiled);w.exports.mountAdvancedTools();
 const d=w.document;d.querySelector('#entry').focus();d.querySelector('.adv-fab').click();
 const drawer=d.querySelector('.adv-drawer');assert.equal(drawer.classList.contains('hidden'),false);assert.equal(d.activeElement.getAttribute('data-close'),'');
 const jumps=[...d.querySelectorAll('.adv-jump-nav button')];assert.equal(jumps.length,4);
 for(const jump of jumps){jump.click();assert.equal(d.activeElement.tagName,'H2');assert.equal(d.activeElement.parentElement.dataset.scrolled,'true')}
 for(const s of ['[data-file-open]','[data-preview-start]','[data-agent-browser-start]','[data-model-run]','[data-grant-add]'])assert.ok(d.querySelector(s),s);
 drawer.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(drawer.classList.contains('hidden'),true);assert.equal(d.body.style.overflow,'');assert.equal(d.activeElement.id,'entry');
 await new Promise(r=>setImmediate(r));assert.equal(d.querySelector('[data-project-status]').textContent,'Register a project first.');assert.ok(requests.every(r=>r.method==='GET'));
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
