import { authorizePanel } from "../../../../lib/session";
export const dynamic = "force-dynamic";
export default async function TtsPage({ searchParams }: { searchParams: Promise<{ municipalityId?: string | string[] }> }) {
  const query = await searchParams, municipalityId = typeof query.municipalityId === "string" ? query.municipalityId : undefined;
  const { allowed } = await authorizePanel("tts:admin:access", municipalityId);
  return <main className="workspace"><a href="/">← Minhas áreas</a><h1>Administração TTS</h1>{allowed ? <p>Área do Admin Turismo/Estacionamento. Acesso confirmado; operações por comprovante, autorização e token ainda serão conectadas. Não há integração com a taxa oficial.</p> : <p role="alert" className="denied">Acesso negado. O perfil Fiscal TTS não concede administração da TTS.</p>}<p className="dev-note">Ambiente de desenvolvimento. Não use dados reais.</p></main>;
}
