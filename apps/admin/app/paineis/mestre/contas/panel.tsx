"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthFailure, cookieTransport, errorMessage } from "../../../../../../packages/auth/client";
import { rolePermissions } from "../../../../../../packages/contracts/src/access";

type Municipality = { id: string; displayName: string; slug: string; active: boolean };
type Account = { id: string; email: string; displayName: string; active: boolean; pending: boolean; revision: number; memberships: { municipalityId: string; role: string; active: boolean }[] };
type Operation = "create-municipality" | "invite" | "set-membership" | "set-active";
const labels: Record<string,string> = { cidadao:"Cidadão", turista:"Turista", guarda:"Guarda/SEMUS", "fiscal-tts":"Fiscal TTS", "admin-turismo":"Admin Turismo/Estacionamento", "admin-cidadao":"Admin Cidadão/Ouvidoria", "admin-semus":"Admin SEMUS", "admin-conteudo":"Admin Conteúdo", "admin-dashboard":"Admin Dashboard", "admin-studio":"JeriFlow Studio", "admin-tts":"TTS dentro do Admin Turismo" };
export default function AccountsPanel() {
  const [transport] = useState(cookieTransport), working = useRef(false);
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [notice,setNotice] = useState("");
  const [cities,setCities] = useState<Municipality[]>([]), [accounts,setAccounts] = useState<Account[]>([]);
  const [nextCity,setNextCity] = useState<string|null>(null), [nextAccount,setNextAccount] = useState<string|null>(null);
  const [operation,setOperation] = useState<Operation>("create-municipality");
  const [municipalityId,setMunicipalityId] = useState(""), [userId,setUserId] = useState("");
  const [email,setEmail] = useState(""), [name,setName] = useState(""), [slug,setSlug] = useState("");
  const [roles,setRoles] = useState<string[]>([]), [password,setPassword] = useState(""), [code,setCode] = useState("");
  const [confirmed,setConfirmed] = useState(false);
  const selected = accounts.find(a=>a.id===userId);
  useEffect(()=>{
    setRoles(operation==="set-membership" ? selected?.memberships.filter(m=>m.municipalityId===municipalityId && m.active).map(m=>m.role) ?? [] : []);
    setPassword(""); setCode(""); setConfirmed(false);
  },[operation,municipalityId,selected]);
  async function read(kind: "municipalities"|"accounts", after?: string|null) {
    const value = await transport.request("/management/query",{kind,...(after ? {after} : {})});
    if (!Array.isArray(value.items) || value.items.some(x=>!x || typeof x.id!=="string" || typeof x.displayName!=="string" || typeof x.active!=="boolean"
      || (kind==="accounts" && (typeof x.email!=="string" || !Number.isSafeInteger(x.revision) || !Array.isArray(x.memberships))))
      || !(value.next===null || typeof value.next==="string")) throw new AuthFailure("INVALID_RESPONSE");
    if(kind==="municipalities") { setCities(old=>after ? [...old,...value.items as Municipality[]] : value.items as Municipality[]); setNextCity(value.next); }
    else { setAccounts(old=>after ? [...old,...value.items as Account[]] : value.items as Account[]); setNextAccount(value.next); }
  }
  async function run(action:()=>Promise<void>) {
    if(working.current) return;
    working.current=true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch(e) {
      if(e instanceof AuthFailure && ["UNAUTHORIZED","REAUTHENTICATION_REQUIRED","FORBIDDEN"].includes(e.code)) { setAccounts([]); setCities([]); setUserId(""); }
      setError(errorMessage(e));
    } finally { working.current=false; setBusy(false); setPassword(""); setCode(""); setConfirmed(false); }
  }
  useEffect(()=>{ void run(async()=>{ await read("municipalities"); await read("accounts"); }); },[]);
  async function save(event: FormEvent) {
    event.preventDefault(); if(!confirmed) return;
    await run(async()=>{
      const data = operation==="create-municipality" ? {slug,displayName:name}
        : operation==="invite" ? {email,municipalityId,roles}
        : operation==="set-membership" ? {userId,municipalityId,roles,revision:selected?.revision}
        : {userId,revision:selected?.revision,active:!selected?.active};
      await transport.request("/management/mutate",{operation,...data,password,code:code.trim()});
      // Nunca repetir uma escrita após falha de rede. Reler estado e revisão antes de nova confirmação.
      setNotice("Alteração confirmada pelo servidor. As sessões antigas da conta alterada foram encerradas. Convites de contas pendentes seguem para a caixa local.");
      setUserId(""); setEmail(""); setName(""); setSlug("");
      await read("municipalities"); await read("accounts");
    });
  }
  const actionNeedsAccount = operation==="set-membership" || operation==="set-active";
  const needsCity = operation==="invite" || operation==="set-membership";
  return <section aria-busy={busy} className="management">
    <p>O Mestre pode convidar contas, definir perfis por município e bloquear ou reativar acessos. Criar outro Mestre não é permitido por esta tela.</p>
    <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{setUserId("");await read("municipalities");await read("accounts");})}>Atualizar listas</button>
    <p className="hint">{cities.length} municípios e {accounts.length} contas carregados. Contas Mestre não aparecem na lista.</p>
    {nextCity && <button type="button" className="secondary" disabled={busy} onClick={()=>void run(()=>read("municipalities",nextCity))}>Carregar mais municípios</button>}
    {nextAccount && <button type="button" className="secondary" disabled={busy} onClick={()=>void run(()=>read("accounts",nextAccount))}>Carregar mais contas</button>}
    <form onSubmit={save}><fieldset disabled={busy}>
      <label>Operação<select value={operation} onChange={e=>setOperation(e.target.value as Operation)}>
        <option value="create-municipality">Cadastrar município</option><option value="invite">Convidar nova conta</option>
        <option value="set-membership">Revisar perfis de uma conta</option><option value="set-active">Bloquear ou reativar conta</option>
      </select></label>
      {operation==="create-municipality" && <><label>Nome do município<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label>Identificador do município<input required pattern="[a-z0-9][a-z0-9-]{0,61}[a-z0-9]" minLength={2} maxLength={63} placeholder="exemplo-municipio" value={slug} onChange={e=>setSlug(e.target.value)} autoCapitalize="none" spellCheck={false}/></label></>}
      {operation==="invite" && <label>Email do destinatário<input required type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>}
      {actionNeedsAccount && <label>Conta<select required value={userId} onChange={e=>setUserId(e.target.value)}><option value="">Selecione uma conta</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.email} — {a.pending ? "ativação pendente" : a.displayName}{!a.active ? " (bloqueada)" : ""}</option>)}</select></label>}
      {needsCity && <label>Município<select required value={municipalityId} onChange={e=>setMunicipalityId(e.target.value)}><option value="">Selecione um município</option>{cities.filter(m=>m.active).map(m=><option key={m.id} value={m.id}>{m.displayName} ({m.slug})</option>)}</select></label>}
      {needsCity && <fieldset><legend>Perfis autorizados neste município</legend>{Object.keys(rolePermissions).map(role=><label key={role} className="check"><input type="checkbox" checked={roles.includes(role)} onChange={e=>setRoles(old=>e.target.checked ? [...old,role] : old.filter(r=>r!==role))}/>{labels[role]}</label>)}
        <p className="hint">Ao revisar, a seleção substitui todos os perfis neste município. Nenhum selecionado remove os acessos locais; outros municípios são preservados. TTS não concede automaticamente acesso a outras áreas de Turismo.</p></fieldset>}
      {selected && actionNeedsAccount && <p>Conta: {selected.email}. Revisão: {selected.revision}. {operation==="set-active" ? selected.active ? "Esta operação bloqueará a conta em todos os municípios." : "Esta operação reativará a conta com os vínculos preservados." : selected.pending ? "Salvar também envia um novo código de ativação e invalida o anterior." : "As sessões antigas serão encerradas para aplicar os novos perfis."}</p>}
      <label>Sua senha Mestre<input required type="password" minLength={15} maxLength={128} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label>Código atual do autenticador ou recuperação<input required maxLength={32} autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} spellCheck={false}/></label>
      <label className="check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Conferi a conta, o município e os perfis. Confirmo esta alteração.</label>
      <button type="submit" disabled={busy || !confirmed || (actionNeedsAccount && !selected) || (needsCity && !municipalityId) || (operation==="invite" && !roles.length)}>{busy ? "Aguarde…" : "Confirmar alteração"}</button>
    </fieldset></form>
    {notice && <p role="status" className="notice">{notice}</p>}{error && <p role="alert" className="error">{error} Se houve falha de conexão ao salvar, atualize as listas e confira o resultado antes de repetir a operação.</p>}
    <p><a href="/entrar">Voltar à conta ou entrar novamente</a></p>
  </section>;
}
