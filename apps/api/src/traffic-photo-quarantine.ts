/**
 * Infraestrutura PRIVADA e TEMPORÁRIA para a foto obrigatória do formulário de trânsito V5.16.
 * Referência: cidadao-ai/index.html trafficCameraInput/trafficGalleryInput e
 * shared/jeriflow-audit-citizen.js evidence(file) (limite original de 8 MiB).
 *
 * Não exporta rota HTTP, URL, aceite de evidência, nem cria protocolo.
 * A mídia BRUTA permanece não confiável até um processador isolado decodificar,
 * reencodar sem EXIF, executar a verificação de segurança e persistir a evidência
 * associada ao protocolo canônico. Nunca servir este diretório pelo web server.
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  examineTrafficPhotoCandidate,
  type TrafficPhotoCandidate,
} from "./traffic-photo-candidate.ts";

const QUARANTINE_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.quarantine$/;
const PRIVATE_FILE_MODE = 0o600;
export type QuarantineTicketV516 = Readonly<{
  id: string;
  sha256: string;
  byteLength: number;
  mime: TrafficPhotoCandidate["mime"];
  state: "quarantined_unverified";
  imageDecoded: false;
  metadataRemoved: false;
  malwareScanned: false;
  evidenceApproved: false;
  protocolCreated: false;
}>;

export class TrafficQuarantineError extends Error {
  readonly code: "PRIVATE_STORAGE_REQUIRED" | "INVALID_QUARANTINE_ID" | "QUARANTINE_WRITE_FAILED";
  constructor(code: TrafficQuarantineError["code"]) {
    super(code); this.code=code;
  }
}

function validId(id: unknown): id is string {
  return typeof id === "string" && QUARANTINE_FILE.test(id + ".quarantine");
}
function requireId(id: unknown): string {
  if (!validId(id)) throw new TrafficQuarantineError("INVALID_QUARANTINE_ID");
  return id;
}
async function requirePrivateDirectory(dir: string): Promise<void> {
  if (!dir || typeof dir !== "string") throw new TrafficQuarantineError("PRIVATE_STORAGE_REQUIRED");
  let stat;
  try { stat=await lstat(dir); }
  catch { throw new TrafficQuarantineError("PRIVATE_STORAGE_REQUIRED"); }
  // Nunca mudar permissões automaticamente de um diretório público ou seguir symlink.
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new TrafficQuarantineError("PRIVATE_STORAGE_REQUIRED");
}
function candidateTicket(id: string, item: TrafficPhotoCandidate): QuarantineTicketV516 {
  return Object.freeze({id, sha256:item.sha256, byteLength:item.byteLength, mime:item.mime,
    state:"quarantined_unverified",imageDecoded:false,metadataRemoved:false,
    malwareScanned:false,evidenceApproved:false,protocolCreated:false});
}

/** Esta classe é usada apenas pelo backend confiável, nunca como API pública. */
export class TrafficPhotoQuarantineV516 {
  private readonly tracked = new Map<string,{ sha256:string; byteLength:number }>();
  private constructor(private readonly directory: string) {}
  static async openPrivate(directory: string) {
    await requirePrivateDirectory(directory);
    return new TrafficPhotoQuarantineV516(directory);
  }
  /**
   * Escreve bytes brutos num diretório já provisionado (0700), sem symlinks.
   * O ticket não expõe caminho e não serve como evidência aprovada.
   */
  async stage(bytes: Uint8Array, suppliedMime?: unknown): Promise<QuarantineTicketV516> {
    const item=examineTrafficPhotoCandidate(bytes,suppliedMime);
    await requirePrivateDirectory(this.directory);
    const id=randomUUID(), file=join(this.directory,id+".quarantine");
    let handle;
    try {
      handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,PRIVATE_FILE_MODE);
      await handle.writeFile(bytes);
      await handle.sync();
    } catch {
      if (handle) {try {await handle.close();} catch {} try {await unlink(file);} catch {}}
      throw new TrafficQuarantineError("QUARANTINE_WRITE_FAILED");
    } finally {
      if (handle) try {await handle.close();} catch {}
    }
    this.tracked.set(id,{sha256:item.sha256,byteLength:item.byteLength});
    return candidateTicket(id,item);
  }
  /**
   * Acesso SOMENTE para um decodificador/higienizador confiável no backend.
   * Nunca fazer proxy do resultado ao Cidadão, Guarda ou navegador.
   */
  async readUntrustedForProcessor(id: string): Promise<Buffer> {
    id=requireId(id);
    const expected=this.tracked.get(id);
    if (!expected) throw new TrafficQuarantineError("INVALID_QUARANTINE_ID");
    await requirePrivateDirectory(this.directory);
    const path=join(this.directory,id+".quarantine");
    const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const stat=await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 ||
        stat.size!==expected.byteLength)
        throw new TrafficQuarantineError("PRIVATE_STORAGE_REQUIRED");
      return await handle.readFile();
    } finally {await handle.close();}
  }
  /** Descarta a amostra bruta após o uso ou cancelamento, nunca um protocolo. */
  async discard(id: string): Promise<void> {
    id=requireId(id);
    if (!this.tracked.has(id)) throw new TrafficQuarantineError("INVALID_QUARANTINE_ID");
    await requirePrivateDirectory(this.directory);
    try {await unlink(join(this.directory,id+".quarantine"));}
    finally {this.tracked.delete(id);}
  }
  /**
   * Limpeza de arquivos órfãos antigos, para execução programada no backend.
   * Apenas o padrão de nome gerado internamente é considerado.
   * O método não é acionado pelo visitante e não apaga protocolos/evidências.
   */
  async removeExpiredOrphans(olderThanMs: number, now=Date.now()): Promise<number> {
    if (!Number.isSafeInteger(olderThanMs) || olderThanMs <= 0 ||
        !Number.isFinite(now)) throw new TrafficQuarantineError("PRIVATE_STORAGE_REQUIRED");
    await requirePrivateDirectory(this.directory);
    let removed=0;
    for(const filename of await readdir(this.directory)){
      if(!QUARANTINE_FILE.test(filename)) continue;
      const id=filename.slice(0,-".quarantine".length);
      if(this.tracked.has(id)) continue; // Nunca apagar arquivo ainda usado neste processo.
      const path=join(this.directory,filename);
      const meta=await lstat(path);
      if(meta.isSymbolicLink() || !meta.isFile()) continue;
      if(now-meta.mtimeMs>=olderThanMs) {
        await unlink(path);removed++;
      }
    }
    return removed;
  }
}
