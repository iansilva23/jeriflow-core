import { gateway } from "../../../../lib/gateway";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return gateway(request, "/" + path.join("/"));
}
export { handle as GET, handle as POST };
