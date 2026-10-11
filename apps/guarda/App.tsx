import AuthApp from "../../packages/mobile-auth/AuthApp";
import GuardAuthorizedViewV516 from "./GuardAuthorizedViewV516";

// A prévia exige ativação explícita na build de homologação.
// Permanecer desativada nas builds normais; backend ainda depende de homologação.
const PREVIEW_GUARDA_V516 = process.env.EXPO_PUBLIC_GUARDA_V516_PREVIEW === "1";

export default function App() {
  return <AuthApp appId="guarda" operationalHome={PREVIEW_GUARDA_V516
    ? (context,transport) => <GuardAuthorizedViewV516
        context={context} transport={transport}
        newRequestId={() => {
          const value = globalThis.crypto?.randomUUID?.();
          if (!value) throw new Error("GUARD_SECURE_RANDOM_UNAVAILABLE");
          return value;
        }}/>
    : undefined}/>;
}
