import { adminPanels } from "../../../packages/contracts/src/catalog";
import { panelPermissions } from "../../../packages/contracts/src/identity";
import { authenticatedAdmin } from "../lib/session";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { context } = await authenticatedAdmin();
  const global = adminPanels.filter(panel=>context.platformPermissions.includes(panelPermissions[panel.id]));
  const municipalities = context.municipalities.filter(m=>m.permissions.some(p=>p.startsWith("admin:") || p === "tts:admin:access"));
  return <main className="workspace"><header><a className="brand" href="/">JeriFlow<span>ADMINISTRATIVO</span></a><a href="/entrar">Minha conta e segurança</a></header>
    <h1>Suas áreas de trabalho</h1><p>Olá, {context.user.displayName}. Escolha o município e a área autorizada para sua conta.</p>
    {!global.length && !municipalities.length && <p className="denied">Esta conta não possui acesso administrativo. Solicite a atribuição de perfil ao responsável.</p>}
    {global.length>0 && <><h2>Administração global</h2><div className="panel-grid">{global.map(panel=><a key={panel.id} className="panel-link" href={`/paineis/${panel.id}`}>{panel.name}<span>Abrir área →</span></a>)}</div></>}
    {municipalities.map(m=><section key={m.id}><h2>{m.displayName}</h2><div className="panel-grid">{adminPanels.filter(panel=>m.permissions.includes(panelPermissions[panel.id])).map(panel=><a key={panel.id} className="panel-link" href={`/paineis/${panel.id}?municipalityId=${encodeURIComponent(m.id)}`}>{panel.name}<span>Abrir área →</span></a>)}{m.permissions.includes("tts:admin:access") && <a className="panel-link" href={`/paineis/turismo/tts?municipalityId=${encodeURIComponent(m.id)}`}>Administração TTS<span>Área do Turismo/Estacionamento →</span></a>}</div></section>)}
    <p className="dev-note">Ambiente de desenvolvimento. Não use dados reais. Autenticação conectada; funções operacionais dos painéis ainda em desenvolvimento.</p>
  </main>;
}
