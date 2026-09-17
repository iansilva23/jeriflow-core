import { adminPanels } from "../../../packages/contracts/src/catalog";
export default function Page() {
  return <main><h1>JeriFlow — base administrativa</h1>
    <p>Etapa 2: ambiente de desenvolvimento. Sem dados reais e sem login operacional.</p>
    <p>Os sete painéis permanecem separados por área. A autorização no servidor ainda será implementada.</p>
    <ul>{adminPanels.map(panel => <li key={panel.id}><a href={"/paineis/" + panel.id}>{panel.name}</a></li>)}</ul>
  </main>;
}
