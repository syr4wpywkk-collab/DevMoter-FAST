import "./session-control.css";

type Backend = "codex" | "opencode";
type Status = "running" | "waiting" | "done" | "idle" | "failed" | "interrupted" | "unknown";
type Json = Record<string, any>;
type Session = {
  key: string; id: string; backend: Backend; title: string; project: string; projectId?: string;
  agent: string; model: string; updatedAt: number; status: Status; turns: number; tokens: number;
  activeTurnId?: string | null; excerpt?: string;
};
type Message = { role: "user" | "assistant" | "system"; text: string };
type ControlState = { version: 1; queue: Json[]; budgets: Record<string, Json>; ownership: Record<string, Json>; checkpoints: Json[]; events: Json[] };
type MountOptions = { switchBackend?: (backend: Backend) => void };

const MAX_SCAN = 40;
const MAX_MESSAGES = 80;
const MAX_CHARS = 28000;

function uid() { return globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2); }
function keyOf(backend: Backend, id: string) { return backend + ":" + id; }
function label(backend: Backend) { return backend === "codex" ? "Codex" : "OpenCode"; }
function statusLabel(value: Status) { return ({running:"Running",waiting:"Waiting",done:"Done",idle:"Idle",failed:"Failed",interrupted:"Interrupted",unknown:"Unknown"} as Record<Status,string>)[value]; }
function statusFrom(value: unknown): Status {
  const raw = typeof value === "string" ? value : String((value as Json)?.type || (value as Json)?.status || (value as Json)?.state || "");
  const text = raw.toLowerCase();
  if (/wait|approval|question|input/.test(text)) return "waiting";
  if (/run|work|progress|active|start/.test(text)) return "running";
  if (/fail|error/.test(text)) return "failed";
  if (/interrupt|cancel|abort|stop/.test(text)) return "interrupted";
  if (/complete|success|done|finish/.test(text)) return "done";
  if (/idle|ready/.test(text)) return "idle";
  return "unknown";
}
function tokenMetric(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const obj = value as Json;
  for (const k of ["totalTokens","total_tokens","total"]) { const n = Number(obj[k]); if (Number.isFinite(n) && n >= 0) return n; }
  const direct = ["inputTokens","input_tokens","input","outputTokens","output_tokens","output","reasoningTokens","reasoning_tokens","reasoning"].map(k => Number(obj[k])).filter(Number.isFinite);
  if (direct.length) return direct.reduce((a,b) => a+b,0);
  let best = 0; for (const child of Object.values(obj)) best = Math.max(best, tokenMetric(child)); return best;
}
async function json<T=Json>(url: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const res = await fetch(url, { ...init, headers: { ...(init.body ? {"content-type":"application/json"} : {}), ...((method !== "GET" && method !== "HEAD") ? {"x-pocket-operation-id":uid()} : {}), ...(init.headers || {}) }, cache: method === "GET" ? "no-store" : undefined });
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error?.message || payload?.error || payload?.message || ("HTTP " + res.status));
  return payload as T;
}
async function codex<T=Json>(method: string, params: Json = {}): Promise<T> {
  const out = await json<{result?:T}>("/api/codex/rpc", {method:"POST", body:JSON.stringify({method,params})}); return out.result as T;
}
async function oc<T=Json>(path: string, init: RequestInit = {}, projectId?: string): Promise<T> {
  const out = await json<any>("/api/opencode" + path, { ...init, headers: { ...(projectId ? {"x-pocket-project-id":projectId} : {}), ...(init.headers || {}) } });
  return out && typeof out === "object" && !Array.isArray(out) && Object.prototype.hasOwnProperty.call(out,"data") ? out.data as T : out as T;
}
function compact(messages: Message[]) {
  const picked = messages.slice(-MAX_MESSAGES); const out: Message[] = []; let left = MAX_CHARS;
  for (let i=picked.length-1;i>=0 && left>0;i--) { const m=picked[i]; const text=m.text.slice(Math.max(0,m.text.length-left)); left-=text.length; out.unshift({...m,text}); }
  return out;
}
function filesFrom(messages: Message[]) {
  const found = new Set<string>(); const re = /(?:^|\s)([./~][\w@%+.,:=~/-]+\.[A-Za-z0-9]{1,12}|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,12})/g;
  for (const m of messages) for (const match of m.text.matchAll(re)) if (match[1]) found.add(match[1].replace(/[),.;:'"]+$/,""));
  return [...found].slice(0,80);
}
function handoffText(source: Session, messages: Message[], mode: string, note = "") {
  const files = filesFrom(messages); const lines = ["[DevMoter " + mode + "]","Source backend: "+label(source.backend),"Source session: "+source.id,"Source project: "+(source.project||"unknown")];
  if (note) lines.push("Instruction: "+note); lines.push(files.length ? "Referenced files:\n"+files.map(f=>"- "+f).join("\n") : "Referenced files: none detected", "", "Conversation context:");
  messages.forEach((m,i)=>lines.push(String(i+1)+". "+m.role.toUpperCase()+": "+m.text)); return {text:lines.join("\n"),files};
}

export function mountSessionControl(options: MountOptions = {}) {
  let sessions: Session[] = []; let control: ControlState = {version:1,queue:[],budgets:{},ownership:{},checkpoints:[],events:[]};
  let activeTab = "activity"; let searchHits = new Map<string,string>(); let toastTimer:number|null=null;
  const root = document.createElement("div"); root.className="sc-shell";
  root.innerHTML = [
    '<button class="sc-fab" type="button" aria-label="Session Control">✦</button>',
    '<div class="sc-scrim hidden"></div>',
    '<section class="sc-panel" aria-hidden="true">',
    '<header class="sc-head"><div><strong>Session Control</strong><small>#31–#40 · local-first</small></div><button class="sc-close" type="button">×</button></header>',
    '<div class="sc-toolbar"><input class="sc-search" type="search" placeholder="Search local session text…"><button class="sc-search-run" type="button">Search</button><select class="sc-backend"><option value="">All agents</option><option value="codex">Codex</option><option value="opencode">OpenCode</option></select><select class="sc-project"><option value="">All projects</option></select><select class="sc-status"><option value="">All states</option><option value="running">Running</option><option value="waiting">Waiting</option><option value="done">Done</option><option value="idle">Idle</option><option value="failed">Failed</option><option value="interrupted">Interrupted</option></select><button class="sc-refresh" type="button">Refresh</button></div>',
    '<div class="sc-tabs"><button class="active" data-tab="activity">Activity</button><button data-tab="queue">Queue <span class="sc-queue-count"></span></button><button data-tab="checkpoints">Checkpoints</button><button data-tab="history">History</button></div>',
    '<div class="sc-body"></div><div class="sc-toast hidden"></div></section>'
  ].join(""); document.body.appendChild(root);
  const panel=root.querySelector<HTMLElement>(".sc-panel")!, scrim=root.querySelector<HTMLElement>(".sc-scrim")!, body=root.querySelector<HTMLDivElement>(".sc-body")!, search=root.querySelector<HTMLInputElement>(".sc-search")!, backendFilter=root.querySelector<HTMLSelectElement>(".sc-backend")!, projectFilter=root.querySelector<HTMLSelectElement>(".sc-project")!, statusFilter=root.querySelector<HTMLSelectElement>(".sc-status")!, count=root.querySelector<HTMLElement>(".sc-queue-count")!, toast=root.querySelector<HTMLElement>(".sc-toast")!;
  const notify=(text:string)=>{ if(toastTimer!==null) clearTimeout(toastTimer); toast.textContent=text; toast.classList.remove("hidden"); toastTimer=window.setTimeout(()=>toast.classList.add("hidden"),2200); };
  const open=()=>{ panel.classList.add("open"); panel.setAttribute("aria-hidden","false"); scrim.classList.remove("hidden"); void refresh(); };
  const close=()=>{ panel.classList.remove("open"); panel.setAttribute("aria-hidden","true"); scrim.classList.add("hidden"); };
  root.querySelector(".sc-fab")!.addEventListener("click",open); root.querySelector(".sc-close")!.addEventListener("click",close); scrim.addEventListener("click",close);

  async function codexMessages(id:string): Promise<Message[]> { const p=await codex<Json>("thread/read",{threadId:id,includeTurns:true}); const out:Message[]=[]; for(const turn of p?.thread?.turns??[]) for(const item of turn?.items??[]){ if(item?.type==="userMessage"){const text=(Array.isArray(item.content)?item.content:[]).filter((x:Json)=>x?.type==="text").map((x:Json)=>String(x.text||"")).join(""); if(text)out.push({role:"user",text});} else if(item?.type==="agentMessage"&&item.text)out.push({role:"assistant",text:String(item.text)}); } return compact(out); }
  async function ocMessages(id:string): Promise<Message[]> { const list=await oc<Json[]>("/session/"+encodeURIComponent(id)+"/context"); const out:Message[]=[]; for(const item of Array.isArray(list)?list:[]){ if(item?.type==="user"&&item.text)out.push({role:"user",text:String(item.text)}); else if(item?.type==="assistant"){const text=(Array.isArray(item.content)?item.content:[]).filter((x:Json)=>x?.type==="text").map((x:Json)=>String(x.text||"")).join("\n"); if(text)out.push({role:"assistant",text});} else { const role=item?.info?.role; if(role==="user"||role==="assistant"){const text=(Array.isArray(item.parts)?item.parts:[]).filter((x:Json)=>x?.type==="text").map((x:Json)=>String(x.text||"")).join("\n"); if(text)out.push({role,text});} } } return compact(out); }
  const messages=(s:Session)=>s.backend==="codex"?codexMessages(s.id):ocMessages(s.id);

  async function inventory() {
    const projectsPayload=await json<{projects?:Json[]}>("/api/projects").catch(()=>({projects:[]})); const projects=(projectsPayload.projects??[]).filter(p=>p.available!==false);
    const [c,o,active]=await Promise.all([codex<{data?:Json[]}>("thread/list",{limit:60}).catch(()=>({data:[]})),oc<Json[]>("/session?limit=80&order=desc").catch(()=>[]),oc<Json>("/session/active").catch(()=>({}))]);
    const activeObj = active as Json; const activeMap=(activeObj?.data&&typeof activeObj.data==="object"?activeObj.data:activeObj) as Json; const base:Session[]=[];
    for(const t of c.data??[]){ const id=String(t.id||""); if(!id)continue; let status:Status="unknown", turns=0,tokens=0,activeTurnId:string|null=null; try{const p=await codex<Json>("thread/read",{threadId:id,includeTurns:true}); const ts=p?.thread?.turns??[]; turns=ts.length; const last=ts.at(-1); status=statusFrom(p?.thread?.status); if(status==="unknown")status=statusFrom(last?.status); const a=[...ts].reverse().find((x:Json)=>["running","waiting"].includes(statusFrom(x?.status))); activeTurnId=a?.id?String(a.id):null; tokens=tokenMetric(p?.thread?.usage??p?.thread);}catch{} base.push({key:keyOf("codex",id),id,backend:"codex",title:String(t.name||t.preview||"Untitled Codex thread"),project:String(t.cwd||""),projectId:projects.find(p=>p.path===t.cwd)?.id,agent:"Codex",model:String(t.model||"default"),updatedAt:Number(t.updatedAt||t.updated_at||0),status:status==="unknown"?(turns?"done":"idle"):status,turns,tokens,activeTurnId,excerpt:String(t.preview||"")}); }
    for(const s of Array.isArray(o)?o:[]){const id=String(s.id||"");if(!id)continue;const project=typeof s.location==="string"?s.location:String(s.location?.directory||"");const tokens=Number(s.tokens?.input||0)+Number(s.tokens?.output||0)+Number(s.tokens?.reasoning||0)+Number(s.tokens?.cache?.read||0)+Number(s.tokens?.cache?.write||0);base.push({key:keyOf("opencode",id),id,backend:"opencode",title:String(s.title||"Untitled OpenCode session"),project,projectId:projects.find(p=>p.path===project)?.id,agent:String(s.agent||"OpenCode"),model:String(s.model?.modelID||s.model?.id||"default"),updatedAt:Number(s.time?.updated||s.time?.created||0),status:activeMap?.[id]?"running":tokens?"done":"idle",turns:0,tokens});}
    sessions=base.sort((a,b)=>b.updatedAt-a.updatedAt); rebuildProjects();
  }
  function rebuildProjects(){const keep=projectFilter.value;const paths=[...new Set(sessions.map(s=>s.project).filter(Boolean))].sort();projectFilter.replaceChildren(new Option("All projects",""),...paths.map(p=>new Option(p.split("/").filter(Boolean).at(-1)||p,p)));if(paths.includes(keep))projectFilter.value=keep;}
  async function refreshControl(){control=await json<ControlState>("/api/session-control/state").catch(()=>control);count.textContent=control.queue.length?String(control.queue.length):"";}
  async function refresh(){try{await Promise.all([inventory(),refreshControl()]);render();}catch(e){notify(e instanceof Error?e.message:"Refresh failed");}}

  function filtered(){const q=search.value.trim().toLowerCase();return sessions.filter(s=>{if(backendFilter.value&&s.backend!==backendFilter.value)return false;if(projectFilter.value&&s.project!==projectFilter.value)return false;if(statusFilter.value&&s.status!==statusFilter.value)return false;if(!q)return true;const hit=searchHits.get(s.key)||"";return (s.title+" "+s.project+" "+s.agent+" "+s.model+" "+(s.excerpt||"")+" "+hit).toLowerCase().includes(q);});}
  function button(text:string,fn:()=>void,cls=""){const b=document.createElement("button");b.type="button";b.textContent=text;if(cls)b.classList.add(cls);b.addEventListener("click",fn);return b;}
  function render(){count.textContent=control.queue.length?String(control.queue.length):"";if(activeTab==="queue")return renderQueue();if(activeTab==="checkpoints")return renderCheckpoints();if(activeTab==="history")return renderHistory();renderActivity();}
  function renderActivity(){body.replaceChildren();const list=document.createElement("div");list.className="sc-list";const items=filtered();if(!items.length)list.innerHTML='<div class="sc-empty">No matching sessions.</div>';for(const s of items)list.appendChild(card(s));body.appendChild(list);}
  function card(s:Session){const a=document.createElement("article");a.className="sc-card";a.dataset.status=s.status;const own=control.ownership[s.key];const queued=control.queue.filter(q=>q.sessionKey===s.key).length;const budget=control.budgets[s.key];const hit=searchHits.get(s.key);a.innerHTML='<div class="sc-card-head"><div class="sc-card-title"><strong></strong><small></small></div><span class="sc-state '+s.status+'">'+statusLabel(s.status)+'</span></div><div class="sc-facts"></div>';a.querySelector("strong")!.textContent=s.title;a.querySelector("small")!.textContent=label(s.backend)+" · "+s.agent+" · "+s.model;const facts=a.querySelector<HTMLElement>(".sc-facts")!;[own?"owner "+label(own.owner):"owner "+label(s.backend),s.project?(s.project.split("/").filter(Boolean).at(-1)||s.project):"no project",s.tokens?s.tokens.toLocaleString()+" tok":"",queued?queued+" queued":"",budget?(budget.stopReason||"budget set"):""].filter(Boolean).forEach(x=>{const n=document.createElement("span");n.textContent=String(x);facts.appendChild(n);});if(hit){const p=document.createElement("p");p.className="sc-excerpt";p.textContent=hit;a.appendChild(p);}const actions=document.createElement("div");actions.className="sc-actions";actions.append(button("Open",()=>openSession(s)),button("Queue",()=>void queuePrompt(s)),button("Handoff",()=>void transferPreview(s,"handoff")),button("More",()=>showMore(s)));if(["running","waiting"].includes(s.status))actions.append(button("Stop",()=>void stop(s),"danger"));a.appendChild(actions);return a;}
  function openSession(s:Session){localStorage.setItem("opencode-pocket-backend",s.backend);if(s.backend==="codex")localStorage.setItem("opencode-pocket-codex-thread",s.id);else localStorage.setItem("opencode-pocket-opencode-session",s.id);options.switchBackend?.(s.backend);close();location.reload();}
  async function stop(s:Session){try{if(s.backend==="codex"){let turn=s.activeTurnId;if(!turn){const p=await codex<Json>("thread/read",{threadId:s.id,includeTurns:true});turn=[...(p?.thread?.turns??[])].reverse().find((x:Json)=>["running","waiting"].includes(statusFrom(x?.status)))?.id;}if(!turn)throw new Error("No active Codex turn");await codex("turn/interrupt",{threadId:s.id,turnId:turn});}else await oc("/session/"+encodeURIComponent(s.id)+"/interrupt",{method:"POST"});notify("Run interrupted");await refresh();}catch(e){notify(e instanceof Error?e.message:"Stop failed");}}
  async function queuePrompt(s:Session){const text=prompt("Queue a follow-up for "+s.title)?.trim();if(!text)return;await json("/api/session-control/queue",{method:"POST",body:JSON.stringify({backend:s.backend,sessionId:s.id,text})});notify("Queued. It will dispatch after the active run becomes idle.");await refreshControl();render();}
  function showMore(s:Session){body.replaceChildren();const wrap=document.createElement("div");wrap.className="sc-detail";const h=document.createElement("h3");h.textContent=s.title;const grid=document.createElement("div");grid.className="sc-menu-grid";grid.append(button("Set budget",()=>void setBudget(s)),button("Checkpoint",()=>void createCheckpoint(s)),button("Fork thread",()=>void transferPreview(s,"fork")),button("Safe rewind",()=>void transferPreview(s,"rewind")),button("Side conversation",()=>void sideConversation(s)),button("Handoff",()=>void transferPreview(s,"handoff")));const back=button("‹ Activity",()=>{activeTab="activity";render();});wrap.append(back,h,grid);body.appendChild(wrap);}
  async function setBudget(s:Session){const turns=prompt("Maximum additional turns (blank = unlimited)",String(control.budgets[s.key]?.maxTurns??6));if(turns===null)return;const tokens=prompt("Maximum additional tokens (blank = unlimited)",String(control.budgets[s.key]?.maxTokens??20000));if(tokens===null)return;await json("/api/session-control/budget/"+s.backend+"/"+encodeURIComponent(s.id),{method:"PUT",body:JSON.stringify({maxTurns:turns.trim()?Number(turns):null,maxTokens:tokens.trim()?Number(tokens):null})});notify("Budget saved");await refreshControl();render();}
  async function createCheckpoint(s:Session){try{const ms=await messages(s);if(!ms.length)throw new Error("Nothing to checkpoint yet");await json("/api/session-control/checkpoints",{method:"POST",body:JSON.stringify({backend:s.backend,sessionId:s.id,title:s.title+" · "+new Date().toLocaleString(),project:s.project,projectId:s.projectId||null,sourcePoint:ms.length,messages:ms,files:filesFrom(ms)})});notify("Checkpoint created");await refreshControl();render();}catch(e){notify(e instanceof Error?e.message:"Checkpoint failed");}}

  async function createFromContext(source:Session,targetBackend:Backend,ms:Message[],mode:string,model="",point=ms.length,project?:{id?:string;path:string},agent=""):Promise<Session>{const payload=handoffText(source,ms,mode,"Source point: "+point);const path=project?.path||source.project;const projectId=project?.id||source.projectId;if(targetBackend==="codex"){const start=await codex<Json>("thread/start",{...(path?{cwd:path}:{}),...(model?{model}: {})});const id=String(start?.thread?.id||"");if(!id)throw new Error("Codex did not create a thread");await codex("turn/start",{threadId:id,input:[{type:"text",text:payload.text}],clientUserMessageId:uid(),...(model?{model}:{})});return{...source,key:keyOf("codex",id),id,backend:"codex",title:mode+": "+source.title,project:path,projectId,agent:agent||"Codex",model:model||source.model,updatedAt:Date.now(),status:"running",turns:1,tokens:0};}const body:Json={};if(agent)body.agent=agent;if(model.includes("/")){const [providerID,...rest]=model.split("/");const modelID=rest.join("/");if(providerID&&modelID)body.model={id:modelID,providerID};}const created=await oc<Json>("/session",{method:"POST",body:JSON.stringify(body)},projectId);const id=String(created?.id||"");if(!id)throw new Error("OpenCode did not create a session");await oc("/session/"+encodeURIComponent(id)+"/prompt",{method:"POST",body:JSON.stringify({text:payload.text})},projectId);return{...source,key:keyOf("opencode",id),id,backend:"opencode",title:String(created.title||mode+": "+source.title),project:path,projectId,agent:String(created.agent||agent||"OpenCode"),model:model||source.model,updatedAt:Date.now(),status:"running",turns:1,tokens:0};}
  async function inheritBudget(source:Session,target:Session){await json("/api/session-control/budget/inherit",{method:"POST",body:JSON.stringify({source:{backend:source.backend,sessionId:source.id},target:{backend:target.backend,sessionId:target.id}})}).catch(()=>({}));}
  async function event(sessionKey:string,type:string,detail:string,related?:string){await json("/api/session-control/events",{method:"POST",body:JSON.stringify({sessionKey,type,detail,relatedSessionKey:related||null})});}

  async function transferPreview(s:Session,mode:"handoff"|"fork"|"rewind"){try{const all=await messages(s);if(!all.length)throw new Error("No transferable context");let point=all.length;if(mode==="fork"||mode==="rewind"){const max=mode==="rewind"?Math.max(1,all.length-1):all.length;const raw=prompt((mode==="fork"?"Fork":"Rewind")+" after how many messages? (1-"+max+")",String(max));if(raw===null)return;point=Number(raw);if(!Number.isInteger(point)||point<1||point>max)throw new Error("That source point cannot be reconstructed safely");}const ms=all.slice(0,point);const targetBackend:Backend=mode==="handoff"?(s.backend==="codex"?"opencode":"codex"):s.backend;const payload=handoffText(s,ms,mode,mode==="rewind"?("Excluded "+(all.length-point)+" later messages"):"");body.replaceChildren();const wrap=document.createElement("div");wrap.className="sc-preview";const back=button("‹ Back",()=>showMore(s));const h=document.createElement("h3");h.textContent=mode==="handoff"?("Handoff to "+label(targetBackend)):mode==="fork"?"Fork session":"Safe rewind";const note=document.createElement("p");note.textContent=ms.length+" messages and "+payload.files.length+" detected file references will be copied into a new "+label(targetBackend)+" thread. The original remains unchanged.";const files=document.createElement("pre");files.textContent=payload.files.length?payload.files.join("\n"):"(no file references detected)";const preview=document.createElement("pre");preview.className="sc-transfer-text";preview.textContent=payload.text;const model=document.createElement("input");model.placeholder=targetBackend==="codex"?"Optional Codex model":"Optional OpenCode provider/model";const agent=document.createElement("input");agent.placeholder=targetBackend==="opencode"?"Optional OpenCode agent/mode":"Optional label";const consent=document.createElement("label");consent.className="sc-consent";const check=document.createElement("input");check.type="checkbox";const ct=document.createElement("span");ct.textContent=mode==="handoff"?("I approve sending exactly this preview to "+label(targetBackend)+"."):"I understand this creates a new thread and leaves the original unchanged.";consent.append(check,ct);const go=button(mode==="handoff"?"Confirm handoff":mode==="fork"?"Create fork":"Create rewind thread",()=>void execute());go.setAttribute("disabled","");check.addEventListener("change",()=>{go.toggleAttribute("disabled",!check.checked);});async function execute(){go.setAttribute("disabled","");try{const target=await createFromContext(s,targetBackend,ms,mode,model.value.trim(),point,undefined,agent.value.trim());if(mode==="handoff"){await json("/api/session-control/ownership",{method:"POST",body:JSON.stringify({backend:target.backend,sessionId:target.id,owner:target.backend,priorOwner:s.backend})});await event(s.key,"handoff",label(s.backend)+" → "+label(targetBackend)+"; source point "+point,target.key);}else await event(s.key,mode,(mode==="fork"?"Forked":"Safe rewind")+" at message "+point,target.key);await inheritBudget(s,target);notify((mode==="handoff"?"Handoff":"New thread")+" created");await refresh();}catch(e){notify(e instanceof Error?e.message:"Transfer failed");go.removeAttribute("disabled");}}wrap.append(back,h,note,files,preview,model,agent,consent,go);body.appendChild(wrap);}catch(e){notify(e instanceof