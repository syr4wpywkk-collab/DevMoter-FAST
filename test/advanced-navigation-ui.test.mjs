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
 await new Promise(r=>setImmediate(r));assert.ok(requests.every(r=>r.method==='GET'));
});
