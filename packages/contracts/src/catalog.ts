export const mobileApps = [
  { id: "cidadao", name: "JeriFlow Cidadão" },
  { id: "turista", name: "JeriFlow Turista" },
  { id: "guarda", name: "JeriFlow Guarda/SEMUS" },
  { id: "fiscal-tts", name: "JeriFlow Fiscal TTS" },
] as const;
export const adminPanels = [
  { id: "mestre", name: "Admin Mestre" },
  { id: "turismo", name: "Admin Turismo/Estacionamento" },
  { id: "cidadao", name: "Admin Cidadão/Ouvidoria" },
  { id: "semus", name: "Admin SEMUS" },
  { id: "conteudo", name: "Admin Conteúdo" },
  { id: "dashboard", name: "Admin Dashboard" },
  { id: "studio", name: "JeriFlow Studio" },
] as const;
export type MobileAppId = typeof mobileApps[number]["id"];
// Catálogo de componentes, não uma matriz de autorização.
