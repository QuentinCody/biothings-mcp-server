import { decodeResponseText, readResponseBytes } from "@bio-mcp/shared/http/response-reader";

/** Annotation APIs require bounded, complete JSON, including native HTTP error evidence. */
export async function readBioThings(response: Response): Promise<{ status: number; data: unknown }> {
  let text: string;
  try {
    text = decodeResponseText(await readResponseBytes(response, { label: "BioThings", maxBytes: 4 * 1024 * 1024, timeoutMs: 10000 }), "BioThings");
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? error.status : 502;
    const message = status === 413 ? "BioThings response exceeds 4 MiB; narrow the query or use provider bulk transfer" : status === 504 ? "BioThings body read exceeded 10 seconds" : String(error);
    throw Object.assign(new Error(message), { status: response.ok ? status : response.status,
      data: { http_status: response.status, body_unavailable: true, retry_after: response.headers.get("retry-after"), body_error: message } });
  }
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`), { status: response.status, data: text });
  if (response.status !== 200 || response.headers.has("content-range")) throw Object.assign(new Error("BioThings returned a partial representation"), { status: 502, data: text });
  if (!response.headers.get("content-type")?.includes("json")) throw Object.assign(new Error("Expected BioThings JSON, not an upstream error page"), { status: 502, data: text });
  try { return { status: response.status, data: JSON.parse(text.replace(/^\uFEFF/, "")) }; }
  catch { throw Object.assign(new Error("BioThings returned malformed JSON"), { status: 502, data: text }); }
}
