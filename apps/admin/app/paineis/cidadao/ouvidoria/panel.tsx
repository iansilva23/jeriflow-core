"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthFailure, cookieTransport, errorMessage } from "../../../../../../packages/auth/client";
import AdminNotices from "./notices";
import { protocolCategories, protocolEventLabels, protocolMutationResult,
  protocolStatusLabels, readProtocolHistory, readProtocolPage, type ProtocolEvent,
  type ProtocolRecord } from "../../../../../../packages/contracts/src/ouvidoria";

type AttachmentMeta={id:string;fileName:string;mediaType:string;sizeBytes:number;status:string;createdAt:string};
export default function ProtocolPanel({municipalityId,municipalityName}:{municipalityId:string;municipalityName:string}) {
  const [transport]=useState(cookieTransport),lock=useRef(false);
  const [items,setItems]=useState<ProtocolRecord[]>([]),[next,setNext]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [selected,setSelected]=useState<ProtocolRecord|null>(null),[operation,setOperation]=useState<"respond"|"triage"|"close"|null>(null);
  const [message,setMessage]=useState("");
  const [attachments,setAttachments]=useState<{id:string;items:AttachmentMeta[]}|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const [history,setHistory]=useState<{id:string;items:ProtocolEvent[]}|null>(null);
  const [inventory,setInventory]=useState<{
    automaticDeletionEnabled:boolean;inventory:{category:string;status:string;protocolCount:number;archivedCount:number;protectedCount:number}[];
    policies:{category:string;retentionDays:number|null}[];
  }|null>(null);
  const [retentionCategory,setRetentionCategory]=useState("denuncia"),[retentionDays,setRetentionDays]=useState("");
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
  useEffect(()=>{setHistory(null);setAttachments(null);setFile(null);void run(()=>load());},[municipalityId]);
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
      setSelected(null);setOperation(null);setMessage("");setHistory(null);setAttachments(null);setFile(null);
      await load();setNotice("Alteração registrada e confirmada pelo servidor.");
    });
  }
  function toggleHistory(item:ProtocolRecord){
    if(history?.id===item.id){setHistory(null);return;}
    void run(async()=>{
      const result=readProtocolHistory(await transport.request("/ouvidoria/history",
        {municipalityId,protocolId:item.id}));
      setHistory({id:item.id,items:result.items});
    });
  }
  async function attachmentsFor(item:ProtocolRecord){
    if(attachments?.id===item.id){setAttachments(null);setFile(null);return;}
    await run(async()=>{
      const result=await transport.request("/ouvidoria/attachments/list",
        {municipalityId,protocolId:item.id});
      if(!Array.isArray(result.items)||result.items.length>5 ||
        result.items.some(v=>!v||typeof v.id!=="string"||typeof v.fileName!=="string"||
          v.status!=="quarantined"&&v.status!=="rejected"&&v.status!=="clean"))
        throw new AuthFailure("INVALID_RESPONSE");
      setAttachments({id:item.id,items:result.items as AttachmentMeta[]});setFile(null);
    });
  }
  async function upload(item:ProtocolRecord){
    if(!file)return;
    await run(async()=>{
      if(file.size<32||file.size>1048576||
        !["image/jpeg","image/png","application/pdf"].includes(file.type))
        throw new AuthFailure("INVALID_INPUT");
      const bytes=new Uint8Array(await file.arrayBuffer());
      // Converter blocos evita aplicar spread em um array gigante.
      let binary="";for(let n=0;n<bytes.length;n+=8192)
        binary+=String.fromCharCode(...bytes.subarray(n,n+8192));
      const requestId=crypto.randomUUID();
      const uploaded=await transport.request("/ouvidoria/attachments/upload",
        {municipalityId,protocolId:item.id,clientRequestId:requestId,
          fileName:file.name,mediaType:file.type,dataBase64:btoa(binary)});
      if(uploaded.status!=="quarantined")throw new AuthFailure("INVALID_RESPONSE");
      setFile(null);
      const listed=await transport.request("/ouvidoria/attachments/list",
        {municipalityId,protocolId:item.id});
      setAttachments({id:item.id,items:listed.items as AttachmentMeta[]});
      setNotice("Arquivo recebido em quarentena. A consulta fica bloqueada até verificação de segurança.");
    });
  }
  return <section className="ouvidoria">
    <AdminNotices municipalityId={municipalityId}/>
    <section className="ouvidoria-confirm" aria-label="Governança e retenção da Ouvidoria">
      <h3>Governança dos dados</h3>
      <p>Inventário por categoria, prazos somente para estudo e arquivamento reversível. Nenhum descarte automático está habilitado.</p>
      <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{
        const result=await transport.request("/ouvidoria/retention/inventory",{municipalityId});
        if(result.automaticDeletionEnabled!==false||!Array.isArray(result.inventory)||!Array.isArray(result.policies))
          throw new AuthFailure("INVALID_RESPONSE");
        setInventory(result as typeof inventory);setNotice("Inventário consultado e acesso auditado.");
      })}>Consultar inventário</button>
      {inventory&&<>
        <p>Registros por categoria e situação (sem textos sensíveis):</p>
        <ul>{inventory.inventory.map((v,i)=><li key={i}>{protocolCategories[v.category as keyof typeof protocolCategories]??v.category} · {v.status}: {v.protocolCount} registro(s), {v.protectedCount} protegido(s), {v.archivedCount} arquivado(s)</li>)}</ul>
        <p>Rascunhos de prazo: {inventory.policies.length===0?"Nenhum cadastrado":inventory.policies.map(p=>`${protocolCategories[p.category as keyof typeof protocolCategories]??p.category}: ${p.retentionDays??"indefinido"} dias`).join(" · ")}</p>
      </>}
      <div className="ouvidoria-actions">
        <label>Categoria da política provisória
          <select value={retentionCategory} onChange={e=>setRetentionCategory(e.target.value)} disabled={busy}>
            {Object.entries(protocolCategories).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Prazo em dias (em branco: indefinido)
          <input type="number" min={1} max={36500} step={1} value={retentionDays}
            onChange={e=>setRetentionDays(e.target.value)} disabled={busy}/>
        </label>
        <button type="button" disabled={busy||!!retentionDays&&(!Number.isInteger(Number(retentionDays))||Number(retentionDays)<1||Number(retentionDays)>36500)}
          onClick={()=>void run(async()=>{
            const result=await transport.request("/ouvidoria/retention/draft",{
              municipalityId,category:retentionCategory,retentionDays:retentionDays===""?null:Number(retentionDays)
            });
            if(result.automaticDeletionEnabled!==false)throw new AuthFailure("INVALID_RESPONSE");
            setInventory(null);setNotice("Rascunho registrado e auditado. Prazo NÃO aprovado e exclusão desativada.");
          })}>Salvar rascunho de prazo</button>
      </div>
    </section>
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
        {item.status==="closed"&&<div className="ouvidoria-actions">
          <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{
            const result=await transport.request("/ouvidoria/retention/archive",{
              municipalityId,protocolId:item.id,archived:true});
            if(result.archived!==true||result.legalHoldPreserved!==true)throw new AuthFailure("INVALID_RESPONSE");
            setNotice("Protocolo arquivado logicamente, com documentos preservados.");
          })}>Arquivar protocolo</button>
          <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{
            const result=await transport.request("/ouvidoria/retention/archive",{
              municipalityId,protocolId:item.id,archived:false});
            if(result.archived!==false||result.legalHoldPreserved!==true)throw new AuthFailure("INVALID_RESPONSE");
            setNotice("Arquivamento revertido, com trilha de auditoria preservada.");
          })}>Desarquivar protocolo</button>
        </div>}
        <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{
          const retention=await transport.request("/ouvidoria/retention/review",{municipalityId,protocolId:item.id});
          if(retention.automaticDeletion!==false||retention.protected!==true)throw new AuthFailure("INVALID_RESPONSE");
          setNotice("Retenção protegida: sem exclusão automática até aprovação institucional.");
        })}>Consultar proteção dos dados</button>
        <button type="button" className="secondary" disabled={busy}
          onClick={()=>toggleHistory(item)}>{history?.id===item.id?"Ocultar histórico":"Ver histórico"}</button>
        <button type="button" className="secondary" disabled={busy}
          onClick={()=>void attachmentsFor(item)}>
          {attachments?.id===item.id?"Ocultar anexos":"Ver anexos"}
        </button>
        {attachments?.id===item.id&&<section className="ouvidoria-confirm">
          <h4>Anexos protegidos (máximo 5)</h4>
          <p>Arquivos enviados ficam em quarentena. Não é possível visualizá-los ou baixá-los antes da verificação antivírus.</p>
          {attachments.items.map(a=><p key={a.id}>{a.fileName} · {Math.ceil(a.sizeBytes/1024)} KB ·
            {a.status==="quarantined"?" Em quarentena":a.status==="rejected"?" Rejeitado":" Verificado"}</p>)}
          {item.status!=="closed"&&attachments.items.length<5&&<>
            <label>Enviar evidência (JPEG, PNG ou PDF, até 1 MB)
              <input type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)}/>
            </label>
            <button type="button" disabled={!file||busy} onClick={()=>void upload(item)}>Enviar para quarentena</button>
          </>}
        </section>}
        {history?.id===item.id&&<ol className="ouvidoria-history" aria-label="Histórico do protocolo">
          {history.items.map(ev=><li key={ev.revision}>
            <strong>{protocolEventLabels[ev.code]}</strong> · {new Date(ev.createdAt).toLocaleString("pt-BR")}
          </li>)}
        </ol>}
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
