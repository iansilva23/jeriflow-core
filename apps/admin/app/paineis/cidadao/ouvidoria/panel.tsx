"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthFailure, cookieTransport, errorMessage } from "../../../../../../packages/auth/client";
import { protocolCategories, protocolMutationResult, protocolStatusLabels, readProtocolPage,
  type ProtocolRecord } from "../../../../../../packages/contracts/src/ouvidoria";

export default function ProtocolPanel({municipalityId,municipalityName}:{municipalityId:string;municipalityName:string}) {
  const [transport]=useState(cookieTransport),lock=useRef(false);
  const [items,setItems]=useState<ProtocolRecord[]>([]),[next,setNext]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [selected,setSelected]=useState<ProtocolRecord|null>(null),[operation,setOperation]=useState<"respond"|"triage"|"close"|null>(null);
  const [message,setMessage]=useState("");
  async function load(after?:string) {
    const page=readProtocolPage(await transport.request("/ouvidoria/query",
      {municipalityId,scope:"fila",...(after?{after}:{})}));
    setItems(old=>after?[...new Map([...old,...page.items].map(item=>[item.id,item])).values()]:page.items);
    setNext(page.next);
  }
  async function run(action:()=>Promise<void>) {
    if(lock.current)return; lock.current=true;setBusy(true);setError("");setNotice("");
    try{await action();}
    catch(e) {
      const uncertain=e instanceof AuthFailure&&e.code==="NETWORK";
      setError(uncertain?"Não foi possível confirmar a alteração. Atualize a fila antes de tentar novamente.":errorMessage(e));
    } finally{lock.current=false;setBusy(false);}
  }
  useEffect(()=>{void run(()=>load());},[municipalityId]);
  function choose(item:ProtocolRecord, action:"triage"|"respond"|"close") {
    setSelected(item);setOperation(action);setMessage("");setError("");setNotice("");
  }
  async function save(event:FormEvent) {
    event.preventDefault();
    if(!selected||!operation)return;
    const target=selected,action=operation;
    await run(async()=>{
      protocolMutationResult(await transport.request("/ouvidoria/mutate",{
        operation:action,municipalityId,protocolId:target.id,revision:target.revision,
        ...(action==="respond"?{message:message.trim()}:{})
      }));
      setSelected(null);setOperation(null);setMessage("");
      await load();setNotice("Alteração registrada e confirmada pelo servidor.");
    });
  }
  return <section className="ouvidoria">
    <div className="ouvidoria-header">
      <div><h2>{municipalityName}</h2><p>Fila de protocolos · Acesso restrito</p></div>
      <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{setSelected(null);setOperation(null);await load();})}>Atualizar fila</button>
    </div>
    {items.length===0&&!busy&&<p>Nenhum protocolo nesta página.</p>}
    <div className="ouvidoria-list">
      {items.map(item=><article key={item.id} className="ouvidoria-item">
        <div className="ouvidoria-item-head">
          <span>{protocolCategories[item.category]}</span><strong>{protocolStatusLabels[item.status]}</strong>
        </div>
        <h3>{item.title}</h3>
        <p className="ouvidoria-small">Protocolo {item.id.slice(0,8)} · Revisão {item.revision} · {new Date(item.createdAt).toLocaleDateString("pt-BR")}</p>
        <p>{item.description}</p>
        {item.response&&<p><strong>Última resposta:</strong> {item.response}</p>}
        {item.contestNote&&<p><strong>Contestação:</strong> {item.contestNote}</p>}
        <div className="ouvidoria-actions">
          {item.status==="open"&&<button type="button" disabled={busy} onClick={()=>choose(item,"triage")}>Assumir análise</button>}
          {["open","in_review","contested"].includes(item.status)&&<button type="button" disabled={busy} onClick={()=>choose(item,"respond")}>Responder</button>}
          {item.status==="responded"&&<button type="button" className="secondary" disabled={busy} onClick={()=>choose(item,"close")}>Encerrar protocolo</button>}
        </div>
        {selected?.id===item.id&&operation&&<form onSubmit={event=>void save(event)} className="ouvidoria-confirm">
          <h4>{operation==="triage"?"Assumir análise":operation==="respond"?"Responder cidadão":"Encerrar protocolo"}</h4>
          <p>Confira o protocolo e a revisão. Alterações de outra pessoa exigem atualização da fila.</p>
          {operation==="respond"&&<label>Resposta ao cidadão
            <textarea required minLength={15} maxLength={2000} value={message} onChange={e=>setMessage(e.target.value)}
              disabled={busy} rows={5} placeholder="Descreva a resposta sem incluir dados pessoais desnecessários."/>
          </label>}
          <div className="ouvidoria-actions">
            <button type="submit" disabled={busy||(operation==="respond"&&message.trim().length<15)}>
              {busy?"Salvando…":"Confirmar alteração"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={()=>{setSelected(null);setOperation(null);setMessage("");}}>Cancelar</button>
          </div>
        </form>}
      </article>)}
    </div>
    {next&&<button type="button" className="secondary" disabled={busy} onClick={()=>void run(()=>load(next))}>Carregar mais protocolos</button>}
    {!!error&&<p role="alert" className="error">{error}</p>}
    {!!notice&&<p role="status" className="notice">{notice}</p>}
  </section>;
}
