import type { IncomingMessage } from "node:http";
import { sessionHash, uuid } from "./identity-primitives.ts";
import { TRAFFIC_PHOTO_MAX_BYTES } from "./traffic-photo-candidate.ts";
import { TrafficFormSubmissionErrorV516, type TrafficRegisteredFormServiceV516 } from "./traffic-form-submit-v516.ts";

export type TrafficFormHttpServiceV516 = Pick<TrafficRegisteredFormServiceV516, "submitRegistered" | "assertSession">;

export async function submitTrafficFormHttpV516(req: IncomingMessage, service: TrafficFormHttpServiceV516) {
  let sessionToken: string;
  let municipalityId: string;
  try {
    const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    if (!bearer) throw new Error();
    sessionToken = bearer[1];
    sessionHash(sessionToken);
    municipalityId = uuid(req.headers["x-jeriflow-municipality-id"]);
  } catch {
    return { status: 401, body: { error: "TRAFFIC_SESSION_REQUIRED" } };
  }

  const type = req.headers["content-type"];
  if (req.headers["content-encoding"] !== undefined || !type?.startsWith("multipart/form-data;")) {
    return { status: 415, body: { error: "TRAFFIC_FORM_CONTENT_TYPE_REQUIRED" } };
  }
  const maxBytes = TRAFFIC_PHOTO_MAX_BYTES + 32 * 1024;
  const size = req.headers["content-length"];
  if (!size || !/^\d+$/.test(size)) return { status: 411, body: { error: "TRAFFIC_FORM_LENGTH_REQUIRED" } };
  if (Number(size) > maxBytes) return { status: 413, body: { error: "TRAFFIC_FORM_TOO_LARGE" } };

  try {
    await service.assertSession(municipalityId, sessionToken);
  } catch {
    return { status: 403, body: { error: "TRAFFIC_SESSION_DENIED" } };
  }

  let form: FormData;
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > maxBytes) return { status: 413, body: { error: "TRAFFIC_FORM_TOO_LARGE" } };
      chunks.push(bytes);
    }
    if (total !== Number(size)) return { status: 400, body: { error: "INVALID_TRAFFIC_FORM" } };
    form = await new Response(new Uint8Array(Buffer.concat(chunks, total)), { headers: { "Content-Type": type } }).formData();
  } catch {
    return { status: 400, body: { error: "INVALID_TRAFFIC_FORM" } };
  }

  const title = form.get("title");
  const location = form.get("location");
  const description = form.get("description");
  const plate = form.get("plate");
  const photo = form.get("photo");
  const fields = new Set(["title", "location", "description", "plate", "photo"]);
  for (const field of form.keys()) {
    if (!fields.delete(field)) return { status: 400, body: { error: "INVALID_TRAFFIC_FORM" } };
  }
  if (typeof title !== "string" || typeof location !== "string" || typeof description !== "string"
      || (plate !== null && typeof plate !== "string") || !(photo instanceof File) || !photo.size) {
    return { status: 400, body: { error: "INVALID_TRAFFIC_FORM" } };
  }
  if (photo.size > TRAFFIC_PHOTO_MAX_BYTES) return { status: 413, body: { error: "TRAFFIC_FORM_TOO_LARGE" } };

  try {
    const body = await service.submitRegistered({
      municipalityId, sessionToken, title, location, description,
      plate: plate ?? undefined, photoBytes: new Uint8Array(await photo.arrayBuffer()),
    });
    return { status: 200, body };
  } catch (error) {
    if (!(error instanceof TrafficFormSubmissionErrorV516)) {
      return { status: 503, body: { error: "TRAFFIC_SUBMISSION_UNAVAILABLE" } };
    }
    const status = {
      INVALID_TRAFFIC_FORM: 400,
      TRAFFIC_SESSION_DENIED: 403,
      TRAFFIC_SUBMISSION_REJECTED: 422,
      TRAFFIC_SUBMISSION_UNAVAILABLE: 503,
      TRAFFIC_SUBMISSION_UNCERTAIN: 503,
      TRAFFIC_SUBMISSION_IN_PROGRESS: 409,
    }[error.code];
    return { status, body: { error: error.code } };
  }
}
