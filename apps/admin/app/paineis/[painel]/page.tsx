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
  if (painel === "mestre" && allowed) return <main className="workspace"><a href="/">← Minhas áreas</a><h1>{panel.name}</h1><p>Seu acesso foi confirmado no servidor.</p><a className="primary-link" href="/paineis/mestre/contas">Gerenciar contas e municípios</a><p className="dev-note">Ambiente de desenvolvimento. Não use dados reais.</p></main>;
  return <main className="workspace"><a href="/">← Minhas áreas</a><h1>{panel.name}</h1>{allowed ? <><p>{painel === "mestre" ? "Administração global" : context.municipalities.find(m=>m.id===municipalityId)?.displayName}</p><p>Seu acesso foi confirmado no servidor. As operações deste painel ainda estão em desenvolvimento; nenhum dado operacional está disponível.</p>{painel === "turismo" && context.municipalities.find(m=>m.id===municipalityId)?.permissions.includes("tts:admin:access") && <a href={`/paineis/turismo/tts?municipalityId=${encodeURIComponent(municipalityId!)}`}>Administração da TTS</a>}{painel === "semus" && municipalityId && <a className="primary-link" href={`/paineis/semus/ocorrencias?municipalityId=${encodeURIComponent(municipalityId)}`}>Ocorrências da Guarda</a>}{painel === "cidadao" && municipalityId && <a className="primary-link" href={`/paineis/cidadao/ouvidoria?municipalityId=${encodeURIComponent(municipalityId)}`}>Abrir atendimento da Ouvidoria</a>}</> : <p role="alert" className="denied">Acesso negado. Selecione um município autorizado ou solicite o perfil correto ao responsável.</p>}<p className="dev-note">Ambiente de desenvolvimento. Não use dados reais.</p></main>;
}
