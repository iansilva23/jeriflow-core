/**
 * Entrypoint privado para uso FUTURO do worker na homologação.
 * A foto obrigatória da V5.16 não recebe nenhuma etapa nova na interface.
 * Falha fechada se FreshClam não provisionou bases oficiais assinadas e atuais.
 *
 * Não é rota de upload nem serviço já ligado ao aplicativo.
 */
import {checkOfficialClamAVDatabasesV516} from "./clamav-official-readiness-v516.ts";
import {assertClamdLoadsOfficialDailyV516} from "./clamav-daemon-live-v516.ts";
import {TrafficPhotoVerificationWorkerV516} from "./traffic-photo-verified-worker-v516.ts";
import type {CleanPhotoTicketV516} from "./traffic-photo-clean-store-v516.ts";
import type {VerifiedPhotoGateTicketV516} from "./traffic-photo-verified-worker-v516.ts";

export class OfficialTrafficPhotoWorkerV516 {
  private readonly inner:TrafficPhotoVerificationWorkerV516;
  private readonly databaseDirectory:string;
  private readonly clamdSocketPath:string;
  private constructor(
    inner:TrafficPhotoVerificationWorkerV516,
    databaseDirectory:string,
    clamdSocketPath:string,
  ) {
    this.inner=inner;
    this.databaseDirectory=databaseDirectory;
    this.clamdSocketPath=clamdSocketPath;
  }
  static async openPrivate(config:Readonly<{
    photoRoot:string;
    clamdSocketPath:string;
    workerDatabaseUrl:string;
    officialDatabaseDirectory:string;
  }>):Promise<OfficialTrafficPhotoWorkerV516>{
    // Acesso negado ANTES de abrir conexão com a credencial privada do worker.
    await checkOfficialClamAVDatabasesV516(config.officialDatabaseDirectory);
    await assertClamdLoadsOfficialDailyV516({socketPath:config.clamdSocketPath,databaseDirectory:config.officialDatabaseDirectory});
    const inner=await TrafficPhotoVerificationWorkerV516.openPrivate(config);
    return new OfficialTrafficPhotoWorkerV516(inner,config.officialDatabaseDirectory,config.clamdSocketPath);
  }
  async verifyAndRegister(ticket:CleanPhotoTicketV516):Promise<VerifiedPhotoGateTicketV516>{
    // Revalidar: bases podem expirar ou sumir depois da inicialização.
    const check=()=>assertClamdLoadsOfficialDailyV516({socketPath:this.clamdSocketPath,databaseDirectory:this.databaseDirectory});
    await check();
    return await this.inner.verifyAndRegister(ticket,async()=>{await check();});
  }
  async close():Promise<void>{await this.inner.close();}
}
