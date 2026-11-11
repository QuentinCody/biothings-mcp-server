import type { ApiEndpoint } from "@bio-mcp/shared/codemode/catalog";

const entities = [
  { name: "disease", id: "MONDO:0007947", fields: "mondo.label,mondo.xrefs,mondo.is_obsolete,mondo.replaced_by", scopes: "_id,mondo.xrefs.doid", query: "MONDO:0007947,DOID:14323" },
  { name: "taxon", id: "9606", fields: "taxid,scientific_name,rank,parent_taxid,lineage", scopes: "taxid", query: "9606,10090" },
];
const fieldsParam: ApiEndpoint["queryParams"] = [{ name: "fields", type: "string", required: false, description: "Comma-separated fields from metadata/fields; select the annotations needed" }];

export const entityNotes =
  "- Also route /disease/ to mydisease.info/v1 and /taxon/ to mytaxon.info/v1. These are complementary annotation sources, not newly claimed 2026 APIs.\n" +
  "- Discover searchable fields through /{service}/metadata/fields. Retain metadata build_version/build_date and src versions, download dates and license URLs with research outputs; source versions differ and a metadata snapshot does not pin a subsequent query.\n" +
  "- Disease cross-references can be ambiguous or obsolete: retain all batch hits, notfound and query fields, mondo.is_obsolete and mondo.replaced_by. Cross-references do not by themselves assert identical clinical meaning or causality.\n" +
  "- Taxon records retain rank, parent_taxid and lineage. Names can match multiple taxa; prefer explicit NCBI taxids when joining gene/protein records. Code Mode batch requests are caller-bounded and are not automatically chunked.\n";

export const entityEndpoints: ApiEndpoint[] = [
  ...entities.flatMap(({ name, id, fields, scopes, query }): ApiEndpoint[] => [
    {
      method: "GET", path: `/${name}/query`, category: name, summary: `Search ${name} annotations using fields discovered from metadata/fields`,
      queryParams: [{ name: "q", type: "string", required: true, description: "Fielded query or search text" }, ...fieldsParam, { name: "size", type: "number", required: false, description: "Bounded result count", default: 10 }, { name: "from", type: "number", required: false, description: "Result offset", default: 0 }],
      example: `return await api.get('/${name}/query', { q: '${name === "taxon" ? `taxid:${id}` : `_id:"${id}"`}', fields: '${fields}', size: 5 });`,
    },
    {
      method: "POST", path: `/${name}/query`, category: name, summary: `Batch resolve ${name} identifiers; preserve multiple matches and notfound records`,
      body: { contentType: "application/x-www-form-urlencoded", description: "q (comma-separated IDs), scopes (metadata field names), fields (selected annotations); bound batches to at most 1000 inputs" },
      example: `return await api.post('/${name}/query', { q: '${query}', scopes: '${scopes}', fields: '${fields}' });`,
    },
    {
      method: "GET", path: `/${name}/${name}/{id}`, category: name, summary: `Get one ${name} document and preserve source annotations`,
      pathParams: [{ name: "id", type: "string", required: true, description: `Provider document identifier, e.g. ${id}` }], queryParams: fieldsParam,
      example: `const metadata = await api.get('/${name}/metadata'); const record = await api.get('/${name}/${name}/${id}', { fields: '${fields}' }); return { metadata, record };`,
    },
    { method: "GET", path: `/${name}/metadata`, category: name, summary: `Get ${name} build metadata and individual source versions, dates and licenses` },
  ]),
  ...["gene", "variant", "chem", "disease", "taxon"].map((name): ApiEndpoint => ({
    method: "GET", path: `/${name}/metadata/fields`, category: name, summary: `Discover available ${name} fields, types and indexing before querying`,
    queryParams: [{ name: "search", type: "string", required: false, description: "Filter field names by a search term" }],
    example: `return await api.get('/${name}/metadata/fields');`,
  })),
];
