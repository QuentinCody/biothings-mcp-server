# Biothings MCP Server

This [Model Context Protocol](https://modelcontextprotocol.io) server provides Code Mode and batch annotation resolution across MyGene, MyVariant, MyChem, MyDisease and MyTaxon in the [Bio MCP](../../README.md) monorepo.

## Connect

Production endpoint (the October 4 local changes below have not been deployed):

```
https://biothings-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "biothings": {
      "command": "npx",
      "args": ["mcp-remote", "https://biothings-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8839/mcp` (start it with `./scripts/dev-servers.sh biothings`):

```json
{
  "mcpServers": {
    "biothings-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8839/mcp"]
    }
  }
}
```

## Tools

- `biothings_search` — discover available API operations (Code Mode catalog search, 25 endpoints)
- `biothings_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `biothings_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `biothings_get_schema` — inspect the inferred schema of a staged dataset
- `biothings_compound_resolve`
- `biothings_gene_resolve`
- `biothings_variant_resolve`

All seven tools also have the `mcp_` alias, for example
`mcp_biothings_execute`. Code Mode retains its V8 isolate and API composition.

Responses above the shared 30 KiB threshold are staged into the existing
Durable Object storage; tools return `_staging` and a `data_access_id` for SQL
recovery. The final response is measured in UTF-8 bytes, including composed
Code Mode results and resolver previews. If that envelope needs staging, the
`payloads` table retains the complete original response. Storage failures
return explicit errors rather than incomplete successful results. Every alias,
including discovery, SQL/schema and failures, carries a verifiable citation.
Resolver citations cover the returned projection, including each complete
`native` hit; a whole staged response receives its own full-envelope hash.

Resolver convenience fields remain available. Some scalar fields are legacy
first-value projections; inspect `native` for all Ensembl/UniProt/COSMIC values,
source licenses, scores, duplicate matches and provider warnings. They do not
select a canonical identifier. Native identifier types are preserved: MyGene's
current Entrez values can be strings. Gene requests include `taxid` so the species
context is retained even with `species: 'all'`.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Disease and taxonomy annotations

The [BioThings service roster](https://biothings.io/) includes MyDisease and
MyTaxon alongside MyGene, MyVariant and MyChem. Use `/disease/` and `/taxon/`
virtual prefixes for their public v1 APIs. Each supports query, batch query,
direct document lookup and metadata. All five services expose
`/{service}/metadata/fields` for discovering current annotation fields.

```javascript
const metadata = await api.get('/disease/metadata');
const records = await api.post('/disease/query', {
  q: 'MONDO:0007947,DOID:14323',
  scopes: '_id,mondo.xrefs.doid',
  fields: 'mondo.label,mondo.xrefs,mondo.is_obsolete,mondo.replaced_by'
});
return { metadata, records };
```

Keep all matching records and `notfound` entries. Disease cross-references
can connect broader and narrower concepts; they do not establish identical
clinical meaning. Retain obsolete/replacement fields when present. Source
annotations such as CTD inferred pathways retain their own evidence meaning.

GET queries use fielded search syntax. Quote colon-bearing identifiers as values,
for example `q: '_id:"MONDO:0007947"'`. The unquoted query `MONDO:0007947`
returned zero hits in native acceptance despite that document existing. POST
`scopes` do not substitute for GET fielded syntax. Neither an empty page nor a
`notfound` row independently proves biological absence.

For numeric taxonomy IDs, use `api.post('/taxon/query', {q: '9606,10090',
scopes: 'taxid', fields: 'taxid,scientific_name,rank,parent_taxid,lineage'})`.
Adding `scientific_name` to the scopes also matches strain names containing
those numbers. Direct lookup `/taxon/taxon/9606` resolves human without that
ambiguity. Keep rank and lineage when joining results to gene/protein datasets.

Retain `build_version`, `build_date` and each source's `src` version, dates and
license information from metadata. A metadata snapshot documents the observed
build; it does not pin later queries. Keep Code Mode batches small (1,000 inputs
is a conservative local recommendation) and select fields; these operations do
not auto-chunk requests. The three resolver tools accept up to 5,000 inputs,
chunk at 1,000 inputs and reject unexpected batch envelopes/rows instead of
reporting earlier batches as complete. Failures retain completed native rows,
failed inputs and the full bounded provider error body. Provider limits differ: the [MyGene batch documentation](https://docs.mygene.info/en/latest/doc/query_service.html)
currently allows 5,000 query terms.

`api.post(path, body, params)` preserves form fields and URL query parameters
separately, following the [BioThings option model](https://docs.biothings.io/en/latest/apidoc/biothings.web.options.html).
For example:

```javascript
return await api.post('/gene/query', {
  q: 'CDK2,BRCA1', scopes: 'symbol', fields: 'symbol,entrezgene'
}, { species: 9606 });
```

Avoid repeating a parameter in both locations; precedence is provider-defined.
POST requests have a 30-second deadline, no automatic retry and explicit redirect
rejection. Body reads are limited to ten seconds and 4 MiB; non-JSON, malformed,
partial or oversized responses fail explicitly. HTTP-200 application errors also
remain failures. The Code Mode execution budget is 60 seconds, so multi-request
recipes can still exhaust it.

## Native acceptance — October 4, 2026

The actual Worker bundle passes local acceptance with SQLite Durable Objects,
WorkerLoader and verified TLS. All five services' metadata and complete field
maps match native responses:

| Service | Observed build | Field definitions |
| --- | --- | ---: |
| MyGene | `20260922` | 366 |
| MyVariant | `20250624` | 1,621 |
| MyChem | `20260817` | 1,085 |
| MyDisease | `20260901` | 226 |
| MyTaxon | `20260903` | 12 |

These are observed service builds, not a common release or pinned query snapshot.
Individual source versions, dates and license links remain in native metadata.
Staged field dictionaries become `fields` rows; metadata becomes `builds` and
`sources` rows. Source definitions and hit annotations retain complete
`native_json` values. Native query rows use `hits`; resolver rows use
`genes`, `variants`, `compounds` or `resolution_rows`. Always inspect the schema;
`payloads` retains the complete original response.

Native checks verify the MONDO/DOID examples, direct taxon records and lineage,
disease pagination, all-service form batches, and URL parameters separate from
POST bodies. The `ABC1` alias returns both ABCA1 and HEATR6; repeated inputs retain
repeated hits. `rs113488022` returns three distinct alleles. Searching `9606` in
both `taxid` and scientific names also returns an unrelated bacterial strain;
the exact-taxid examples avoid that ambiguity. Human, mouse and all-species gene
resolver behavior matches native requests.

A 30-input gene resolution returns 33 native rows and survives both aliases,
automatic staging, SQL and citation verification with every row preserved.
Metadata, field maps, full disease annotation and oversized SQL recovery are
separately exercised. Counts describe response rows or field definitions, never
complete biological mappings. Search exposes two recipes: disease identifiers
with source metadata, and a gene-to-taxonomy join through the native taxid while
retaining both builds.

Validation passes 58 focused tests, 14 static checks, TypeScript/lint, dry bundle
and the live fleet contract. Full Vitest passes 13,440 tests with 109 skipped.
See the [acceptance tracker](../../docs/plans/2026-09-26-upstream-api-implementation.md)
for receipts and remaining audit work.

## Development

```bash
./scripts/dev-servers.sh biothings            # run locally (port 8839)
pnpm --filter biothings-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from MyGene, MyVariant, MyChem and stays under the terms of that source: Per-field source licenses; CADD non-commercial; DrugBank fields non-commercial.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
