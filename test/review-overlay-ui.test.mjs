import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as projectLabels from "../src/project-labels.mjs";
import * as sheetHeader from "../src/sheet-header.mjs";
import * as i18nCore from "../src/i18n-core.mjs";
import * as apiError from "../src/api-error.mjs";
const source = await readFile(new URL('../src/workflow.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function setup(t) {
 const dom=new JSDOM('<body><button id="homeReview">Review</button><div id="workflowMount"></div></body>', {url:'http://localhost',runScripts:'outside-only'});
 t.after(()=>dom.window.close());
 dom.window.exports={};dom.window.require=name=>{if(name==='./project-labels.mjs')return projectLabels;if(name==='./sheet-header.mjs')return sheetHeader;if(name==='./i18n')return i18nCore;if(name==='./api-error.mjs')return apiError;throw new Error('unexpected module '+name);};dom.window.fetch=async()=>new Response(JSON.stringify({projects:[]}));
 dom.window.eval(compiled);
 const doc=dom.window.document;
 dom.window.exports.mountTaskWorkflow(doc.querySelector('#workflowMount'));
 doc.querySelector('#homeReview').focus();
 doc.querySelector('#wfLaunch').click();
 return {dom,doc,modal:doc.querySelector('#wfModal')};
}
test('Review overlay is independent of the current Home/chat surface',async()=>{
 const main=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
 assert.doesNotMatch(main,/workflowMount\.classList\.(add|remove)\("hidden"\)/);
});
test('Review opens with focus/scroll lock, tabs switch, Escape returns focus and previous scroll',t=>{
 const {dom,doc,modal}=setup(t);
 assert.equal(modal.classList.contains('hidden'),false);
 assert.equal(modal.getAttribute('aria-modal'),'true');
 assert.equal(doc.activeElement.id,'wfClose');assert.equal(doc.body.style.overflow,'hidden');
 for(const tab of ['worktrees','github','changes']){
  doc.querySelector(`[data-wf-tab="${tab}"]`).click();
  assert.equal(doc.querySelector(`[data-wf-panel="${tab}"]`).classList.contains('hidden'),false);
 }
 modal.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
 assert.notEqual(doc.activeElement.id,'homeReview');
 modal.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(modal.classList.contains('hidden'),true);assert.equal(doc.body.style.overflow,'');assert.equal(doc.activeElement.id,'homeReview');
});
test('Review backdrop and navigation close the overlay',t=>{
 const {dom,doc,modal}=setup(t);modal.click();assert.equal(modal.classList.contains('hidden'),true);
 doc.querySelector('#wfLaunch').click();dom.window.dispatchEvent(new dom.window.CustomEvent('devmoter:surface-changed'));
 assert.equal(modal.classList.contains('hidden'),true);assert.equal(doc.body.style.overflow,'');
});

function hunk(id, decision, oldText, newText) {
 return {id,oldStart:1,oldLines:1,newStart:1,newLines:1,oldText,newText,decision};
}
function changeFile(path, decision, hunks) {
 const preview={content:'',truncated:false,lines:0,totalLines:0,bytes:0,totalBytes:0};
 return {path,decision,hunks,preview,acceptedPreview:preview};
}
function reviewChanges() {
 return [{id:'c1',status:'pending',source:'agent',autoCommit:false,appliedFiles:[],files:[
  changeFile('src/alpha.ts','pending',[hunk('h1','pending','old alpha\n','new <img src=x onerror=alert(1)> alpha\n'),hunk('h2','pending','x\n','y\n')]),
  changeFile('src/beta.ts','accept',[hunk('h1','accept','old beta\n','new Beta\n')]),
  changeFile('docs/gamma.md','reject',[hunk('h1','reject','old gamma\n','new gamma\n')])
 ]}];
}
async function setupReview(t, options={}) {
 const dom=new JSDOM('<body><div id="workflowMount"></div></body>',{url:'http://localhost',runScripts:'outside-only'});
 t.after(()=>dom.window.close());
 const projects=options.projects??[{id:'p1',name:'Demo',path:'/demo'}];
 const state={changes:options.changes??reviewChanges(),isGit:options.isGit??true,failGit:false,failChanges:false,requests:[],copied:[],pendingChanges:null,pendingGit:null};
 dom.window.exports={};dom.window.require=name=>{if(name==='./project-labels.mjs')return projectLabels;if(name==='./sheet-header.mjs')return sheetHeader;if(name==='./i18n')return i18nCore;if(name==='./api-error.mjs')return apiError;throw new Error('unexpected module '+name);};
 dom.window.fetch=async(url,init={})=>{
  const method=String(init.method||'GET').toUpperCase();
  state.requests.push(method+' '+url);
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
  if(url==='/api/projects')return json({projects});
  if(String(url).endsWith('/git/status')){
   if(state.failGit)return json({error:'boom'},500);
   if(state.pendingGit){const captured=state.isGit;const gate=state.pendingGit;state.pendingGit=null;await gate;return json({isGit:captured});}
   return json({isGit:state.isGit});
  }
  if(String(url).endsWith('/changes')){
   if(state.failChanges)return json({error:'boom'},500);
   if(state.pendingChanges){const gate=state.pendingChanges;state.pendingChanges=null;const stale=structuredClone(state.changes);await gate;return json({changes:stale});}
   return json({changes:structuredClone(state.changes)});
  }
  if(String(url).endsWith('/worktrees'))return json({worktrees:[]});
  if(String(url).endsWith('/github/tasks'))return json({tasks:[]});
  if(method==='PATCH'&&String(url).endsWith('/review')){
   for(const item of JSON.parse(init.body).files){const file=state.changes[0].files.find(entry=>entry.path===item.path);if(item.decision){file.decision=item.decision;file.hunks.forEach(entry=>{entry.decision=item.decision;});}}
   return json({ok:true});
  }
  return json({error:'unexpected '+url},404);
 };
 if(options.clipboard!==false)Object.defineProperty(dom.window.navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(options.clipboard==='deny')throw new Error('denied');state.copied.push(text);}}});
 dom.window.eval(compiled);
 const doc=dom.window.document;
 dom.window.exports.mountTaskWorkflow(doc.querySelector('#workflowMount'));
 doc.querySelector('#wfLaunch').click();
 const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,0));};
 await settle();
 const visible=()=>Array.from(doc.querySelectorAll('.wf-file:not(.hidden)')).map(node=>node.dataset.path);
 const mutations=()=>state.requests.filter(entry=>!entry.startsWith('GET '));
 const type=(selector,value)=>{const input=doc.querySelector(selector);input.value=value;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 return {dom,doc,state,settle,visible,mutations,type};
}
test('Review counts come from loaded data and the decision filter is view-only',async t=>{
 const {doc,state,visible,mutations}=await setupReview(t);
 const count=name=>doc.querySelector(`[data-wf-count="${name}"]`).textContent;
 assert.deepEqual(['all','pending','accept','reject'].map(count),['3','1','1','1']);
 assert.equal(doc.querySelector('[data-wf-filter="partial"]').classList.contains('hidden'),true);
 const before=JSON.stringify(state.changes);
 doc.querySelector('[data-wf-filter="reject"]').click();
 assert.deepEqual(visible(),['docs/gamma.md']);
 assert.equal(doc.querySelector('[data-wf-filter="reject"]').getAttribute('aria-pressed'),'true');
 doc.querySelector('[data-wf-filter="pending"]').click();
 assert.deepEqual(visible(),['src/alpha.ts']);
 doc.querySelector('[data-wf-filter="all"]').click();
 assert.equal(visible().length,3);
 assert.deepEqual(mutations(),[]);
 assert.equal(JSON.stringify(state.changes),before);
 assert.deepEqual(Array.from(doc.querySelectorAll('.wf-file')).map(node=>node.dataset.decision),['pending','accept','reject']);
});
test('Review path search narrows the list, keeps decisions, and clears back to all files',async t=>{
 const {doc,visible,mutations,type}=await setupReview(t);
 type('#wfPathSearch','SRC/');
 assert.deepEqual(visible(),['src/alpha.ts','src/beta.ts']);
 doc.querySelector('[data-wf-filter="accept"]').click();
 assert.deepEqual(visible(),['src/beta.ts']);
 type('#wfPathSearch','nothing-here');
 assert.deepEqual(visible(),[]);
 assert.equal(doc.querySelector('#wfNoMatch').classList.contains('hidden'),false);
 doc.querySelector('[data-wf-filter="all"]').click();
 type('#wfPathSearch','');
 assert.equal(visible().length,3);
 assert.equal(doc.querySelector('#wfNoMatch').classList.contains('hidden'),true);
 assert.deepEqual(mutations(),[]);
});
test('Review copies only the relative path and reports success and failure',async t=>{
 const ok=await setupReview(t);
 ok.doc.querySelector('.wf-file[data-path="src/beta.ts"] [data-wf-action="copy-path"]').click();
 await ok.settle();
 assert.deepEqual(ok.state.copied,['src/beta.ts']);
 assert.match(ok.doc.querySelector('#wfStatus').textContent,/src\/beta\.ts/);
 assert.equal(ok.doc.querySelector('#wfStatus').classList.contains('error'),false);
 assert.deepEqual(ok.mutations(),[]);
 for(const clipboard of ['deny',false]){
  const bad=await setupReview(t,{clipboard});
  bad.doc.querySelector('[data-wf-action="copy-path"]').click();
  await bad.settle();
  assert.equal(bad.doc.querySelector('#wfStatus').classList.contains('error'),true);
  assert.deepEqual(bad.state.copied,[]);
 }
});
test('Review previous/next file moves focus within the visible list and disables the ends',async t=>{
 const {doc,mutations}=await setupReview(t);
 const file=path=>doc.querySelector(`.wf-file[data-path="${path}"]`);
 const nav=(path,dir)=>file(path).querySelector(`[data-wf-action="file-${dir}"]`);
 assert.equal(nav('src/alpha.ts','prev').disabled,true);
 assert.equal(nav('src/alpha.ts','next').disabled,false);
 assert.equal(nav('docs/gamma.md','next').disabled,true);
 nav('src/alpha.ts','next').click();
 assert.equal(doc.activeElement,file('src/beta.ts'));
 nav('src/beta.ts','prev').click();
 assert.equal(doc.activeElement,file('src/alpha.ts'));
 doc.querySelector('[data-wf-filter="reject"]').click();
 assert.equal(nav('docs/gamma.md','prev').disabled,true);
 assert.equal(nav('docs/gamma.md','next').disabled,true);
 assert.deepEqual(mutations(),[]);
});
test('Review diff search highlights matches as plain text',async t=>{
 const {dom,doc,type}=await setupReview(t);
 dom.window.alert=()=>{throw new Error('search term executed');};
 type('#wfDiffSearch','beta');
 const marks=Array.from(doc.querySelectorAll('#wfChanges mark.wf-mark')).map(node=>node.textContent);
 assert.deepEqual(marks,['beta','Beta']);
 assert.match(doc.querySelector('#wfMatchInfo').textContent,/2/);
 const payload='<img src=x onerror=alert(1)>';
 type('#wfDiffSearch',payload);
 assert.equal(doc.querySelectorAll('#wfChanges img').length,0);
 assert.deepEqual(Array.from(doc.querySelectorAll('#wfChanges mark.wf-mark')).map(node=>node.textContent),[payload]);
 type('#wfDiffSearch','.*');
 assert.equal(doc.querySelectorAll('#wfChanges mark').length,0);
 const pre=doc.querySelector('.wf-file[data-path="src/beta.ts"] .wf-hunk > pre');
 type('#wfDiffSearch','');
 assert.equal(doc.querySelectorAll('#wfChanges mark').length,0);
 assert.match(pre.textContent,/\+ new Beta/);
});
test('Review expand/collapse all only changes disclosure state and survives a refresh',async t=>{
 const {doc,settle,mutations}=await setupReview(t);
 const open=()=>Array.from(doc.querySelectorAll('details.wf-hunk')).map(node=>node.open);
 assert.deepEqual(open(),[false,false,true,true]);
 doc.querySelector('#wfExpandAll').click();
 assert.deepEqual(open(),[true,true,true,true]);
 doc.querySelector('#wfCollapseAll').click();
 assert.deepEqual(open(),[false,false,false,false]);
 doc.querySelector('#wfRefresh').click();
 await settle();
 assert.deepEqual(open(),[false,false,false,false]);
 assert.deepEqual(mutations(),[]);
});
test('Review refresh keeps the current list on failure and never lets a stale response overwrite a decision',async t=>{
 const {doc,state,settle,visible,type}=await setupReview(t);
 type('#wfPathSearch','src/');
 state.failChanges=true;
 doc.querySelector('#wfRefresh').click();
 await settle();
 assert.equal(doc.querySelector('#wfStatus').classList.contains('error'),true);
 assert.deepEqual(visible(),['src/alpha.ts','src/beta.ts']);
 assert.equal(doc.querySelector('#wfPathSearch').value,'src/');
 state.failChanges=false;
 let release;
 state.pendingChanges=new Promise(resolve=>{release=resolve;});
 doc.querySelector('#wfRefresh').click();
 await settle();
 doc.querySelector('.wf-file[data-path="src/alpha.ts"] [data-wf-action="file-reject"]').click();
 await settle();
 assert.equal(doc.querySelector('.wf-file[data-path="src/alpha.ts"]').dataset.decision,'reject');
 release();
 await settle();
 assert.equal(doc.querySelector('.wf-file[data-path="src/alpha.ts"]').dataset.decision,'reject');
 assert.equal(doc.querySelector('[data-wf-count="reject"]').textContent,'2');
});
test('Non-Git project shows a shared repository notice and disables only Git-dependent controls',async t=>{
 const {doc,mutations}=await setupReview(t,{changes:[],isGit:false});
 const notice=doc.querySelector('#wfRepositoryNotice');
 assert.equal(notice.classList.contains('hidden'),false);
 assert.match(notice.textContent,/not a Git repository/);
 assert.match(notice.textContent,/git init/);
 assert.equal(doc.querySelector('#wfStatus').textContent,'');
 assert.equal(doc.querySelector('#wfChanges .wf-empty'),null);
 assert.equal(doc.querySelector('#wfWorktrees .wf-empty'),null);
 assert.equal(doc.querySelector('#wfLoadDiff').disabled,true);
 for(const control of doc.querySelectorAll('#wfWorktreeForm input, #wfWorktreeForm button, #wfPrForm input, #wfPrForm select, #wfPrForm textarea, #wfPrForm button'))
  assert.equal(control.disabled,true);
 for(const control of doc.querySelectorAll('#wfIssueForm input, #wfIssueForm textarea, #wfIssueForm button'))
  assert.equal(control.disabled,false);
 for(const tab of ['worktrees','github','changes']){
  doc.querySelector(`[data-wf-tab="${tab}"]`).click();
  assert.equal(notice.classList.contains('hidden'),false);
 }
 assert.deepEqual(mutations(),[]);
});
test('Git project with no changes hides the notice and keeps standard empty states',async t=>{
 const {doc}=await setupReview(t,{changes:[],isGit:true});
 assert.equal(doc.querySelector('#wfRepositoryNotice').classList.contains('hidden'),true);
 assert.match(doc.querySelector('#wfChanges').textContent,/No changes to review/);
 assert.match(doc.querySelector('#wfWorktrees').textContent,/No worktrees/);
 assert.equal(doc.querySelector('#wfStatus').textContent,'Ready');
 assert.equal(doc.querySelector('#wfLoadDiff').disabled,false);
 assert.equal(doc.querySelector('#wfWorktreeForm button[type="submit"]').disabled,false);
 assert.equal(doc.querySelector('#wfPrForm button[type="submit"]').disabled,false);
});
test('Git status refreshes toggle the notice and a status failure keeps the previous state',async t=>{
 const {doc,state,settle}=await setupReview(t,{changes:[],isGit:false});
 const notice=doc.querySelector('#wfRepositoryNotice');
 assert.equal(notice.classList.contains('hidden'),false);
 assert.equal(doc.querySelector('#wfLoadDiff').disabled,true);
 // Same-project refresh after `git init`: the notice clears and controls re-enable.
 state.isGit=true;
 doc.querySelector('#wfRefresh').click();
 await settle();
 assert.equal(notice.classList.contains('hidden'),true);
 assert.equal(doc.querySelector('#wfLoadDiff').disabled,false);
 assert.equal(doc.querySelector('#wfStatus').textContent,'Ready');
 assert.match(doc.querySelector('#wfChanges').textContent,/No changes to review/);
 state.isGit=false;
 doc.querySelector('#wfRefresh').click();
 await settle();
 assert.equal(notice.classList.contains('hidden'),false);
 assert.equal(doc.querySelector('#wfLoadDiff').disabled,true);
 assert.equal(doc.querySelector('#wfStatus').textContent,'');
 // A failing status request must not classify a known Git project as non-Git.
 state.isGit=true;
 doc.querySelector('#wfRefresh').click();
 await settle();
 assert.equal(notice.classList.contains('hidden'),true);
 state.failGit=true;
 doc.querySelector('#wfRefresh').click();
 await settle();
 assert.equal(notice.classList.contains('hidden'),true);
 assert.equal(doc.querySelector('#wfLoadDiff').disabled,false);
 assert.equal(doc.querySelector('#wfStatus').classList.contains('error'),true);
 assert.match(doc.querySelector('#wfStatus').textContent,/Refresh failed/);
});
test('Switching projects resets repository state and a stale status response cannot override the newer project',async t=>{
 const projects=[{id:'p1',name:'One',path:'/one'},{id:'p2',name:'Two',path:'/two'}];
 const {dom,doc,state,settle}=await setupReview(t,{changes:[],isGit:false,projects});
 const notice=doc.querySelector('#wfRepositoryNotice');
 const select=doc.querySelector('#wfProject');
 assert.equal(notice.classList.contains('hidden'),false);
 assert.equal(doc.querySelector('#wfLoadDiff').disabled,true);
 // p2 is a Git project: switching clears the notice and re-enables controls.
 state.isGit=true;
 select.value='p2';
 select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.equal(notice.classList.contains('hidden'),true);
 assert.equal(doc.querySelector('#wfStatus').textContent,'Refreshing…');
 await settle();
 assert.equal(notice.classList.contains('hidden'),true);
 assert.equal(doc.querySelector('#wfLoadDiff').disabled,false);
 assert.equal(doc.querySelector('#wfStatus').textContent,'Ready');
 // A slow p1 status response must not mark the now-active p2 as non-Git.
 state.isGit=false;
 let release;
 state.pendingGit=new Promise(resolve=>{release=resolve;});
 select.value='p1';
 select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 await settle();
 state.isGit=true;
 select.value='p2';
 select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 await settle();
 release();
 await settle();
 assert.equal(notice.classList.contains('hidden'),true);
 assert.equal(doc.querySelector('#wfLoadDiff').disabled,false);
 assert.equal(select.value,'p2');
});
test('Non-Git project still lists agent proposals and keeps review/apply and issue-to-task usable',async t=>{
 const {doc,settle,mutations}=await setupReview(t,{isGit:false});
 assert.equal(doc.querySelector('#wfRepositoryNotice').classList.contains('hidden'),false);
 assert.equal(doc.querySelectorAll('.wf-file').length,3);
 assert.equal(doc.querySelector('[data-wf-action="apply"]').disabled,false);
 assert.equal(doc.querySelector('[data-wf-action="file-accept"]').disabled,false);
 assert.equal(doc.querySelector('#wfIssueForm button[type="submit"]').disabled,false);
 doc.querySelector('.wf-file[data-path="src/beta.ts"] [data-wf-action="file-accept"]').click();
 await settle();
 assert.equal(doc.querySelector('.wf-file[data-path="src/beta.ts"]').dataset.decision,'accept');
 assert.equal(mutations().some(entry=>entry.includes('/review')),true);
});
test('Non-Git applied proposals disable commit controls until Git is available',async t=>{
 const changes=reviewChanges();
 changes[0].status='applied';
 const {doc,state,settle}=await setupReview(t,{changes,isGit:false});
 const controls=()=>Array.from(doc.querySelectorAll('[data-wf-action="generate-message"], [data-wf-action="commit"]'));
 assert.equal(controls().length,2);
 assert.equal(controls().every(control=>control.disabled),true);
 state.isGit=true;
 doc.querySelector('#wfRefresh').click();
 await settle();
 assert.equal(controls().every(control=>!control.disabled),true);
});
