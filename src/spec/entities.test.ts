/// <reference types="node" />
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { biothingsCatalog } from "./catalog";
import { entityEndpoints } from "./entities";

describe("BioThings entity discovery", () => {
  it("executes metadata-aware disease/taxon examples and uses an exact scope for taxonomy IDs", async () => {
    const metadata = { build_version: "20260903", src: { taxonomy: { version: "20260903" } } };
    const record = { _id: "9606", taxid: 9606, scientific_name: "Homo sapiens", rank: "species" };
    const api = { get: vi.fn(async (path: string) => path.endsWith("/metadata") ? metadata : record), post: vi.fn(async () => []) };
    for (const endpoint of entityEndpoints.filter(e => e.example)) {
      const result = await runInNewContext(`(async()=>{${endpoint.example}})()`, { api });
      if (endpoint.path === "/taxon/taxon/{id}") expect(result).toEqual({ metadata, record });
    }
    expect(api.post).toHaveBeenCalledWith("/taxon/query", expect.objectContaining({ q: "9606,10090", scopes: "taxid" }));
    expect(api.get).toHaveBeenCalledWith("/taxon/query", expect.objectContaining({ q: "taxid:9606" }));
    expect(api.get).toHaveBeenCalledWith("/disease/query", expect.objectContaining({ q: '_id:"MONDO:0007947"' }));
    expect(api.post).toHaveBeenCalledWith("/disease/query", expect.objectContaining({ scopes: "_id,mondo.xrefs.doid" }));
    expect(biothingsCatalog.endpointCount).toBe(biothingsCatalog.endpoints.length);
    for (const prefix of ["gene", "variant", "chem", "disease", "taxon"]) {
      expect(api.get).toHaveBeenCalledWith(`/${prefix}/metadata/fields`);
      expect(biothingsCatalog.endpoints.some(e => e.path === `/${prefix}/metadata`)).toBe(true);
    }
  });
});
