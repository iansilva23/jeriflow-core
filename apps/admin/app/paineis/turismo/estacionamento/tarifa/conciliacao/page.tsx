import {authorizePanel} from "../../../../../../lib/session";
import SandboxPanel from "./panel";
import LabAuditPanel from "./audit-panel";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{municipalityId?:string|string[]}>}){
 const q=await searchParams,municipalityId=typeof q.municipalityId==="string"?q.municipalityId:"";
 const {allowed,context}=await authorizePanel("admin:turismo:access",municipalityId||undefined);
 const city=allowed?context.municipalities.find(m=>m.id===municipalityId):undefined;
 return <main className="workspace">
  <a href={municipalityId?`/paineis/turismo/estacionamento/tarifa?municipalityId=${encodeURIComponent(municipalityId)}`:"/"}>
   ← Estudo de tarifas</a>
  <h1>Laboratório de conciliação financeira</h1>
  <p className="dev-note">Somente amostras artificiais. Os cenários visuais rodam em memória;
   a trilha opcional registra exemplos de teste no PostgreSQL de desenvolvimento.
   A tela NÃO consulta provedores, NÃO aceita comprovantes reais e NÃO confirma ou estorna pagamentos.</p>
  {allowed&&city?<><SandboxPanel municipalityName={city.displayName}/>
   <LabAuditPanel municipalityId={municipalityId}/></>:
   <p role="alert" className="denied">Acesso negado ao município selecionado.</p>}
 </main>;
}
