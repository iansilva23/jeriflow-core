import TrafficFormV516 from "./TrafficFormV516";
import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { AuthFailure, errorMessage, type Transport } from "../../packages/auth/client";
import type { IdentityContext } from "../../packages/contracts/src/identity";

export default function CitizenLinkViewV516({ context, transport }: {
  context: IdentityContext;
  transport: Transport;
}) {
  const municipalities = context.municipalities.filter(item => item.roles.includes("cidadao"));
  const [selected, setSelected] = useState<string>();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const municipalityId = municipalities.length === 1 ? municipalities[0].id : selected;
  const validMunicipality = municipalities.some(item => item.id === municipalityId);

  async function link() {
    if (busy || !validMunicipality || !login.trim() || !password) return;
    setBusy(true);
    setFeedback("");
    try {
      const result = await transport.request("/auth/citizen-link", { municipalityId, login, password });
      if (result.linked !== true) throw new AuthFailure("INVALID_RESPONSE");
      setFeedback("Conta Cidadão vinculada ao município.");
      setLogin("");
    } catch (error) {
      setFeedback(error instanceof AuthFailure && error.code === "INVALID_CREDENTIALS"
        ? "Confira o usuário e a senha da conta Cidadão."
        : error instanceof AuthFailure && error.code === "CITIZEN_LINK_CONFLICT"
          ? "Já existe um vínculo diferente para essa conta ou município."
          : errorMessage(error));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  if (!municipalities.length) return null;
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header">Vincular conta Cidadão existente</Text>
    {municipalities.length === 1
      ? <Text>{municipalities[0].displayName}</Text>
      : municipalities.map(item => <Button key={item.id}
          title={item.id === selected ? item.displayName + " (selecionado)" : item.displayName}
          disabled={busy} onPress={() => { setSelected(item.id); setFeedback(""); setPassword(""); }} />)}
    <TextInput accessibilityLabel="Usuário da conta Cidadão" placeholder="Usuário da conta Cidadão"
      autoCapitalize="none" autoCorrect={false} editable={!busy} value={login} onChangeText={setLogin} />
    <TextInput accessibilityLabel="Senha da conta Cidadão" placeholder="Senha da conta Cidadão"
      secureTextEntry editable={!busy} value={password} onChangeText={setPassword} />
    <Button title={busy ? "Vinculando…" : "Vincular conta"}
      disabled={busy || !validMunicipality || !login.trim() || !password} onPress={() => void link()} />
    {!!feedback && <Text accessibilityLiveRegion="polite">{feedback}</Text>}
    {validMunicipality && municipalityId && <TrafficFormV516 key={municipalityId} municipalityId={municipalityId} transport={transport} />}
  </View>;
}
