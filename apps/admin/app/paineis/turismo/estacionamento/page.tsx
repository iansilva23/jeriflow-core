import {authorizePanel} from "../../../../lib/session";
import ParkingPanel from "./panel";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{municipalityId?:string|string[]}>}){
 const query=await searchParams,municipalityId=typeof query.municipalityId==="string"?query.municipalityId:"";
 const {allowed,context}=await authorizePanel("admin:turismo:access",municipalityId||undefined);
 const city=allowed?context.municipalities.find(x=>x.id===municipalityId):undefined;
 return <main className="workspace">
  <a href={municipalityId?`/paineis/turismo?municipalityId=${encodeURIComponent(municipalityId)}`:"/"}>← Admin Turismo</a>
  <h1>Solicitações de estacionamento</h1>
  {allowed&&city&&<p><a className="primary-link" href={`/paineis/turismo/estacionamento/entradas?municipalityId=${encodeURIComponent(municipalityId)}`}>Cadastro experimental de entradas e saídas →</a></p>}
  {allowed&&city?<ParkingPanel municipalityId={municipalityId} municipalityName={city.displayName}/>:
   <p role="alert" className="denied">Acesso negado. Selecione município autorizado.</p>}
  <p className="dev-note">Ambiente de desenvolvimento. Não use dados reais ou considere esta fila um comprovante oficial.</p>
 </main>;
}
