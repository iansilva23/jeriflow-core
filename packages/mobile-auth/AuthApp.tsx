import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { mobileApps, type MobileAppId } from "../contracts/src/catalog";
import { AuthController } from "../auth/controller";
import { apiBase, bearerTransport } from "../auth/client";
import { useAuth } from "../auth/use-auth";

export default function AuthApp({ appId }: { appId: MobileAppId }) {
  const app = mobileApps.find(item => item.id === appId)!;
  const publicRole = appId === "cidadao" ? "cidadao" : appId === "turista" ? "turista" : undefined;
  const [controller] = useState(() => {
    const key = `jeriflow.session.${appId}`;
    const options = { keychainService: `jeriflow.${appId}`, keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
    return new AuthController(bearerTransport(
      () => apiBase(process.env.EXPO_PUBLIC_API_URL, process.env.EXPO_PUBLIC_LOCAL_API === "1"),
      { get: () => SecureStore.getItemAsync(key, options), set: value => SecureStore.setItemAsync(key, value, options), remove: () => SecureStore.deleteItemAsync(key, options) },
    ));
  });
  const state = useAuth(controller);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState(""), [saved, setSaved] = useState(false), [hidden, setHidden] = useState(AppState.currentState !== "active");
  useEffect(() => { setPassword(""); setConfirmation(""); setCode(""); setSaved(false); }, [state.mode]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", value => {
      setHidden(value !== "active");
      if (value === "active" && controller.snapshot().mode === "home") void controller.refresh();
    });
    return () => listener.remove();
  }, [controller]);
  const submit = (action: () => Promise<void>) => async () => { await action(); setPassword(""); setConfirmation(""); setCode(""); };
  const button = (label: string, action: () => unknown, secondary = true, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: state.busy || disabled }} disabled={state.busy || disabled} onPress={() => void action()} style={({ pressed }) => [styles.button, secondary && styles.secondary, (state.busy || disabled) && styles.disabled, pressed && styles.pressed]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text></Pressable>;
  const field = (label: string, value: string, change: (value: string) => void, kind: "text" | "email" | "password" | "new-password" = "text") => <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={change} editable={!state.busy} secureTextEntry={kind.includes("password")} keyboardType={kind === "email" ? "email-address" : "default"} autoCapitalize="none" autoCorrect={false} autoComplete={kind === "email" ? "email" : kind === "password" ? "current-password" : kind === "new-password" ? "new-password" : "off"} maxLength={kind.includes("password") ? 128 : 254} style={styles.input} /></View>;
  const passwordField = field("Senha (15 a 128 caracteres)", password, setPassword, ["reset", "activate"].includes(state.mode) ? "new-password" : "password");
  const codeField = field(state.mode === "mfa" || state.mode === "rotate" || (state.mode === "enroll" && state.context?.security.mfaEnabled) ? "Código do autenticador ou de recuperação" : "Código recebido", code, setCode);
  const title = (value: string) => <Text accessibilityRole="header" style={styles.title}>{value}</Text>;
  const paragraph = (value: string) => <Text style={styles.text}>{value}</Text>;
  let content: ReactNode;
  switch (state.mode) {
    case "loading": content = <><ActivityIndicator color="#075e59" />{paragraph("Verificando sua sessão…")}</>; break;
    case "unavailable": content = <>{title("Conexão indisponível")}{paragraph("Precisamos verificar sua sessão para liberar o acesso.")}{button("Tentar novamente", controller.refresh, false)}{button("Voltar ao acesso", () => controller.navigate("login"))}</>; break;
    case "login": content = <>{title("Bem-vindo de volta")}{paragraph("Entre para acessar seus serviços.")}{field("Email", email, setEmail, "email")}{passwordField}{button(state.busy ? "Aguarde…" : "Entrar", submit(() => controller.login(email, password)), false)}{button("Esqueci minha senha", () => controller.navigate("forgot"))}{publicRole && button("Criar minha conta", () => controller.navigate("register"))}{button("Ativar conta com código", () => controller.navigate("activate"))}{!publicRole && <Text style={styles.hint}>Os acessos de servidores são liberados pelo Mestre. Um cadastro público não concede esses privilégios.</Text>}</>; break;
    case "register": content = <>{title("Criar minha conta")}{paragraph("Primeiro confirme seu email. Você só definirá a senha após receber o código.")}{field("Email", email, setEmail, "email")}{button("Solicitar código de cadastro", submit(() => controller.register(email)), false)}{button("Já tenho um código", () => controller.navigate("activate"))}{button("Voltar ao login", () => controller.navigate("login"))}</>; break;
    case "activate": content = <>{title("Ativar minha conta")}{paragraph("Use o código de cadastro ou convite recebido por email. Ele vence em 30 minutos.")}{codeField}{field("Nome de exibição", name, setName)}{passwordField}{field("Confirme a senha", confirmation, setConfirmation, "new-password")}{button("Ativar conta", submit(() => controller.activate(code, name, password, confirmation)), false)}{publicRole && button("Solicitar outro código", () => controller.navigate("register"))}{!publicRole && paragraph("Se o convite venceu, peça ao Mestre para reenviar o vínculo da sua conta.")}{button("Voltar ao login", () => controller.navigate("login"))}</>; break;
    case "join": content = <>{title("Escolha seu município")}{paragraph("O vínculo permite apenas o acesso público deste aplicativo.")}{state.municipalities?.length ? state.municipalities.map(m => <View key={m.id}>{button(m.displayName, () => publicRole && controller.join(m.id, publicRole), false)}</View>) : paragraph("Nenhum município disponível nesta lista.")}{state.nextMunicipality && button("Carregar mais municípios", () => controller.loadMunicipalities(true))}{button("Voltar à conta", controller.refresh)}</>; break;
    case "forgot": content = <>{title("Recuperar acesso")}{paragraph("Use o email já confirmado da sua conta.")}{field("Email", email, setEmail, "email")}{button("Solicitar código", submit(() => controller.requestReset(email)), false)}{button("Já tenho um código", () => controller.navigate("reset"))}{button("Voltar ao login", () => controller.navigate("login"))}</>; break;
    case "reset": content = <>{title("Definir nova senha")}{codeField}{passwordField}{field("Confirme a nova senha", confirmation, setConfirmation, "new-password")}{button("Alterar senha", submit(() => controller.reset(code, password, confirmation)), false)}{button("Solicitar outro código", () => controller.navigate("forgot"))}{button("Voltar ao login", () => controller.navigate("login"))}</>; break;
    case "verify": content = <>{title("Confirme seu email")}{paragraph(`Enviaremos um código para ${state.context?.user.email ?? "seu email"}.`)}{button("Enviar ou reenviar código", () => controller.requestEmail())}{codeField}{button("Confirmar email", submit(() => controller.confirmEmail(code)), false)}{button("Sair desta conta", () => controller.logout())}</>; break;
    case "mfa": content = <>{title("Segunda confirmação")}{paragraph("Abra seu autenticador ou use um dos códigos de recuperação guardados.")}{codeField}{button("Confirmar acesso", submit(() => controller.challenge(code)), false)}{button("Sair desta conta", () => controller.logout())}</>; break;
    case "enroll": content = <>{title(state.context?.security.mfaEnabled ? "Trocar autenticador" : "Proteja sua conta")}{paragraph("Adicione a confirmação em duas etapas. Ela é obrigatória para administradores.")}{!state.secret ? <>{passwordField}{state.context?.security.mfaEnabled ? codeField : null}{button("Preparar autenticador", submit(() => controller.enroll(password, code)), false)}</> : <>{paragraph("No autenticador, adicione uma conta por chave de configuração. Nome: JeriFlow; tipo: baseado em tempo.")}<Text selectable style={styles.secret}>{state.secret}</Text><Text style={styles.hint}>Não compartilhe esta chave. Ela vence em dez minutos.</Text>{field("Código de seis dígitos do novo autenticador", code, setCode)}{button("Ativar proteção", submit(() => controller.confirmEnrollment(code)), false)}</>}{state.context?.security.nextStep === "ready" && button("Voltar à conta", controller.refresh)}{button("Sair desta conta", () => controller.logout())}</>; break;
    case "rotate": content = <>{title("Renovar códigos")}{paragraph("Os códigos antigos serão cancelados e as outras sessões serão encerradas.")}{passwordField}{codeField}{button("Renovar códigos", submit(() => controller.rotate(password, code)), false)}{button("Cancelar", controller.refresh)}</>; break;
    case "backup": content = <>{title("Guarde seus códigos")}{paragraph("Cada código funciona uma vez. Guarde-os fora deste dispositivo. Esta lista não ficará disponível depois de sair.")}<Text selectable style={styles.recovery}>{state.codes?.join("\n")}</Text><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: saved, disabled: state.busy }} disabled={state.busy} onPress={() => setSaved(!saved)} style={styles.check}><Text style={styles.text}>{saved ? "☑" : "☐"} Guardei os dez códigos em um lugar seguro.</Text></Pressable>{button("Continuar", controller.acknowledgeBackups, false, !saved)}</>; break;
    case "home": {
      const permission = `mobile:${appId}:access`;
      const areas = state.context?.municipalities.filter(m => m.permissions.includes(permission)) ?? [];
      content = <>{title("Conta verificada")}{paragraph(state.context?.user.displayName ?? "")}{areas.length ? <>{paragraph("Seus municípios autorizados:")}{areas.map(m => <View key={m.id}>{button(`Verificar acesso: ${m.displayName}`, () => controller.access(m.id, permission), false)}</View>)}</> : paragraph("Esta conta ainda não tem acesso a este aplicativo. O responsável pelo município pode revisar suas permissões.")}{publicRole && button("Vincular município", () => controller.loadMunicipalities())}<Text style={styles.hint}>As funções operacionais serão conectadas nos próximos blocos.</Text>{button(state.context?.security.mfaEnabled ? "Trocar autenticador" : "Ativar proteção em duas etapas", () => controller.navigate("enroll"))}{state.context?.security.mfaEnabled && button("Renovar códigos de recuperação", () => controller.navigate("rotate"))}{button("Sair deste dispositivo", () => controller.logout())}{button("Sair de todos os dispositivos", () => controller.logout(true))}</>;
      break;
    }
  }
  if (hidden) return <View style={styles.privacy}><Text style={styles.brand}>{app.name}</Text><Text style={styles.text}>Sua conta está protegida.</Text></View>;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><View style={styles.container}><View style={styles.heading}><Text accessibilityRole="header" style={styles.brand}>{app.name}</Text><Text style={styles.dev}>Ambiente de desenvolvimento</Text><Text style={styles.hint}>Não use dados reais.</Text></View><View style={styles.card}>{content}{state.error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{state.error}</Text>}{state.notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>}</View><Text style={styles.footer}>Sua cidade, mais perto de você.</Text></View></ScrollView></KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f5ef" }, scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 64, paddingBottom: 40 },
  container: { width: "100%", maxWidth: 480, alignSelf: "center", gap: 24 }, heading: { gap: 7 },
  brand: { fontSize: 25, fontWeight: "800", color: "#075e59" }, dev: { fontSize: 14, color: "#354e47", fontWeight: "600" },
  card: { backgroundColor: "#fff", borderRadius: 20, padding: 22, gap: 16, borderColor: "#dde4db", borderWidth: 1 },
  title: { fontSize: 24, fontWeight: "700", color: "#183c35" }, text: { fontSize: 16, lineHeight: 24, color: "#354e47" },
  hint: { fontSize: 13, lineHeight: 20, color: "#58685f" }, field: { gap: 8 }, label: { fontSize: 14, fontWeight: "600", color: "#283d35" },
  input: { minHeight: 50, borderWidth: 1, borderColor: "#7b9587", borderRadius: 10, backgroundColor: "#fff", paddingHorizontal: 13, paddingVertical: 11, fontSize: 16, color: "#16362d" },
  button: { minHeight: 48, backgroundColor: "#075e59", padding: 13, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 15, lineHeight: 22, fontWeight: "700", textAlign: "center" }, secondary: { backgroundColor: "#eef4ef" },
  secondaryText: { color: "#075e59" }, disabled: { opacity: 0.5 }, pressed: { opacity: 0.75 },
  secret: { padding: 12, backgroundColor: "#eef4ef", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: "#123d33", fontSize: 17 },
  recovery: { fontSize: 12, lineHeight: 24, color: "#123d33", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }, check: { paddingVertical: 10 },
  error: { padding: 13, borderRadius: 10, fontSize: 14, lineHeight: 21, backgroundColor: "#fff0ed", color: "#912c21" },
  notice: { padding: 13, borderRadius: 10, fontSize: 14, lineHeight: 21, backgroundColor: "#e9f4ea", color: "#174c32" }, footer: { color: "#58685f", fontSize: 13, textAlign: "center" },
  privacy: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, backgroundColor: "#f6f5ef", padding: 24 },
});
