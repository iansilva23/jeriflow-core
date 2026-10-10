import {authorizePanel} from "../../../../../../lib/session";
import SandboxPanel from "./panel";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{municipalityId?:string|string[]}>}){
 const q=await searchParams,municipalityId=typeof q.municipalityId==="string"?q.municipalityId:"";
 const {allowed,context}=await authorizePanel("admin:turismo:access",municipalityId||undefined);
 const city=allowed?context.municipalities.find(m=>m.id===municipalityId):undefined;
 return <main className="workspace">
  <a href={municipalityId?`/paineis/turismo/estacionamento/tarifa?municipalityId=${encodeURIComponent(municipalityId)}`:"/"}>
   ← Estudo de tarifas</a>
  <h1>Laboratório de conciliação financeira</h1>
  <p className="dev-note">Somente amostras artificiais em memória. Esta tela NÃO consulta provedores,
   NÃO guarda eventos, NÃO aceita comprovantes reais e NÃO confirma ou estorna pagamentos.</p>
  {allowed&&city?<SandboxPanel municipalityName={city.displayName}/>:
   <p role="alert" className="denied">Acesso negado ao município selecionado.</p>}
 </main>;
}
