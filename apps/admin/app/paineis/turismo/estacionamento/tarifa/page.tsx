import {authorizePanel} from "../../../../../lib/session";
import TariffDraftPanel from "./panel";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{municipalityId?:string|string[]}>}){
 const query=await searchParams;
 const municipalityId=typeof query.municipalityId==="string"?query.municipalityId:"";
 const {allowed,context}=await authorizePanel("admin:turismo:access",municipalityId||undefined);
 const city=allowed?context.municipalities.find(m=>m.id===municipalityId):undefined;
 return <main className="workspace">
  <a href={municipalityId?
   `/paineis/turismo/estacionamento/entradas?municipalityId=${encodeURIComponent(municipalityId)}`:
   "/"}>← Entradas e saídas</a>
  <h1>Estudo de tarifa — rascunho sem validade oficial</h1>
  <p className="dev-note">Ambiente de desenvolvimento com dados fictícios. Nenhum valor
   abaixo representa tarifa aprovada, pagamento, débito, voucher ou direito de estacionar.</p>
  {allowed&&city?<TariffDraftPanel municipalityId={municipalityId} municipalityName={city.displayName}/>:
   <p role="alert" className="denied">Acesso negado ao município selecionado.</p>}
 </main>;
}
