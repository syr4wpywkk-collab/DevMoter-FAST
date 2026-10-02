    const $ = selector => document.querySelector(selector);
    const providerRoot = $("#providers"), localLogin = $("#localLogin"), username = $("#username"), password = $("#password");
    const recovery = $("#recovery"), device = $("#device"), userCode = $("#userCode"), verifyLink = $("#verifyLink"), copyCode = $("#copyCode"), message = $("#message");
    let authStatus = null, activeFlow = "", pollTimer = 0;
    const icons = {
      passkey:'<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v10H5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15" r="1.2" fill="currentColor"/></svg>',
      github:'<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.53v-2.07c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 .1.74 2.1 3.2 1.54.1-.72.39-1.2.7-1.48-2.47-.28-5.07-1.24-5.07-5.5 0-1.21.43-2.2 1.15-2.98-.12-.28-.5-1.42.11-2.95 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.1-1.43 3.04-1.14 3.04-1.14.61 1.53.23 2.67.12 2.95.71.78 1.14 1.77 1.14 2.98 0 4.27-2.61 5.21-5.1 5.49.4.34.75 1.02.75 2.05V22c0 .29.2.64.77.53A11.1 11.1 0 0 0 12 .9Z"/></svg>',
      google:'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.52h3.24c1.9-1.75 2.98-4.32 2.98-7.37Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.4l-3.24-2.52c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.75-5.6-4.1H3.05v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.94a6 6 0 0 1 0-3.88v-2.6H3.05a10 10 0 0 0 0 9.08l3.35-2.6Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.78.5 3.82 1.5l2.86-2.86C16.95 2.97 14.7 2 12 2a10 10 0 0 0-8.95 5.46l3.35 2.6c.8-2.35 3-4.1 5.6-4.1Z"/></svg>',
      microsoft:'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#f25022" d="M2 2h9.5v9.5H2z"/><path fill="#7fba00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00a4ef" d="M2 12.5h9.5V22H2z"/><path fill="#ffb900" d="M12.5 12.5H22V22h-9.5z"/></svg>'
    };
    function setMessage(text, tone="") { message.textContent=text||""; message.className="message"+(tone?" "+tone:""); }
    function humanError(error, provider="") {
      const status=Number(error?.status||0), raw=String(error?.message||"").toLowerCase();
      if(status===401) return "Those sign-in details weren’t accepted. Try again.";
      if(status===403 && provider) return provider+" isn’t linked to this DevMoter owner yet. Sign in with recovery or a connected method first.";
      if(status===404 || raw.includes("not configured") || raw.includes("unavailable")) return provider ? provider+" sign-in is not available on this host." : "That sign-in method is not available on this host.";
      if(raw.includes("cancel")) return "Sign-in was cancelled. You can try again.";
      return "We couldn’t sign you in. Please try again.";
    }
    async function json(path, init={}) {
      const headers=new Headers(init.headers||{}); if(init.body&&!headers.has("content-type")) headers.set("content-type","application/json");
      const response=await fetch(path,{...init,headers,cache:"no-store"}); const payload=await response.json().catch(()=>({}));
      if(!response.ok) { const error=new Error(payload?.error||"Request failed"); error.status=response.status; throw error; } return payload;
    }
    function providerInfo(name) {
      const direct=authStatus?.providers?.[name] || authStatus?.[name] || {};
      if(name==="github") return {configured:Boolean(direct.configured),linked:Boolean(direct.linked??direct.bound),available:Boolean(direct.available??direct.configured)};
      return {configured:Boolean(direct.configured ?? (name==="passkey" && direct.enabled)),linked:Boolean(direct.linked??direct.bound??direct.enabled),available:Boolean(direct.available ?? direct.enabled ?? direct.configured)};
    }
    function makeButton(name,label,primary=false) {
      const button=document.createElement("button"); button.type="button"; button.className="provider"+(primary?" primary":""); button.dataset.provider=name;
      button.setAttribute("aria-label",label); button.innerHTML=icons[name]+"<span>"+label+"</span>"; button.addEventListener("click",()=>startProvider(name,button)); return button;
    }
    async function loadStatus() {
      authStatus=await json("/api/auth/status");
      if(authStatus.authenticated&&!authStatus.stepUpRequired) { location.replace("/"); return; }
      const passkey=providerInfo("passkey"), github=providerInfo("github"), google=providerInfo("google"), microsoft=providerInfo("microsoft");
      const methods=[];
      if(passkey.available) methods.push(["passkey",authStatus.stepUpRequired?"Verify with Passkey":"Continue with a passkey",true]);
      if(!authStatus.stepUpRequired) {
        if(github.configured) methods.push(["github","Continue with GitHub",!methods.length]);
        if(google.configured) methods.push(["google","Continue with Google",!methods.length]);
        if(microsoft.configured) methods.push(["microsoft","Continue with Microsoft",!methods.length]);
      }
      providerRoot.replaceChildren(...methods.map(item=>makeButton(...item)));
      providerRoot.hidden=methods.length===0;
      recovery.hidden=Boolean(authStatus.stepUpRequired);
      if(authStatus.stepUpRequired) setMessage("This host requires an additional Passkey check.");
      else if(!methods.length) { providerRoot.hidden=true; setMessage("Use local recovery to sign in and set up a sign-in method."); recovery.querySelector("summary").textContent="Set up a sign-in method with local recovery"; }
      const params=new URLSearchParams(location.search);
      const errors={google:"Google sign-in could not be completed.",microsoft:"Microsoft sign-in could not be completed.",account_not_linked:"That account is not connected to this DevMoter owner.",expired:"That sign-in link expired. Please try again.",access_denied:"Sign-in was cancelled.",oauth_error:"Sign-in could not be completed. Please try again.",state:"That sign-in attempt expired. Please try again.",link_conflict:"That account is already connected to another owner."};
      if(errors[params.get("auth_error")]) setMessage(errors[params.get("auth_error")],"error");
    }
    async function signInLocal() {
      localLogin.disabled=true; setMessage("Checking your recovery details…");
      try { await json("/api/auth/local/login",{method:"POST",body:JSON.stringify({username:username.value,password:password.value})}); password.value=""; await loadStatus(); }
      catch(error) { setMessage(humanError(error),"error"); }
      finally { localLogin.disabled=false; }
    }
    function decodeBase64url(value) { const normalized=String(value||"").replace(/-/g,"+").replace(/_/g,"/"); const raw=atob(normalized+"=".repeat((4-normalized.length%4)%4)); return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
    function encodeBase64url(value) { const bytes=new Uint8Array(value); let raw=""; bytes.forEach(byte=>raw+=String.fromCharCode(byte)); return btoa(raw).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
    function credentialJSON(credential) {
      const response={clientDataJSON:encodeBase64url(credential.response.clientDataJSON), authenticatorData:encodeBase64url(credential.response.authenticatorData), signature:encodeBase64url(credential.response.signature), userHandle:credential.response.userHandle?encodeBase64url(credential.response.userHandle):null};
      return {id:credential.id,rawId:encodeBase64url(credential.rawId),type:credential.type,authenticatorAttachment:credential.authenticatorAttachment,response,clientExtensionResults:credential.getClientExtensionResults?.()||{}};
    }
    async function startPasskey(button) {
      if(!window.PublicKeyCredential || !navigator.credentials) throw new Error("Passkeys aren’t supported in this browser.");
      const options=await json("/api/auth/passkey/login/options",{method:"POST",body:"{}"});
      const publicKey=options.publicKey||options; publicKey.challenge=decodeBase64url(publicKey.challenge);
      if(publicKey.allowCredentials) publicKey.allowCredentials=publicKey.allowCredentials.map(item=>({...item,id:decodeBase64url(item.id)}));
      const credential=await navigator.credentials.get({publicKey});
      if(!credential) throw new Error("Sign-in was cancelled.");
      await json("/api/auth/passkey/login/verify",{method:"POST",body:JSON.stringify({challengeId:options.challengeId,response:credentialJSON(credential)})});
      setMessage("Signed in. Redirecting…","ok"); location.replace("/");
    }
    async function startOAuth(provider) {
      if(!providerInfo(provider).linked) { recovery.open=true; setMessage("Sign in with local recovery, then connect this method in Account settings."); return; }
      const result=await json("/api/auth/"+provider+"/start",{method:"POST",body:"{}"});
      const target=result.authorizationUrl||result.url;
      if(!target) throw new Error("Provider unavailable");
      const destination=new URL(target,location.href); if(destination.protocol!=="https:"&&destination.hostname!=="localhost"&&destination.hostname!=="127.0.0.1") throw new Error("Provider unavailable");
      location.assign(destination.href);
    }
    async function startGithub(button) {
      const info=providerInfo("github");
      if(!info.linked&&!authStatus.authenticated) { recovery.open=true; setMessage("Use local recovery first to connect the first GitHub account."); return; }
      const flow=await json("/api/auth/github/start",{method:"POST",body:"{}"}); activeFlow=flow.flowId;
      userCode.textContent=flow.userCode; verifyLink.href=flow.verificationUri; device.hidden=false;
      setMessage("Approve the code on GitHub. This page will finish automatically."); schedulePoll(Math.max(1000,Number(flow.interval||5)*1000));
    }
    async function startProvider(name,button) {
      button.disabled=true; setMessage("Connecting securely…");
      try { if(name==="passkey") await startPasskey(button); else if(name==="github") await startGithub(button); else await startOAuth(name); }
      catch(error) { setMessage(error?.name==="NotAllowedError"?"Sign-in was cancelled or timed out.":humanError(error,name),"error"); }
      finally { button.disabled=false; }
    }
    function schedulePoll(delay) { clearTimeout(pollTimer); pollTimer=setTimeout(pollGithub,delay); }
    async function pollGithub() {
      if(!activeFlow) return;
      try { const result=await json("/api/auth/github/poll",{method:"POST",body:JSON.stringify({flowId:activeFlow})});
        if(result.status==="complete") { activeFlow=""; device.hidden=true; await loadStatus(); return; }
        schedulePoll(Math.max(1000,Number(result.retryAfterMs||5000)));
      } catch(error) { activeFlow=""; setMessage(humanError(error,"GitHub"),"error"); }
    }
    copyCode.addEventListener("click",async()=>{ try { await navigator.clipboard.writeText(userCode.textContent||""); copyCode.textContent="Copied"; setTimeout(()=>copyCode.textContent="Copy code",1400); } catch { setMessage("Select and copy the code above."); } });
    localLogin.addEventListener("click",signInLocal); password.addEventListener("keydown",event=>{if(event.key==="Enter")signInLocal();});
    loadStatus().catch(()=>setMessage("Sign-in options couldn’t be loaded. Refresh and try again.","error"));
