import {authorizePanel} from "../../../../../lib/session";
import EntriesPanel from "./panel";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{municipalityId?:string|string[]}>}){
 const query=await searchParams;
 const municipalityId=typeof query.municipalityId==="string"?query.municipalityId:"";
 const {allowed,context}=await authorizePanel("admin:turismo:access",municipalityId||undefined);
 const city=allowed?context.municipalities.find(m=>m.id===municipalityId):undefined;
 return <main className="workspace">
  <a href={municipalityId?
   `/paineis/turismo/estacionamento?municipalityId=${encodeURIComponent(municipalityId)}`:
   "/"}>← Solicitações de estacionamento</a>
  <h1>Registro operacional de veículos — desenvolvimento</h1>
  <p className="dev-note">Ambiente de desenvolvimento: utilize SOMENTE dados fictícios.
   Este cadastro não autoriza estacionamento, não processa pagamento, não emite voucher
   nem atesta quitação de diária ou TTS.</p>
  {allowed&&city?<EntriesPanel municipalityId={municipalityId} municipalityName={city.displayName}/>:
   <p role="alert" className="denied">Acesso negado ao município selecionado.</p>}
 </main>;
}
