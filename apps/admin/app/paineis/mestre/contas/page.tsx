import { authorizePanel } from "../../../../lib/session";
import AccountsPanel from "./panel";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { allowed } = await authorizePanel("admin:mestre:access");
  return <main className="workspace"><a href="/paineis/mestre">← Admin Mestre</a><h1>Contas e municípios</h1>
    {allowed ? <AccountsPanel /> : <p role="alert" className="denied">Acesso negado. Somente o Mestre pode gerenciar contas.</p>}
    <p className="dev-note">Ambiente de desenvolvimento. Use apenas dados fictícios. Emails são entregues somente na caixa local de testes.</p></main>;
}
