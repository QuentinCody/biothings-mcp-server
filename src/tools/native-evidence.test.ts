import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { fixture, recover } from "./staging-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const padding = "β\"\\".repeat(6000);
async function invoke(f: ReturnType<typeof fixture>, name: string, args: unknown, failed = false) {
  const result = await f.tools[name].handler(args, {}); expect(result.isError === true, JSON.stringify(result).slice(0, 1200)).toBe(failed);
  const sc = result.structuredContent; let original = sc; let materialized: unknown;
  if (sc.staged) { const full = await recover(f, sc.data_access_id, ""); materialized = full; original = full.structuredContent; }
  let data = original.data;
  if (data?.__staged) { data = await recover(f, data.data_access_id, ""); materialized ??= data; }
  const proof = await verifyCitationEnvelope({ citation: sc._meta.citation, structuredContent: sc, toolArguments: args, ...(materialized ? { materialized: { value: materialized } } : {}) });
  expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(30720);
  return { sc, data, id: original.data?.data_access_id ?? sc.data_access_id };
}

it("stages wide native field maps as rows without losing dotted names, types or index flags", async () => {
  const f = fixture(); const native = Object.fromEntries(Array.from({ length: 2100 }, (_, i) => [`source.field_${i}`, { type: i % 2 ? "keyword" : "integer", index: i % 3 === 0, notes: ["001", null] }]));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try {
    const r = await invoke(f, "mcp_biothings_execute", { code: "return await api.get('/variant/metadata/fields');" });
    expect(r.data).toEqual(native); expect(r.sc._meta.completeness).toMatchObject({ complete: false, returned: 2100 });
    const count = await invoke(f, "biothings_query_data", { data_access_id: r.id, sql: "SELECT count(*) AS n FROM fields" });
    expect(count.data.rows).toEqual([{ n: 2100 }]);
    const rows = await invoke(f, "mcp_biothings_query_data", { data_access_id: r.id, sql: "SELECT field_name,native_json FROM fields WHERE field_name='source.field_2099'" });
    expect(JSON.parse(rows.data.rows[0].native_json)).toEqual(native["source.field_2099"]);
  } finally { f.close(); }
});

it("preserves independent source versions/licenses and conservatively counts one build record", async () => {
  const f = fixture(); const native = { biothing_type: "gene", build_version: "001", build_date: "2026-09-01", src: { a: { version: "002", license: padding }, b: { version: "003", license_url: null } }, stats: { total: 99999 }, taxonomy: [9606, 10090] };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try {
    const r = await invoke(f, "biothings_execute", { code: "return await api.get('/gene/metadata');" });
    expect(r.data).toEqual(native); expect(r.sc._meta.completeness).toMatchObject({ complete: false, returned: 1 });
    expect(r.sc._meta.completeness.total_available).toBeUndefined();
    const sources = await invoke(f, "biothings_query_data", { data_access_id: r.id, sql: "SELECT source_name,native_json FROM sources ORDER BY source_name" });
    expect(sources.data.rows.map((row: { source_name: string; native_json: string }) => [row.source_name, JSON.parse(row.native_json)])).toEqual(Object.entries(native.src));
    const ids = await invoke(f, "biothings_query_data", { data_access_id: r.id, sql: "SELECT _rowid,source_name,native_json FROM sources WHERE source_name='a'" });
    expect(ids.data.rows[0]._rowid).toBe(1);
  } finally { f.close(); }
});

it.each(["gene", "variant", "compound"])("keeps all native %s resolver mappings, duplicate hits, licenses and notfound evidence", async kind => {
  const f = fixture();
  const found = { query: "ambiguous", _id: "001", _score: 0, entrezgene: "001", symbol: "A", ensembl: [{ gene: "E1", protein: ["P1", "P1"] }, { gene: "E2", protein: ["P2"] }], uniprot: { "Swiss-Prot": ["U1", "U2"] }, cosmic: { cosmic_id: ["C1", "C2"], _license: padding }, future: null };
  const native = [found, { ...found, _id: "002" }, { query: "missing", notfound: true, warning: "native warning" }];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try { for (const prefix of ["", "mcp_"]) {
    const r = await invoke(f, prefix + `biothings_${kind}_resolve`, { ids: ["ambiguous", "missing"] });
    expect(r.data.map((row: { native: unknown }) => row.native)).toEqual(native);
    expect(r.data.map((row: { found: boolean }) => row.found)).toEqual([true, true, false]);
    expect(r.sc._meta.completeness).toMatchObject({ complete: false, returned: 3 });
  } } finally { f.close(); }
});

it("retains partial batch evidence on a later HTTP error and cites discovery, schema and SQL errors", async () => {
  const f = fixture(); const first = [{ query: "001", _id: "001", entrezgene: "001", symbol: "G", license: padding }];
  try {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(new Response("full native failure " + padding, { status: 400 })));
    const r = await invoke(f, "mcp_biothings_gene_resolve", { ids: Array.from({ length: 1001 }, (_, i) => String(i)) }, true);
    expect(r.data.completed_results).toEqual(first); expect(r.data.native).toBe("full native failure " + padding); expect(r.data.failed_inputs).toEqual(["1000"]);
    for (const prefix of ["", "mcp_"]) {
      await invoke(f, prefix + "biothings_search", { query: "disease", max_results: 1 });
      await invoke(f, prefix + "biothings_get_schema", { data_access_id: r.id });
      await invoke(f, prefix + "biothings_query_data", { data_access_id: "missing", sql: "SELECT * FROM missing" }, true);
    }
  } finally { f.close(); }
});

it("keeps native page totals separate from returned hits and composed metadata", async () => {
  const f = fixture(); const native = { total: 500, hits: [{ _id: "D1", query: "x", mondo: { xrefs: ["001", "001"], note: padding } }, { _id: "D1", query: "x" }], took: 0 };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try {
    const r = await invoke(f, "biothings_execute", { code: "return await api.get('/disease/query',{q:'label:x',size:2});" });
    expect(r.data).toEqual(native); expect(r.sc._meta.completeness).toMatchObject({ complete: false, returned: 2, total_available: 500 });
    const rows = await invoke(f, "biothings_query_data", { data_access_id: r.id, sql: "SELECT _rowid,native_json FROM hits ORDER BY _rowid" });
    expect(rows.data.rows.map((row: { native_json: string }) => JSON.parse(row.native_json))).toEqual(native.hits);
    const combined = await invoke(f, "biothings_execute", { code: "return {a:await api.get('/disease/query',{q:'x'}),b:await api.get('/taxon/query',{q:'x'})};" });
    expect(combined.sc._meta.completeness).toMatchObject({ complete: false }); expect(combined.sc._meta.completeness.returned).toBeUndefined();
  } finally { f.close(); }
});
