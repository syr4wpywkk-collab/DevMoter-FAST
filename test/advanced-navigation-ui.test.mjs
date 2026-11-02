import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import ts from 'typescript';
const source=await readFile(new URL('../src/advanced.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
test('Files & Preview section shortcuts retain controls and move focus, Escape closes without changing data',async t=>{
 const dom=new JSDOM('<body><button id="entry">Files</button></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.exports={};w.require=()=>({});const requests=[];
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
 const w=dom.window;w.exports={};w.require=()=>({});
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
