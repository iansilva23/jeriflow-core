/**
 * A V5.16 usa imageFileToData(file,1200,.7) ao registrar foto em
 * shared/jeriflow-audit-citizen.js (evidence(file)).
 * A origem da função é o protótipo HTML/JS, que desenha a imagem no canvas,
 * diminui LARGURA até 1200px sem ampliar e prioriza WebP de qualidade 0.7.
 *
 * Esta versão de servidor APENAS decodifica/reencoda, remove metadados e
 * devolve bytes em memória. Não é um antivírus, armazenamento ou protocolo.
 * Não expor esta função como API pública.
 */
import {createHash} from "node:crypto";
import sharp from "sharp";
import {examineTrafficPhotoCandidate, TRAFFIC_PHOTO_MAX_BYTES} from "./traffic-photo-candidate.ts";

export const TRAFFIC_IMAGE_MAX_WIDTH_V516 = 1200;
export const TRAFFIC_IMAGE_QUALITY_V516 = 70;
const MAX_DECODED_PIXELS = 80_000_000; // Proteção técnica contra descompressão excessiva.
const MAX_OUTPUT_BYTES = TRAFFIC_PHOTO_MAX_BYTES;

export class TrafficImageNormalizationError extends Error {
  readonly code: "INVALID_IMAGE" | "UNSUPPORTED_IMAGE_DECODER" | "NORMALIZED_IMAGE_TOO_LARGE";
  constructor(code: TrafficImageNormalizationError["code"]) {
    super(code);
    this.code=code;
  }
}

export type TrafficNormalizedUnscannedV516 = Readonly<{
  /** Uso exclusivamente interno; não expor ao navegador antes da aprovação. */
  bytes: Buffer;
  mime: "image/webp" | "image/jpeg";
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
  state: "normalized_unscanned";
  imageDecoded: true;
  metadataRemoved: true;
  malwareScanned: false;
  evidenceApproved: false;
  protocolCreated: false;
}>;

async function encodeWithoutMetadata(input: Buffer, format: "webp" | "jpeg") {
  const pipeline=sharp(input,{failOn:"error",limitInputPixels:MAX_DECODED_PIXELS,
    animated:false,sequentialRead:true})
    .rotate() // Corrige orientação EXIF antes da remoção dos metadados.
    .resize({width:TRAFFIC_IMAGE_MAX_WIDTH_V516,withoutEnlargement:true});
  // sharp remove EXIF/IPTC/XMP/ICC por padrão quando não se chama withMetadata().
  return format==="webp"
    ? pipeline.webp({quality:TRAFFIC_IMAGE_QUALITY_V516}).toBuffer()
    : pipeline.flatten({background:"#ffffff"}).jpeg({quality:TRAFFIC_IMAGE_QUALITY_V516}).toBuffer();
}

/**
 * Decodifica uma imagem candidata (que pode vir de câmera ou galeria)
 * e devolve uma representação sem metadados. Ainda NÃO é evidência aprovada.
 *
 * Falha fechada para HEIC/AVIF quando o codec não está disponível no servidor;
 * não trata uma assinatura reconhecida como garantia de decodificação.
 */
export async function normalizeTrafficPhotoV516(
  raw: Uint8Array,
  declaredMime?: unknown,
): Promise<TrafficNormalizedUnscannedV516> {
  // 1. Respeita limite exato de 8MiB do HTML, não confia no MIME informado.
  examineTrafficPhotoCandidate(raw,declaredMime);
  const original=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength);
  let metadata: sharp.Metadata;
  try {
    metadata=await sharp(original,{failOn:"error",limitInputPixels:MAX_DECODED_PIXELS,
      animated:false,sequentialRead:true}).metadata();
    if(!metadata.width||!metadata.height||
       metadata.width<1||metadata.height<1||
       metadata.width*metadata.height>MAX_DECODED_PIXELS ||
       !["jpeg","png","webp","gif","heif","avif"].includes(metadata.format))
      throw new Error("UNSUPPORTED_DECODE");
  } catch {
    throw new TrafficImageNormalizationError("INVALID_IMAGE");
  }

  let bytes:Buffer;
  let mime:"image/webp"|"image/jpeg"="image/webp";
  try {
    bytes=await encodeWithoutMetadata(original,"webp");
  } catch {
    // Equivale ao fallback do canvas da V5.16 em browsers sem encode WebP.
    try {
      bytes=await encodeWithoutMetadata(original,"jpeg");
      mime="image/jpeg";
    } catch {
      throw new TrafficImageNormalizationError("UNSUPPORTED_IMAGE_DECODER");
    }
  }
  if(bytes.length===0||bytes.length>MAX_OUTPUT_BYTES)
    throw new TrafficImageNormalizationError("NORMALIZED_IMAGE_TOO_LARGE");

  try {
    // Confere o arquivo realmente produzido; EXIF/GPS não podem sobreviver.
    const result=await sharp(bytes,{failOn:"error",limitInputPixels:MAX_DECODED_PIXELS}).metadata();
    if(!result.width||!result.height||result.width>TRAFFIC_IMAGE_MAX_WIDTH_V516||
       result.height<1||result.exif||result.xmp||result.iptc||result.icc||
       (mime==="image/webp"&&result.format!=="webp")||
       (mime==="image/jpeg"&&result.format!=="jpeg"))
      throw new Error("OUTPUT_UNSAFE");
    return Object.freeze({
      bytes, mime, width:result.width,height:result.height,
      sha256:createHash("sha256").update(bytes).digest("hex"),
      byteLength:bytes.length,
      state:"normalized_unscanned" as const,imageDecoded:true as const,
      metadataRemoved:true as const,malwareScanned:false as const,
      evidenceApproved:false as const,protocolCreated:false as const,
    });
  } catch {
    throw new TrafficImageNormalizationError("INVALID_IMAGE");
  }
}

/**
 * Integração INTERNA com quarentena, sem expor o caminho da foto.
 * Não remove nem aprova o bruto: limpeza e varredura ainda são próximas fases.
 */
export async function normalizeQuarantinedTrafficPhotoV516(
  source: {readUntrustedForProcessor(id:string):Promise<Buffer>},
  ticketId:string,
): Promise<TrafficNormalizedUnscannedV516> {
  const untrusted=await source.readUntrustedForProcessor(ticketId);
  return normalizeTrafficPhotoV516(untrusted);
}
