import { CitizenAccountsV516 } from "./citizen-accounts-v516.ts";
import { OfficialTrafficPhotoWorkerV516 } from "./traffic-photo-official-worker-v516.ts";
import { TrafficPhotoOwnershipV516 } from "./traffic-photo-ownership-v516.ts";
import { TrafficPhotoPrivatePipelineV516, createPrivateTrafficPhotoHttpAdapterV516 } from "./traffic-photo-private-pipeline-v516.ts";
import type { LocalConfiguration } from "./infrastructure.ts";

export async function openLocalTrafficPhotoRuntimeV516(config: LocalConfiguration, env: NodeJS.ProcessEnv) {
  if (env.JF_TRAFFIC_PHOTO_LOCAL !== "1") return undefined;

  const quarantineDirectory = env.JF_TRAFFIC_PHOTO_QUARANTINE;
  const photoRoot = env.JF_TRAFFIC_PHOTO_STORE;
  const clamdSocketPath = env.JF_TRAFFIC_CLAMD_SOCKET;
  const officialDatabaseDirectory = env.JF_TRAFFIC_CLAMAV_DATABASES;
  const workerDatabaseUrl = env.JF_TRAFFIC_WORKER_DATABASE_URL;
  if (!quarantineDirectory || !photoRoot || !clamdSocketPath || !officialDatabaseDirectory || !workerDatabaseUrl) {
    throw new Error("Configuração local de fotos de trânsito incompleta.");
  }
  try {
    const url = new URL(workerDatabaseUrl);
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55432"
      || url.pathname !== "/jeriflow_dev" || !url.username || !url.password || url.search || url.hash
      || url.username === "jeriflow_app" || url.username === "jeriflow_owner") throw new Error();
  } catch {
    throw new Error("A conexão do scanner deve usar uma conta separada no PostgreSQL local.");
  }

  const worker = await OfficialTrafficPhotoWorkerV516.openPrivate({
    photoRoot, clamdSocketPath, workerDatabaseUrl, officialDatabaseDirectory,
  });
  const ownership = new TrafficPhotoOwnershipV516(config.databaseUrl);
  const accounts = new CitizenAccountsV516(config.databaseUrl);
  async function close() {
    const results = await Promise.allSettled([worker.close(), ownership.close(), accounts.close()]);
    if (results.some(result => result.status === "rejected")) throw new Error("Falha ao encerrar o serviço de fotos.");
  }
  try {
    const pipeline = await TrafficPhotoPrivatePipelineV516.openPrivate({
      quarantineDirectory, cleanPhotoRoot: photoRoot, ownership, worker,
    });
    return {
      http: createPrivateTrafficPhotoHttpAdapterV516({ resolveSession: accounts.resolveSession.bind(accounts), pipeline }),
      close,
    };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
