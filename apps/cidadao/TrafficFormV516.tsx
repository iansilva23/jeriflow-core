import { useRef, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { AuthFailure, errorMessage, type Transport } from "../../packages/auth/client";
import { TRAFFIC_TYPES_V516 } from "../../packages/contracts/src/citizen-traffic-v516";

export default function TrafficFormV516({ municipalityId, transport }: { municipalityId: string; transport: Transport }) {
  const [type, setType] = useState("");
  const [location, setLocation] = useState("");
  const [plate, setPlate] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const locked = useRef(false);

  async function pick(camera: boolean) {
    if (locked.current) return;
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

  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header">Denúncia de trânsito</Text>
    {TRAFFIC_TYPES_V516.map(item => <Button key={item} title={item === type ? item + " (selecionado)" : item}
      disabled={busy} onPress={() => setType(item)} />)}
    <TextInput accessibilityLabel="Local da ocorrência" placeholder="Local da ocorrência" value={location}
      maxLength={1000} editable={!busy} onChangeText={setLocation} />
    <TextInput accessibilityLabel="Placa opcional" placeholder="Placa (opcional)" value={plate}
      autoCapitalize="characters" maxLength={8} editable={!busy} onChangeText={setPlate} />
    <TextInput accessibilityLabel="Descrição da ocorrência" placeholder="Descrição da ocorrência" value={description}
      multiline maxLength={10000} editable={!busy} onChangeText={setDescription} />
    <Button title="Tirar foto" disabled={busy} onPress={() => void pick(true)} />
    <Button title="Escolher foto da galeria" disabled={busy} onPress={() => void pick(false)} />
    {photo && <Text>Foto selecionada.</Text>}
    <Button title={busy ? "Enviando…" : "Enviar denúncia"}
      disabled={busy || !type || !location.trim() || !description.trim() || !photo} onPress={() => void submit()} />
    {!!feedback && <Text accessibilityLiveRegion="polite">{feedback}</Text>}
  </View>;
}
