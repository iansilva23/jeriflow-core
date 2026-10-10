import {authorizePanel} from "../../../../lib/session";
import OccurrencePanel from "./panel";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{municipalityId?:string|string[]}>}){
 const q=await searchParams,municipalityId=typeof q.municipalityId==="string"?q.municipalityId:"";
 const {allowed,context}=await authorizePanel("admin:semus:access",municipalityId||undefined);
 const city=allowed?context.municipalities.find(x=>x.id===municipalityId):undefined;
 return <main className="workspace"><a href={municipalityId?`/paineis/semus?municipalityId=${encodeURIComponent(municipalityId)}`:"/"}>← Admin SEMUS</a>
  <h1>Guarda · Ocorrências</h1>
  {allowed&&city?<OccurrencePanel municipalityId={municipalityId} name={city.displayName}/>:
   <p role="alert" className="denied">Acesso negado. Selecione município autorizado à administração SEMUS.</p>}
  <p className="dev-note">Desenvolvimento. Use somente registros fictícios, sem dados pessoais reais.</p>
 </main>;
}
