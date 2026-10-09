import {notFound} from "next/navigation";
import {authorizePanel} from "../../../../lib/session";
import {cookieToken,upstream} from "../../../../lib/gateway";
export const dynamic="force-dynamic";
type Occurrence={id:string;category:string;locationText:string;description:string;status:string;revision:number};
export default async function Page({searchParams}:{searchParams:Promise<{municipalityId?:string|string[]}>}){
 const p=await searchParams;
 const municipalityId=typeof p.municipalityId==="string"?p.municipalityId:"";
 if(!/^[0-9a-f-]{36}$/.test(municipalityId))notFound();
 const {allowed,config,cookie}=await authorizePanel("admin:semus:access",municipalityId);
 if(!allowed)return <main className="workspace"><p role="alert">Acesso negado.</p></main>;
 const raw=await upstream(config,"/guarda/query",cookieToken(cookie),
  JSON.stringify({municipalityId}),"POST");
 const items=raw.status===200&&Array.isArray(raw.data.items)?raw.data.items as Occurrence[]:[];
 return <main className="workspace">
  <a href={`/paineis/semus?municipalityId=${encodeURIComponent(municipalityId)}`}>← SEMUS</a>
  <h1>Ocorrências da Guarda</h1>
  <p>Registros por município, atualização ao recarregar a página.</p>
  {raw.status!==200&&<p role="alert">Não foi possível consultar as ocorrências.</p>}
  {raw.status===200&&items.length===0&&<p>Nenhuma ocorrência registrada.</p>}
  {items.map(v=><article key={v.id}>
   <h2>{v.category} · {v.status}</h2><p>{v.locationText} — {v.description}</p>
   <small>Revisão {v.revision} · {v.id.slice(0,8)}</small>
  </article>)}
  <p className="dev-note">Ambiente de desenvolvimento. Não use dados reais.</p>
 </main>;
}
