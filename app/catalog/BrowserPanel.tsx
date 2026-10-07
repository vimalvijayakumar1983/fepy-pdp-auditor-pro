"use client";
import { useEffect, useRef, useState } from "react";
export type BrowserSession = {id:string;status:string;liveUrl:string|null;timeoutAt:string|null;countryCode:string;locationVerification:string};
type Capabilities = {activeSessions?: Pick<BrowserSession,"id"|"status"|"timeoutAt"|"countryCode">[]; configured:boolean; auditAccessApproved:boolean; sessionMinutes:number};
export default function BrowserPanel({session,onSession,running}: {session:BrowserSession|null;onSession:(session:BrowserSession|null,approved:boolean)=>void;running:boolean}) {
  const [capabilities,setCapabilities] = useState<Capabilities|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [control,setControl] = useState(true);
  const frameArea = useRef<HTMLDivElement>(null);
  const watching = running || !control;
  useEffect(()=>{frameArea.current?.toggleAttribute("inert",watching);},[watching,session?.liveUrl]);
  useEffect(()=>{
    const abort = new AbortController();
    fetch("/api/catalog-browser",{signal:abort.signal}).then(async response=>{
      const data=await response.json();
      if (!response.ok) throw new Error(data.error || data.detail || "Browser availability could not be checked.");
      setCapabilities(data);
    }).catch(err=>{if(!abort.signal.aborted)setError(err.message);});
    return ()=>abort.abort();
  },[]);
  useEffect(()=>{
    if (!session || session.status!=="active") return;
    const abort = new AbortController();
    const timer=setInterval(async()=>{
      try {
        const response=await fetch(`/api/catalog-browser/${session.id}`,{signal:abort.signal});
        const data=await response.json();
        if (!response.ok) throw new Error(data.error || data.detail || "Could not refresh browser status.");
        onSession(data,!!capabilities?.auditAccessApproved);setError("");
      } catch(err){if(!abort.signal.aborted)setError(err instanceof Error?err.message:"Browser refresh failed.");}
    },15000);
    return ()=>{clearInterval(timer);abort.abort();};
  },[session?.id,session?.status,capabilities?.auditAccessApproved,onSession]);
  async function resumeSession(id:string) {
    setBusy(true);setError("");
    try{
      const response=await fetch(`/api/catalog-browser/${id}`);
      const data=await response.json();
      if(!response.ok)throw new Error(data.error || data.detail || "Browser could not be resumed.");
      onSession(data,!!capabilities?.auditAccessApproved);
    }catch(err){setError(err instanceof Error?err.message:"Browser resume failed.");}
    finally{setBusy(false);}
  }
  async function changeSession(method:"POST"|"DELETE") {
    setBusy(true);setError("");
    try {
      const response=await fetch(method==="POST"?"/api/catalog-browser":`/api/catalog-browser/${session?.id}`,{method});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error || data.detail || "Browser request failed.");
      onSession(method==="DELETE"?null:data,!!capabilities?.auditAccessApproved);
    }catch(err){setError(err instanceof Error?err.message:"Browser request failed.");}
    finally{setBusy(false);}
  }
  const active=session?.status==="active";
  return <section className="mb-5 rounded border border-stone-300 bg-stone-50 p-4" aria-label="Live UAE browser">
    <h2 className="font-semibold">Live browser · UAE route</h2>
    <p className="mt-1 text-sm">Watch and control a Browser Use Cloud session here. Sessions start on a blank page and expire after 30 minutes. Browser Use charges apply.</p>
    {capabilities && !capabilities.configured && <p className="mt-3 text-sm text-amber-900">Setup needed: add BROWSER_USE_API_KEY to the Railway worker. Create the key in your Browser Use dashboard and save it as a private service variable.</p>}
    <div className="my-3 flex flex-wrap items-center gap-3">
      <button type="button" disabled={!capabilities?.configured || busy || running || !!active} onClick={()=>changeSession("POST")} className="rounded bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-50">{busy?"Working…":"Start UAE browser"}</button>
      {!session && capabilities?.activeSessions?.map((saved,index)=><button key={saved.id} type="button" disabled={busy || running} onClick={()=>resumeSession(saved.id)} className="rounded border px-4 py-2 text-sm disabled:opacity-50">Resume existing browser {index+1}</button>)}
      {session && <button type="button" disabled={busy || running} onClick={()=>changeSession("DELETE")} className="rounded border px-4 py-2 text-sm disabled:opacity-50">Stop browser</button>}
      {active && <label className="text-sm"><input type="checkbox" checked={control && !running} disabled={running} onChange={e=>setControl(e.target.checked)} /> Allow manual control</label>}
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-red-800">{error}</p>}
    {session && <p className="mb-3 text-xs">Status: {session.status}. {session.locationVerification}. {session.timeoutAt && `Expires: ${new Date(session.timeoutAt).toLocaleTimeString()}.`} {watching?"Watch mode.":"Manual control enabled."}</p>}
    {active && session.liveUrl && <div ref={frameArea} className={watching?"pointer-events-none":""}><iframe src={session.liveUrl} title="Interactive Browser Use UAE session" referrerPolicy="no-referrer" tabIndex={watching?-1:0} className="h-[650px] w-full rounded border bg-white" allow="clipboard-read; clipboard-write" /></div>}
    {capabilities && !capabilities.auditAccessApproved && <p className="mt-3 text-sm text-amber-900">Automated FEPY audits in this session require the site administrator to permit the auditor. The previous browser received a security checkpoint. After permission is confirmed, set FEPY_AUDITOR_ACCESS_APPROVED=true on Railway.</p>}
    {!active && <p className="mt-3 text-xs text-stone-600">Without an active live session, the audit uses the Railway background browser. Start this session to use the UAE route.</p>}
    {running && active && <p className="mt-3 text-sm">The auditor controls this browser while the audit runs. You can watch the pages being checked.</p>}
  </section>;
}
