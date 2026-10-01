import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import ts from 'typescript';
const compiled=ts.transpileModule(await readFile(new URL('../src/workspace-tools.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const settle=()=>new Promise(r=>setImmediate(r));
test('Unified and split diffs expose addition/deletion text while Copy keeps the original API diff',async t=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
 w.exports={};w.matchMedia=()=>({matches:false});let copied='';Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async s=>{copied=s}}});
 const diff='diff --git a/file.md b/file.md\n--- a/file.md\n+++ b/file.md\n@@ -1 +1 @@\n-old\n+new\n';
 w.fetch=async url=>new Response(JSON.stringify(url==='/api/projects'?{projects:[{id:'p1',name:'A',path:'/a'}]}:url.includes('/git/status')?{isGit:true,branch:'main',modified:1}:url.includes('/git/files')?{files:[{path:'file.md',status:['modified']}],total:1,hasMore:false}:{isGit:true,path:'file.md',diff,scope:'working'}));
 w.eval(compiled);w.exports.mountWorkspaceTools();w.document.querySelector('.pocket-git-trigger').click();await settle();await settle();
 w.document.querySelector('.pocket-git-file').click();await settle();await settle();
 for(const mode of ['Unified','Split']){
  [...w.document.querySelectorAll('.pocket-diff-mode button')].find(b=>b.textContent===mode).click();
  assert.ok(w.document.querySelector('[aria-label="Added line: new"]'));assert.ok(w.document.querySelector('[aria-label="Deleted line: old"]'));
  assert.ok([...w.document.querySelectorAll('.pocket-diff-marker')].some(n=>n.textContent==='+ '));
 }
 [...w.document.querySelectorAll('.pocket-diff-toolbar button')].find(b=>b.textContent==='Copy').click();assert.equal(copied,diff);
});

test('Git failures offer an actual read-only retry and closing restores focus and scroll',async t=>{
 const dom=new JSDOM('<body><button id="entry">Git</button></body>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
 w.exports={};w.matchMedia=()=>({matches:false});let attempts=0;
 w.fetch=async()=>{attempts++;return new Response(JSON.stringify({error:'Temporary failure'}),{status:503})};
 w.eval(compiled);w.exports.mountWorkspaceTools();w.document.querySelector('#entry').focus();w.document.querySelector('.pocket-git-trigger').click();await settle();
 assert.equal(w.document.body.style.overflow,'hidden');
 const retry=w.document.querySelector('.pocket-git-empty button');assert.ok(retry);retry.click();await settle();assert.equal(attempts,2);
 w.document.querySelector('#pocketGitClose').click();assert.equal(w.document.body.style.overflow,'');assert.equal(w.document.activeElement.id,'entry');
});
