import { afterEach, expect, it, vi } from "vitest";
import { createBioThingsApiFetch } from "./api-adapter";
import { readBioThings } from "./read";
import { batchResolve } from "./batch";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([
  new Response("<html>unavailable</html>"),
  new Response("{bad", { headers: { "content-type": "application/json" } }),
  new Response('{"hits":[]}', { status: 206, headers: { "content-type": "application/json", "content-range": "bytes 0-10/40" } }),
])("rejects non-JSON, malformed and partial success without inventing no-match results", async response => {
  await expect(readBioThings(response)).rejects.toMatchObject({ status: 502, data: expect.any(String) });
});

it("bounds actual response bytes and rejects malformed UTF-8 while preserving native HTTP status", async () => {
  await expect(readBioThings(new Response("x".repeat(4 * 1024 * 1024 + 1)))).rejects.toMatchObject({ status: 413, data: { body_unavailable: true } });
  await expect(readBioThings(new Response(new Uint8Array([0xff]), { status: 429, headers: { "retry-after": "12" } }))).rejects.toMatchObject({ status: 429, data: { http_status: 429, retry_after: "12", body_unavailable: true } });
});

it("enforces the body deadline even when stream cancellation does not settle", async () => {
  vi.useFakeTimers();
  const stream = new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) });
  const pending = expect(readBioThings(new Response(stream, { status: 503 }))).rejects.toMatchObject({ status: 503, data: { body_unavailable: true } });
  await vi.advanceTimersByTimeAsync(10001); await pending;
});

it("preserves native application errors carried inside HTTP 200", async () => {
  const native = { error: "native failure", details: ["all", "details"] };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  await expect(createBioThingsApiFetch()({ method: "GET", path: "/taxon/query", params: { q: "x" } })).rejects.toMatchObject({ status: 502, data: { http_status: 200, native } });
});

it("rejects malformed batch rows instead of reporting them as found", async () => {
  const native = [{ query: "x", error: "native error" }];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  await expect(batchResolve(["x"], "gene")).rejects.toMatchObject({ status: 502, data: { completed_results: [], failed_inputs: ["x"], native, partial: true } });
});
