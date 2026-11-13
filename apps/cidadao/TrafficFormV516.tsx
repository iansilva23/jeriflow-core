import { useRef, useState } from "react";
import { Button, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { AuthFailure, errorMessage, type Transport } from "../../packages/auth/client";
import { TRAFFIC_TYPES_V516 } from "../../packages/contracts/src/citizen-traffic-v516";

export default function TrafficFormV516({ municipalityId, transport }: { municipalityId: string; transport: Transport }) {
  const [type, setType] = useState("");
  const [typesOpen, setTypesOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [plate, setPlate] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const locked = useRef(false);

  async function pick(camera: boolean) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        setFeedback("Autorize a câmera ou escolha uma foto da galeria.");
        return;
      }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"] })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] });
      if (!result.canceled) {
        const asset = result.assets[0];
        if (asset.fileSize !== undefined && asset.fileSize > 8 * 1024 * 1024) {
          setFeedback("Escolha uma foto de até 8 MB.");
          return;
        }
        setPhoto(asset);
        setFeedback("");
      }
    } catch {
      setFeedback("Não foi possível abrir a foto.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  async function submit() {
    if (locked.current || !photo || !type || !location.trim() || !description.trim() || !transport.trafficSubmit) return;
    locked.current = true;
    setBusy(true);
    setFeedback("");
    try {
      const form = new FormData();
      form.append("title", type);
      form.append("location", location);
      form.append("plate", plate);
      form.append("description", description);
      // React Native serializa anexos locais com uri, name e type.
      const file = { uri: photo.uri, name: photo.fileName ?? "foto", type: photo.mimeType ?? "application/octet-stream" };
      form.append("photo", photo.file ?? (file as unknown as Blob));
      const result = await transport.trafficSubmit(municipalityId, form);
      setFeedback("Protocolo recebido: " + result.protocolId);
      setType(""); setLocation(""); setPlate(""); setDescription(""); setPhoto(undefined);
    } catch (error) {
      const code = error instanceof AuthFailure ? error.code : undefined;
      setFeedback(code === "TRAFFIC_SESSION_DENIED" ? "Confira o vínculo Cidadão e o município."
        : code === "TRAFFIC_FORM_TOO_LARGE" ? "Escolha uma foto de até 8 MB."
          : code === "TRAFFIC_SUBMISSION_UNCERTAIN" ? "O envio ainda não foi confirmado. Mantenha os dados e a foto ao consultar ou tentar novamente."
            : errorMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <View style={styles.form}>
    <View style={styles.hero}>
      <Text accessibilityRole="header" style={styles.heroTitle}>Denúncia de Trânsito — SEMUS</Text>
      <Text style={styles.heroText}>Preencha as informações da ocorrência. A foto é obrigatória para reduzir trotes e ajudar a equipe a verificar a situação antes do atendimento.</Text>
    </View>
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>O que está acontecendo?</Text>
      <Text style={styles.label}>Tipo de ocorrência *</Text>
      <Pressable style={styles.field} accessibilityRole="button"
        accessibilityLabel={type ? "Tipo de ocorrência: " + type : "Selecionar tipo de ocorrência"}
        accessibilityState={{ expanded: typesOpen, disabled: busy }} disabled={busy}
        onPress={() => setTypesOpen(!typesOpen)}>
        <Text style={styles.fieldText}>{type || "Selecione"}</Text>
      </Pressable>
      {typesOpen && TRAFFIC_TYPES_V516.map(item => <Pressable key={item} style={styles.field}
        accessibilityRole="button" accessibilityState={{ selected: type === item, disabled: busy }}
        disabled={busy} onPress={() => { setType(item); setTypesOpen(false); }}>
        <Text style={styles.fieldText}>{item}</Text>
      </Pressable>)}
      <Text style={styles.label}>Local da ocorrência *</Text>
      <TextInput style={styles.field} accessibilityLabel="Local da ocorrência" placeholder="Rua, ponto de referência ou local"
        value={location} maxLength={1000} editable={!busy} onChangeText={setLocation} />
      <Text style={styles.label}>Placa do veículo (opcional)</Text>
      <TextInput style={styles.field} accessibilityLabel="Placa do veículo (opcional)" placeholder="Digite a placa"
        value={plate} autoCapitalize="characters" maxLength={8} editable={!busy} onChangeText={setPlate} />
      <Text style={styles.label}>Descrição *</Text>
      <TextInput style={[styles.field, styles.description]} accessibilityLabel="Descrição da ocorrência"
        placeholder="Explique rapidamente o que está acontecendo..." value={description}
        multiline maxLength={10000} editable={!busy} onChangeText={setDescription} />
    </View>
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Foto da ocorrência *</Text>
      <Text style={[styles.notice, styles.warning]}>A denúncia não pode ser enviada sem uma foto que mostre a situação relatada.</Text>
      <Button title="Tirar foto" color="#08777c" disabled={busy} onPress={() => void pick(true)} />
      <Button title="Escolher da galeria" color="#08777c" disabled={busy} onPress={() => void pick(false)} />
      {photo && <Image source={{ uri: photo.uri }} style={styles.photo} accessible accessibilityLabel="Prévia da foto da ocorrência" />}
    </View>
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Seus dados</Text>
      <Text style={styles.notice}>Sua identificação fica vinculada à denúncia. O agente poderá reportar trote ou informação falsa para análise administrativa.</Text>
    </View>
    <Button title={busy ? "Aguarde…" : "Enviar denúncia à SEMUS"} color="#08777c"
      disabled={busy || !type || !location.trim() || !description.trim() || !photo || !transport.trafficSubmit}
      onPress={() => void submit()} />
    {!!feedback && <Text style={styles.notice} accessibilityLiveRegion="polite">{feedback}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  form: { gap: 10, marginTop: 10 },
  hero: { backgroundColor: "#082c38", borderRadius: 24, padding: 14, gap: 6 },
  heroTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  heroText: { color: "#d7eeee", lineHeight: 20 },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#dfe8e6", borderRadius: 20, padding: 14, gap: 7 },
  heading: { color: "#0d3542", fontSize: 15, fontWeight: "800" },
  label: { color: "#38565f", fontWeight: "700" },
  field: { backgroundColor: "#f8fbf9", borderWidth: 1, borderColor: "#dfe8e6", borderRadius: 11, padding: 10, minHeight: 44, color: "#0d3542" },
  fieldText: { color: "#0d3542" },
  description: { minHeight: 90, textAlignVertical: "top" },
  notice: { color: "#316067", backgroundColor: "#eef8f6", borderRadius: 11, padding: 10 },
  warning: { color: "#7c6425", backgroundColor: "#fff6e6" },
  photo: { width: "100%", height: 180, borderRadius: 12, backgroundColor: "#f8fbf9" },
});
