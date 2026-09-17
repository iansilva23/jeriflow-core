import { notFound } from "next/navigation";
import { adminPanels } from "../../../../../packages/contracts/src/catalog";
export function generateStaticParams() { return adminPanels.map(p => ({ painel: p.id })); }
export default async function Page({ params }: { params: Promise<{ painel: string }> }) {
  const { painel } = await params;
  const panel = adminPanels.find(p => p.id === painel);
  if (!panel) notFound();
  return <main><h1>{panel.name}</h1><p>Área reservada para implementação. Nenhuma operação ou dado real disponível.</p><a href="/">Voltar ao índice</a></main>;
}
