import AuthApp from "../../packages/mobile-auth/AuthApp";
import CitizenLinkViewV516 from "./CitizenLinkViewV516";

const preview = process.env.EXPO_PUBLIC_CIDADAO_V516_PREVIEW === "1";

export default function App() {
  return <AuthApp appId="cidadao" operationalHome={preview
    ? (context, transport) => <CitizenLinkViewV516 key={context.user.id} context={context} transport={transport} />
    : undefined} />;
}
