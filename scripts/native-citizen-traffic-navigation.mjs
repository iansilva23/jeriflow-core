import assert from "node:assert/strict";
import { findAccessibleCenter } from "./native-guard-navigation.mjs";
import { androidDisplaySizeV516, androidScrollGestureV516, fieldCenter } from "./native-guard-auth-navigation.mjs";

export async function verifyCitizenTrafficNavigation({ adb, readHierarchy, waitFor, writeTextSecret, fixture }) {
  assert.match(fixture.email, /^[a-z0-9-]+@example\.invalid$/);
  assert.match(fixture.password, /^[a-f0-9]{48}$/);
  assert.match(fixture.citizenLogin, /^citizen\.[a-z0-9-]+$/);
  assert.match(fixture.citizenPassword, /^[a-zA-Z0-9]{15,64}$/);
  const gesture = androidScrollGestureV516(androidDisplaySizeV516(await adb(["shell", "wm", "size"])));
  const locate = async (label, find, scroll = false) => {
    const attempts = scroll ? 8 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await waitFor(async () => {
          const value = find(await readHierarchy());
          assert(value, "Controle Cidadão ausente: " + label);
          return value;
        }, scroll ? 3500 : 18000);
      } catch (error) {
        if (attempt === attempts - 1) throw error;
        await adb(["shell", "input", "swipe", ...gesture]);
      }
    }
  };
  const tap = point => adb(["shell", "input", "tap", String(point.x), String(point.y)]);
  const press = async (label, scroll = false) =>
    tap(await locate(label, xml => findAccessibleCenter(xml, label), scroll));
  const fill = async (label, index, value, scroll = false) => {
    await tap(await locate(label, xml => fieldCenter(xml, label, index), scroll));
    await writeTextSecret(value);
    await adb(["shell", "input", "keyevent", "4"]);
  };

  await fill("Email", 0, fixture.email);
  await fill("Senha (15 a 128 caracteres)", 1, fixture.password);
  await press("Entrar", true);
  await locate("Conta verificada", xml => findAccessibleCenter(xml, "Conta verificada"));
  await fill("Usuário da conta Cidadão", 0, fixture.citizenLogin, true);
  await fill("Senha da conta Cidadão", 1, fixture.citizenPassword, true);
  await press("Vincular conta", true);
  await locate("Vínculo confirmado", xml => findAccessibleCenter(xml, "Conta Cidadão vinculada ao município."), true);
  await press("Selecionar tipo de ocorrência", true);
  await press("Estacionamento irregular", true);
  await fill("Local da ocorrência", 0, "Rua%sFicticia", true);
  await fill("Descrição da ocorrência", 2, "Ocorrencia%sde%steste", true);
  await press("Escolher da galeria", true);
  await tap(await locate("Foto sintética na galeria", xml => {
    const exact = findAccessibleCenter(xml, "jeriflow-traffic-fixture.png");
    if (exact) return exact;
    const items = [...xml.matchAll(/<node\b[^>]*resource-id="[^"]*:id\/icon_thumbnail"[^>]*>/g)];
    if (items.length !== 1) return null;
    const bounds = items[0][0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!bounds) return null;
    const [, left, top, right, bottom] = bounds.map(Number);
    return { x: Math.floor((left + right) / 2), y: Math.floor((top + bottom) / 2) };
  }));
  await locate("Prévia da foto", xml => findAccessibleCenter(xml, "Prévia da foto da ocorrência"), true);
  await press("Enviar denúncia à SEMUS", true);
  const protocolId = await locate("Confirmação de envio", xml =>
    xml.match(/(?:text|content-desc)="Protocolo recebido: (JF-[0-9]{8}-[0-9]{6,})"/)?.[1],
  true);
  return { protocolId, photoPreviewVisible: true };
}
