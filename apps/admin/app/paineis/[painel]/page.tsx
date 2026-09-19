import { notFound } from "next/navigation";
import { adminPanels } from "../../../../../packages/contracts/src/catalog";
import { panelPermissions } from "../../../../../packages/contracts/src/identity";
import { authorizePanel } from "../../../lib/session";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ painel: string }>; searchParams: Promise<{ municipalityId?: string | string[] }> }) {
  const { painel } = await params, query = await searchParams;
  const panel = adminPanels.find(p=>p.id===painel); if (!panel) notFound();
  const municipalityId = typeof query.municipalityId === "string" ? query.municipalityId : undefined;
  const { allowed, context } = await authorizePanel(panelPermissions[panel.id], painel === "mestre" ? undefined : municipalityId);
  return <main className="workspace"><a href="/">← Minhas áreas</a><h1>{panel.name}</h1>{allowed ? <><p>{painel === "mestre" ? "Administração global" : context.municipalities.find(m=>m.id===municipalityId)?.displayName}</p><p>Seu acesso foi confirmado no servidor. As operações deste painel ainda estão em desenvolvimento; nenhum dado operacional está disponível.</p>{painel === "turismo" && context.municipalities.find(m=>m.id===municipalityId)?.permissions.includes("tts:admin:access") && <a href={`/paineis/turismo/tts?municipalityId=${encodeURIComponent(municipalityId!)}`}>Administração da TTS</a>}</> : <p role="alert" className="denied">Acesso negado. Selecione um município autorizado ou solicite o perfil correto ao responsável.</p>}<p className="dev-note">Ambiente de desenvolvimento. Não use dados reais.</p></main>;
}
