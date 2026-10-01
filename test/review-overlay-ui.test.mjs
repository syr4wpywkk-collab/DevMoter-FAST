import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
const source = await readFile(new URL('../src/workflow.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function setup(t) {
 const dom=new JSDOM('<body><button id="homeReview">Review</button><div id="workflowMount"></div></body>', {url:'http://localhost',runScripts:'outside-only'});
 t.after(()=>dom.window.close());
 dom.window.exports={};dom.window.fetch=async()=>new Response(JSON.stringify({projects:[]}));
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
