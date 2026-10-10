/**
 * V5.16: fotografia obrigatória em trafficForm do App Cidadão.
 * Fontes: cidadao-ai/index.html e shared/jeriflow-audit-citizen.js:
 * evidence(file) = limite 8 MiB; imageFileToData(file,1200,.7).
 *
 * Este MÓDULO INTERNO decodifica e reencoda; NÃO aprova evidência, NÃO cria
 * protocolo e NÃO publica URL. Sem HTTP, sem banco, sem dados reais.
 */
import {createHash} from "node:crypto";
import sharp from "sharp";
import {
  examineTrafficPhotoCandidate,TRAFFIC_PHOTO_MAX_BYTES,
  type TrafficPhotoMime,
} from "./traffic-photo-candidate.ts";
import {TrafficPhotoQuarantineV516} from "./traffic-photo-quarantine.ts";

// Limite técnico de descompressão (80 MP), não uma regra do HTML. Inclui fotos de 48 MP de celulares atuais.
const MAX_INPUT_PIXELS = 80_000_000;
const V516_MAX_WIDTH = 1200;
const V516_QUALITY = 70;
type DecodedMetadata = Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
export class TrafficPhotoNormalizeError extends Error {
  readonly code: "PHOTO_DECODE_FAILED" | "PHOTO_DIMENSIONS_UNSAFE" |
    "PHOTO_METADATA_RETAINED" | "PHOTO_OUTPUT_TOO_LARGE";
  constructor(code: TrafficPhotoNormalizeError["code"]) {
    super(code);this.code=code;
  }
}
export type NormalizedTrafficPhotoV516 = Readonly<{
  // Apenas no processo protegido; nunca enviar bytes ao cliente.
  bytes: Buffer;
  sha256: string;
  originalSha256: string;
  byteLength: number;
  width: number;
  height: number;
  mime: "image/webp";
  maxWidthFromV516: 1200;
  qualityFromV516: 70;
  sourceMime: TrafficPhotoMime;
  imageDecoded: true;
  metadataRemoved: true;
  stored: false;
  malwareScanned: false;
  evidenceApproved: false;
  protocolCreated: false;
}>;

function formatAllowed(actual: string | undefined, sniffed: TrafficPhotoMime): boolean {
  if (!actual) return false;
  const formatToMime: Record<string,TrafficPhotoMime> = {
    jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",
    heif:"image/heif",avif:"image/avif",
  };
  if (actual==="heif" && (sniffed==="image/heic"||sniffed==="image/heif"||sniffed==="image/avif")) return true;
  return formatToMime[actual]===sniffed;
}
/** Nunca exponha este resultado como foto aprovada ou evidência armazenada. */
export async function normalizeUntrustedTrafficPhotoV516(
  quarantine:TrafficPhotoQuarantineV516,
  ticketId:string,
  claimedMime?:unknown,
):Promise<NormalizedTrafficPhotoV516> {
  // O ticket tem que ter sido emitido pela mesma instância protegida da quarentena.
  const input=await quarantine.readUntrustedForProcessor(ticketId);
  const candidate=examineTrafficPhotoCandidate(input,claimedMime);
  let meta:DecodedMetadata;
  try {
    // failOn:"error" falha fechado para dados incompletos e
    // limitInputPixels impede expansão excessiva antes da decodificação.
    meta=await sharp(input,{failOn:"error",limitInputPixels:MAX_INPUT_PIXELS,
      animated:false,pages:1}).metadata();
  }catch{
    throw new TrafficPhotoNormalizeError("PHOTO_DECODE_FAILED");
  }
  if (!meta.width||!meta.height||meta.width<1||meta.height<1||
    meta.width*meta.height>MAX_INPUT_PIXELS)
    throw new TrafficPhotoNormalizeError("PHOTO_DIMENSIONS_UNSAFE");
  if (!formatAllowed(meta.format,candidate.mime))
    throw new TrafficPhotoNormalizeError("PHOTO_DECODE_FAILED");
  let clean:Buffer;
  try {
    // Autorrotaciona pelo EXIF antes de remover os metadados.
    // .webp() gera arquivo novo: não usa withMetadata(), keepExif(), nem keepIccProfile().
    clean=await sharp(input,{failOn:"error",limitInputPixels:MAX_INPUT_PIXELS,
      animated:false,pages:1})
      .rotate()
      .resize({width:V516_MAX_WIDTH,withoutEnlargement:true})
      .webp({quality:V516_QUALITY,effort:4,lossless:false})
      .toBuffer();
  }catch {
    throw new TrafficPhotoNormalizeError("PHOTO_DECODE_FAILED");
  }
  if (clean.length===0||clean.length>TRAFFIC_PHOTO_MAX_BYTES)
    throw new TrafficPhotoNormalizeError("PHOTO_OUTPUT_TOO_LARGE");
  let output:DecodedMetadata;
  try {
    output=await sharp(clean,{failOn:"error",limitInputPixels:MAX_INPUT_PIXELS}).metadata();
  }catch {
    throw new TrafficPhotoNormalizeError("PHOTO_DECODE_FAILED");
  }
  if (output.format!=="webp"||!output.width||!output.height||
      output.width>V516_MAX_WIDTH || output.width*output.height>MAX_INPUT_PIXELS)
    throw new TrafficPhotoNormalizeError("PHOTO_DIMENSIONS_UNSAFE");
  if (output.exif||output.icc||output.xmp||output.iptc||output.orientation)
    throw new TrafficPhotoNormalizeError("PHOTO_METADATA_RETAINED");
  return Object.freeze({
    bytes:clean,
    sha256:createHash("sha256").update(clean).digest("hex"),
    originalSha256:candidate.sha256,
    byteLength:clean.length,width:output.width,height:output.height,
    mime:"image/webp" as const,maxWidthFromV516:1200 as const,qualityFromV516:70 as const,
    sourceMime:candidate.mime,imageDecoded:true as const,metadataRemoved:true as const,
    stored:false as const,malwareScanned:false as const,evidenceApproved:false as const,
    protocolCreated:false as const,
  });
}
