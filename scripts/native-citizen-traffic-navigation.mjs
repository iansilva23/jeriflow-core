import assert from "node:assert/strict";
import { findAccessibleCenter } from "./native-guard-navigation.mjs";
import { androidDisplaySizeV516, androidScrollGestureV516, fieldCenter } from "./native-guard-auth-navigation.mjs";

export function findSyntheticPhotoCenter(pixels, width, height, channels) {
  // O Photo Picker do runner escureceu #80d3ce para #67a9a6 na captura
  // da execução 43919822769. Aceitamos as duas apresentações da fixture.
  const versions = [[128, 211, 206], [103, 169, 166]];
  const matches = (x, y) => {
    const i = (y * width + x) * channels;
    return versions.some(rgb => rgb.every((value, channel) => Math.abs(pixels[i + channel] - value) <= 3));
  };
  for (let y = 20; y < height - 20; y += 4) {
    for (let x = 20; x < width - 20; x += 4) {
      if (matches(x, y) && [-18, 0, 18].every(dy => [-18, 0, 18].every(dx => matches(x + dx, y + dy)))) {
        return { x, y };
      }
    }
  }
  return null;
}

export async function verifyCitizenTrafficNavigation({ adb, readHierarchy, waitFor, writeTextSecret, readPickerPixels, fixture, photoSource = "gallery" }) {
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
          const value = await find(await readHierarchy());
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
  assert(["gallery", "files"].includes(photoSource));
  if (photoSource === "files") {
    await press("Escolher imagem em Arquivos", true);
    const filename = "jeriflow-traffic-fixture";
    const findFile = xml => findAccessibleCenter(xml, filename + ".png") ?? findAccessibleCenter(xml, filename);
    let file;
    try {
      file = await locate("Imagem sintética em Recentes", findFile);
    } catch {
      const roots = xml => findAccessibleCenter(xml, "Show roots") ??
        findAccessibleCenter(xml, "Open navigation drawer");
      await tap(await locate("Menu de locais de Arquivos", roots));
      const device = (await adb(["shell", "getprop", "ro.product.model"])).trim();
      assert(device, "Modelo do emulador ausente");
      await press(device);
      await press("Download");
      file = await locate("Imagem sintética na pasta Download", async xml => {
        const exact = findFile(xml);
        if (!exact && /package="com\.(?:google\.)?android\.documentsui"/.test(xml)) await readPickerPixels();
        return exact;
      });
    }
    await tap(file);
  } else {
    await press("Escolher da galeria", true);
    let pickerResources = [], visiblePackages = [];
    const photoPoint = await locate("Foto sintética na galeria", async xml => {
      visiblePackages = [...new Set([...xml.matchAll(/package="([a-zA-Z0-9_.]+)"/g)].map(match => match[1]))];
      pickerResources = [...new Set([...xml.matchAll(/resource-id="([a-zA-Z0-9_.]+:id\/[a-zA-Z0-9_]+)"/g)].map(match => match[1]))];
      const exact = findAccessibleCenter(xml, "jeriflow-traffic-fixture.png");
      if (exact) return exact;
      const items = [...xml.matchAll(/<node\b[^>]*resource-id="(?:com\.google\.android\.providers\.media\.module|com\.android\.providers\.media\.module):id\/(?:icon_thumbnail|item_image)"[^>]*>/g)];
      if (items.length !== 1) {
        if (visiblePackages.length !== 1 || visiblePackages[0] !== "com.google.android.photopicker") return null;
        const { data, info } = await readPickerPixels();
        return findSyntheticPhotoCenter(data, info.width, info.height, info.channels);
      }
      const bounds = items[0][0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (!bounds) return null;
      const [, left, top, right, bottom] = bounds.map(Number);
      return { x: Math.floor((left + right) / 2), y: Math.floor((top + bottom) / 2) };
    }).catch(() => {
      throw new Error("Foto sintética ausente no seletor; IDs Android: " + pickerResources.join(", ") + "; pacotes: " + visiblePackages.join(", "));
    });
    await tap(photoPoint);
  }
  await locate("Prévia da foto", xml => findAccessibleCenter(xml, "Prévia da foto da ocorrência"), true);
  await tap(await locate("Botão de envio habilitado", xml =>
    findAccessibleCenter(xml.replace(/<node\b[^>]*enabled="false"[^>]*>/g, ""), "Enviar denúncia à SEMUS"), true));
  const hints = [
    "Conexão indisponível", "Confira o vínculo Cidadão e o município.",
    "Escolha uma foto de até 8 MB.", "Não foi possível concluir agora. Tente novamente em instantes.",
    "Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.",
    "O envio ainda não foi confirmado. Mantenha os dados e a foto ao consultar ou tentar novamente.",
    "Aguarde…", "Enviar denúncia à SEMUS",
  ];
  const feedback = new Set();
  const protocolId = await locate("Confirmação de envio", xml => {
    for (const hint of hints) if (findAccessibleCenter(xml, hint)) feedback.add(hint);
    return xml.match(/(?:text|content-desc)="Protocolo recebido: (JF-[0-9]{8}-[0-9]{6,})"/)?.[1];
  }, true).catch(error => {
    throw new Error(error.message + "; retorno visível: " + [...feedback].join(" | "));
  });
  return { protocolId, photoPreviewVisible: true, photoSource };
}
