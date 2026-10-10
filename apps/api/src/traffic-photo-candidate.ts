/**
 * V5.16: o cidadão escolhe foto da câmera OU galeria em #trafficCameraInput/#trafficGalleryInput.
 * Esta etapa valida uma CANDIDATA recebida pelo servidor, NÃO uma foto armazenada/limpa.
 * Sem upload público, sessão, filesystem, banco ou publicação nesta unidade.
 * ZIP V5.16 SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 */
import { createHash } from "node:crypto";

export const TRAFFIC_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export type TrafficPhotoMime = "image/jpeg" | "image/png" | "image/webp" |
  "image/heic" | "image/heif" | "image/avif" | "image/gif";
export type TrafficPhotoCandidate = Readonly<{
  sha256: string;
  byteLength: number;
  mime: TrafficPhotoMime;
  trust: "untrusted";
  stored: false;
  scanned: false;
  metadataRemoved: false;
  protocolCreated: false;
}>;
export class TrafficPhotoCandidateError extends Error {
  constructor(public readonly code: "INVALID_PHOTO" | "PHOTO_TOO_LARGE" |
    "UNSUPPORTED_PHOTO_FORMAT" | "PHOTO_MIME_MISMATCH") {
    super(code);
  }
}
function prefix(b: Buffer, offset: number, signature: readonly number[]): boolean {
  return signature.every((v, i) => b[offset + i] === v);
}
function ascii(b: Buffer, offset: number, length: number) {
  return b.toString("ascii", offset, offset + length);
}
function plausibleDimension(w: number, h: number): boolean {
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 &&
    w <= 32768 && h <= 32768;
}
function sniff(b: Buffer): TrafficPhotoMime | null {
  // JPEG SOI + EOI: checagem inicial de assinatura, NÃO decodificação integral.
  if (b.length >= 64 && prefix(b, 0, [0xff,0xd8,0xff]) &&
      prefix(b, b.length - 2, [0xff,0xd9])) return "image/jpeg";
  // PNG: assinatura + primeiro IHDR 13 + dimensões positivas + IEND.
  if (b.length >= 57 && prefix(b, 0, [137,80,78,71,13,10,26,10]) &&
      b.readUInt32BE(8) === 13 && ascii(b, 12, 4) === "IHDR" &&
      plausibleDimension(b.readUInt32BE(16), b.readUInt32BE(20)) &&
      b.readUInt32BE(b.length - 12) === 0 && ascii(b,b.length - 8,4) === "IEND") return "image/png";
  // WebP: RIFF do tipo WEBP; valida tamanho declarado e chunk conhecido.
  if (b.length >= 30 && ascii(b,0,4) === "RIFF" && ascii(b,8,4) === "WEBP" &&
      b.readUInt32LE(4) + 8 === b.length &&
      ["VP8 ","VP8L","VP8X"].includes(ascii(b,12,4))) return "image/webp";
  // GIF de galeria: apenas identifica o contêiner; gif animado exige decodificação/limpeza posterior.
  if (b.length >= 20 && ["GIF87a","GIF89a"].includes(ascii(b,0,6)) &&
      plausibleDimension(b.readUInt16LE(6),b.readUInt16LE(8)) &&
      b[b.length-1] === 0x3b) return "image/gif";
  // iOS pode enviar HEIC/HEIF/AVIF. O bitstream ainda precisa ser decodificado e higienizado.
  if (b.length >= 32 && ascii(b,4,4) === "ftyp" &&
      b.readUInt32BE(0) >= 16 && b.readUInt32BE(0) <= b.length) {
    const brand=ascii(b,8,4);
    if (["heic","heix","hevc","heim","heis"].includes(brand)) return "image/heic";
    if (["mif1","msf1"].includes(brand)) return "image/heif";
    if (["avif","avis"].includes(brand)) return "image/avif";
  }
  return null;
}
function declaredMime(mime: unknown): TrafficPhotoMime | null {
  if (mime === undefined || mime === null || mime === "") return null;
  if (typeof mime !== "string" || mime.length > 100) throw new TrafficPhotoCandidateError("INVALID_PHOTO");
  const trimmed=mime.trim().toLowerCase();
  if (trimmed === "image/jpg") return "image/jpeg";
  if (trimmed === "image/heif-sequence") return "image/heif";
  if (trimmed === "image/heic-sequence") return "image/heic";
  if (!["image/jpeg","image/png","image/webp","image/heic","image/heif","image/avif","image/gif"].includes(trimmed))
    throw new TrafficPhotoCandidateError("UNSUPPORTED_PHOTO_FORMAT");
  return trimmed as TrafficPhotoMime;
}
/**
 * Nunca aceita MIME/filename por si só: confere assinatura e limites. Continua NÃO CONFIÁVEL.
 * O adaptador real deverá posteriormente decodificar imagem, remover EXIF/metadados,
 * submeter a varredura antimalware e gravar em armazenamento isolado por município
 * antes de poder vincular a evidência a um protocolo.
 */
export function examineTrafficPhotoCandidate(bytes: unknown, suppliedMime?: unknown): TrafficPhotoCandidate {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20)
    throw new TrafficPhotoCandidateError("INVALID_PHOTO");
  if (bytes.byteLength > TRAFFIC_PHOTO_MAX_BYTES)
    throw new TrafficPhotoCandidateError("PHOTO_TOO_LARGE");
  const buffer=Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mime=sniff(buffer);
  if (!mime) throw new TrafficPhotoCandidateError("UNSUPPORTED_PHOTO_FORMAT");
  const claimed=declaredMime(suppliedMime);
  if (claimed && claimed !== mime && !(mime === "image/heic" && claimed === "image/heif"))
    throw new TrafficPhotoCandidateError("PHOTO_MIME_MISMATCH");
  return Object.freeze({sha256:createHash("sha256").update(buffer).digest("hex"),
    byteLength:buffer.byteLength,mime,trust:"untrusted",stored:false,scanned:false,
    metadataRemoved:false,protocolCreated:false});
}
