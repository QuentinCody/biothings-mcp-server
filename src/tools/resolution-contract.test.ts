import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerGeneResolve } from "./gene-resolve";
import { registerVariantResolve } from "./variant-resolve";
import { registerCompoundResolve } from "./compound-resolve";

afterEach(() => vi.unstubAllGlobals());
function fixture(withStorage = true) {
  const stored: unknown[] = [];
  const namespace = { idFromName: (id: string) => id, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      const { data } = await request.json() as { data: unknown }; stored.push(typeof data === "string" ? JSON.parse(data) : data);
      return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 });
    }
    return Response.json({ success: true, schema: { tables: {} } });
  } }) };
  const server = new McpServer({ name: "fixture", version: "1" });
  const env = withStorage ? { BIOTHINGS_DATA_DO: namespace } : {};
  registerGeneResolve(server, env); registerVariantResolve(server, env); registerCompoundResolve(server, env);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<Record<string, unknown>> }> })._registeredTools;
  return { tools, stored };
}

it.each(["gene", "variant", "compound"])("keeps both %s aliases complete with response-scoped provenance", async kind => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ query: "missing", notfound: true }])));
  const { tools } = fixture();
  for (const prefix of ["", "mcp_"]) {
    const result = await tools[`${prefix}biothings_${kind}_resolve`].handler({ ids: ["missing"] }, {});
    expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, data: [{ query: "missing", found: false }],
      _meta: { citation: { result_hash: expect.any(String), result_scope: "structured_content:data" } } } });
  }
});

it.each(["gene", "variant", "compound"])("stages UTF-8 %s data and its oversized preview without truncating either", async kind => {
  const query = "α".repeat(22000);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ query, notfound: true }])));
  const { tools, stored } = fixture();
  for (const prefix of ["", "mcp_"]) {
    const result = await tools[`${prefix}biothings_${kind}_resolve`].handler({ ids: ["fixture"] }, {});
    expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, staged: true, _staging: expect.any(Object) } });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30000);
  }
  expect(stored).toContainEqual(expect.objectContaining({ content: [expect.objectContaining({ text: expect.stringContaining(query) })],
    structuredContent: expect.objectContaining({ data: [{ query, found: false, native: { query, notfound: true } }] }) }));
});

it.each(["gene", "variant", "compound"])("returns explicit errors through both %s aliases when fetching or staging fails", async kind => {
  const { tools } = fixture(false);
  for (const prefix of ["", "mcp_"]) {
    for (const failFetch of [true, false]) {
      vi.stubGlobal("fetch", vi.fn(async () => {
        if (failFetch) throw new Error("fixture network failure");
        return Response.json([{ query: "α".repeat(60000), notfound: true }]);
      }));
      const result = await tools[`${prefix}biothings_${kind}_resolve`].handler({ ids: ["fixture"] }, {});
      expect(result).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false, error: { code: failFetch ? "API_ERROR" : "RESPONSE_ERROR" } } });
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30000);
    }
  }
});

it("does not report a partial success if a later batch returns a non-array error envelope", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ query: "first", notfound: true }])).mockResolvedValueOnce(Response.json({ error: "provider unavailable" }));
  vi.stubGlobal("fetch", fetcher);
  const { tools } = fixture();
  const result = await tools.biothings_gene_resolve.handler({ ids: Array.from({ length: 1001 }, (_, i) => `G${i}`) }, {});
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ isError: true, structuredContent: { success: false, error: { message: expect.stringContaining("no partial results returned") } } });
  expect(JSON.stringify(result)).not.toContain('"found":false');
});
