import { authorizePanel } from "../../../../lib/session";
import ProtocolPanel from "./panel";
export const dynamic = "force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{municipalityId?:string|string[]}>}) {
  const params=await searchParams;
  const municipalityId=typeof params.municipalityId==="string"?params.municipalityId:"";
  const {allowed,context}=await authorizePanel("admin:cidadao:access",municipalityId||undefined);
  const municipality=allowed?context.municipalities.find(m=>m.id===municipalityId):undefined;
  return <main className="workspace">
    <a href={municipalityId?`/paineis/cidadao?municipalityId=${encodeURIComponent(municipalityId)}`:"/"}>← Painel Cidadão</a>
    <h1>Ouvidoria · Atendimento</h1>
    <p className="hint">Protocolos do município autorizado, com histórico de revisões e operações auditadas.</p>
    {allowed&&municipality?<ProtocolPanel municipalityId={municipalityId} municipalityName={municipality.displayName}/>:
      <p role="alert" className="denied">Acesso negado. Escolha um município autorizado ao perfil Admin Cidadão/Ouvidoria.</p>}
    <p className="dev-note">Ambiente de desenvolvimento. Use somente protocolos fictícios. Sem dados reais ou divulgação pública.</p>
  </main>;
}
