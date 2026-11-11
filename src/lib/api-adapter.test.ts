import { afterEach, describe, expect, it, vi } from "vitest";
import { createBioThingsApiFetch } from "./api-adapter";

afterEach(() => vi.unstubAllGlobals());
const api = createBioThingsApiFetch();

describe("BioThings service routing", () => {
  it.each([["gene", "mygene", "v3"], ["variant", "myvariant", "v1"], ["chem", "mychem", "v1"], ["disease", "mydisease", "v1"], ["taxon", "mytaxon", "v1"]])("routes %s metadata without losing source release/license fields", async (prefix, host, version) => {
    const metadata = { build_version: "20260903", build_date: "2026-09-03", src: { taxonomy: { version: "20260903", download_date: "2026-09-03", license_url: "https://example.org/license" } } };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(metadata)); vi.stubGlobal("fetch", fetchMock);
    expect((await api({ method: "GET", path: `/${prefix}/metadata` })).data).toEqual(metadata);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://${host}.info/${version}/metadata`);
  });
  it.each(["disease", "taxon"])("form-encodes %s batches and retains ambiguous hits and notfound entries", async prefix => {
    const result = [{ query: "name", _id: "1", _score: 2 }, { query: "name", _id: "2", _score: 1 }, { query: "missing", notfound: true }];
    const fetchMock = vi.fn().mockResolvedValue(Response.json(result)); vi.stubGlobal("fetch", fetchMock);
    const body = { q: "name,missing", scopes: "_id", fields: "taxid,mondo.xrefs" };
    expect((await api({ method: "POST", path: `/${prefix}/query`, body })).data).toEqual(result);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://my${prefix}.info/v1/query`);
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("q")).toBe("name,missing");
    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });
  it("preserves JSON-string POST bodies and numeric form values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([])); vi.stubGlobal("fetch", fetchMock);
    await api({ method: "POST", path: "/taxon/query", body: '{"q":"9606","size":1}' });
    expect(fetchMock.mock.calls[0][1].body).toBe("q=9606&size=1");
  });
  it.each(["gene", "variant", "chem", "disease", "taxon"])("preserves POST query parameters alongside the %s form body", async prefix => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([{ query: "A+B & C", notfound: true }])); vi.stubGlobal("fetch", fetchMock);
    const params = { fields: "nested.field,_id", dotfield: false, email: "a+b@example.org", size: 0, unused: undefined };
    const result = await api({ method: "POST", path: `/${prefix}/query`, body: { q: "A+B & C", scopes: "_id" }, params });
    const url = new URL(fetchMock.mock.calls[0][0]); const init = fetchMock.mock.calls[0][1];
    expect(Object.fromEntries(url.searchParams)).toEqual({ fields: "nested.field,_id", dotfield: "false", email: "a+b@example.org", size: "0" });
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ q: "A+B & C", scopes: "_id" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result.data).toEqual([{ query: "A+B & C", notfound: true }]);
  });
  it.each([undefined, null, [], 42, "null", "{invalid"])("rejects invalid batch bodies before fetching: %j", async body => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(api({ method: "POST", path: "/disease/query", body })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("preserves query fields and document identifiers", async () => {
    const data = { _id: "MONDO:0007947", mondo: { xrefs: { orphanet: ["558", "284963"] }, is_obsolete: false } };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal("fetch", fetchMock);
    expect((await api({ method: "GET", path: "/disease/disease/MONDO:0007947", params: { fields: "mondo.xrefs,mondo.is_obsolete" } })).data).toEqual(data);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/disease/MONDO:0007947");
    expect(url.searchParams.get("fields")).toBe("mondo.xrefs,mondo.is_obsolete");
  });
  it.each(["GET", "POST"] as const)("retains %s upstream errors", async method => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: false }, { status: 404 })));
    await expect(api({ method, path: "/taxon/query", body: { q: "missing" } })).rejects.toMatchObject({ status: 404, message: expect.stringContaining("HTTP 404") });
  });
  it("rejects non-JSON success and retains unreadable native error status", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("status", { headers: { "content-type": "text/plain" } })).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error("stream")); } }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api({ method: "GET", path: "/taxon/metadata" })).rejects.toMatchObject({ status: 502, data: "status" });
    await expect(api({ method: "GET", path: "/taxon/taxon/missing" })).rejects.toMatchObject({ status: 404, data: { http_status: 404, body_unavailable: true } });
  });
  it("rejects unknown services before fetching", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(api({ method: "GET", path: "/unrelated/query" })).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
