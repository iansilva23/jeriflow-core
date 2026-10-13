import AuthApp from "../../packages/mobile-auth/AuthApp";
import GuardAuthorizedViewV516 from "./GuardAuthorizedViewV516";
import * as Crypto from "expo-crypto";

// A prévia exige ativação explícita na build de homologação.
// Permanecer desativada nas builds normais; backend ainda depende de homologação.
const PREVIEW_GUARDA_V516 = process.env.EXPO_PUBLIC_GUARDA_V516_PREVIEW === "1";

export default function App() {
  return <AuthApp appId="guarda" operationalHome={PREVIEW_GUARDA_V516
    ? (context,transport) => <GuardAuthorizedViewV516
        context={context} transport={transport}
        newRequestId={() => {
          // React Native/Hermes não garante globalThis.crypto.randomUUID.
          // O Expo utiliza gerador criptograficamente seguro nativo Android/iOS.
          try {
            return Crypto.randomUUID();
          } catch {
            throw new Error("GUARD_SECURE_RANDOM_UNAVAILABLE");
          }
        }}/>
    : undefined}/>;
}
