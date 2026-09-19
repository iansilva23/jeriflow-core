"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="workspace"><h1>Não foi possível consultar o acesso</h1><p>O servidor pode estar indisponível. Nenhum acesso foi liberado sem confirmação.</p><button onClick={reset}>Tentar novamente</button><p><a href="/entrar">Voltar ao acesso</a></p></main>; }
