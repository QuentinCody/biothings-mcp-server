/**
 * BioThings API catalog — gene, variant, chemical, disease and taxonomy annotations
 *
 * Primary use case: entity resolution and batch ID mapping.
 * All endpoints are public (no auth required).
 *
 * Virtual path namespaces:
 *   /gene/*     → mygene.info/v3
 *   /variant/*  → myvariant.info/v1
 *   /chem/*     → mychem.info/v1
 */

import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";
import { entityEndpoints, entityNotes } from "./entities";
import { biothingsWorkflows } from "./workflows";

export const biothingsCatalog: ApiCatalog = {
	name: "BioThings (MyGene + MyVariant + MyChem + MyDisease + MyTaxon)",
	baseUrl: "https://mygene.info",
	version: "3.0",
	auth: "none",
	workflows: biothingsWorkflows,
	endpointCount: 12 + entityEndpoints.length,
	notes: entityNotes +
		"- Original API prefixes: /gene/ → mygene.info, /variant/ → myvariant.info, /chem/ → mychem.info\n" +
		"- The adapter routes to the correct base URL based on prefix and strips it\n" +
		"- POST /query endpoints accept form-encoded body: q (comma-separated IDs), scopes, fields\n" +
		"- For POST batch queries use api.post('/gene/query', {q: 'BRAF,TP53', scopes: 'symbol', fields: 'entrezgene,ensembl.gene'})\n" +
		"- Always pass minimal `fields` — requesting fields=all on batches returns megabytes of unnecessary data\n" +
		"- Hand-built resolvers accept up to 5000 inputs, chunking at a local 1000-input limit; provider limits differ. Code Mode does not auto-chunk.\n" +
		"- GET /query uses fielded query syntax: api.get('/gene/query', {q: 'symbol:BRAF', fields: 'entrezgene'}). POST scopes are not a substitute for GET fielded syntax. Quote colon-bearing document identifiers, e.g. _id:\"MONDO:0007947\".\n" +
		"- Direct document lookup: api.get('/gene/gene/{id}') with Entrez or Ensembl ID\n" +
		"- Response format: batch POST returns all returned hit/notfound rows, possibly multiple per input; GET /query returns a paged hits envelope; document GET returns an object. Metadata is an observed build, not a pinned snapshot. Responses are bounded at 4 MiB / ten body-read seconds and stage above 30 KiB.",
	endpoints: [
		...entityEndpoints,
		// ===================================================================
		// MyGene.info — Gene entity resolution and annotation
		// Base: https://mygene.info/v3
		// ===================================================================
		{
			method: "GET",
			path: "/gene/query",
			summary: "Search/resolve a single gene by symbol, alias, Entrez ID, or Ensembl gene ID",
			category: "gene",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "Query term (gene symbol, alias, or ID)" },
				{ name: "fields", type: "string", required: false, description: "Comma-separated fields to return (e.g. entrezgene,ensembl.gene,symbol)" },
				{ name: "size", type: "number", required: false, description: "Number of results (default: 10)", default: 10 },
				{ name: "from", type: "number", required: false, description: "Offset for pagination", default: 0 },
				{ name: "species", type: "string", required: false, description: "Species filter (e.g. human, mouse, 9606)" },
			],
		},
		{
			method: "POST",
			path: "/gene/query",
			summary: "Batch resolve gene identifiers — form body: q (comma-sep IDs), scopes=symbol,alias,entrezgene,ensembl.gene, fields=entrezgene,ensembl.gene,uniprot.Swiss-Prot,HGNC,symbol,alias",
			category: "gene",
			coveredByTool: "biothings_gene_resolve",
			body: { contentType: "application/x-www-form-urlencoded", description: "q=BRAF,TP53&scopes=symbol,alias,entrezgene,ensembl.gene&fields=entrezgene,ensembl.gene,uniprot.Swiss-Prot,HGNC,symbol,alias" },
		},
		{
			method: "GET",
			path: "/gene/gene/{id}",
			summary: "Get gene annotation by Entrez or Ensembl gene ID (direct document lookup)",
			category: "gene",
			pathParams: [
				{ name: "id", type: "string", required: true, description: "Entrez gene ID (e.g. 1017) or Ensembl gene ID (e.g. ENSG00000157764)" },
			],
			queryParams: [
				{ name: "fields", type: "string", required: false, description: "Comma-separated fields to return" },
			],
		},
		{
			method: "GET",
			path: "/gene/metadata",
			summary: "Get MyGene.info metadata (build version, field stats, available species)",
			category: "gene",
		},

		// ===================================================================
		// MyVariant.info — Variant entity resolution and annotation
		// Base: https://myvariant.info/v1
		// ===================================================================
		{
			method: "GET",
			path: "/variant/query",
			summary: "Search/resolve a single variant by HGVS ID, rsID, or ClinVar accession",
			category: "variant",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "Query term (HGVS ID, rsID, or ClinVar RCV)" },
				{ name: "fields", type: "string", required: false, description: "Comma-separated fields to return" },
				{ name: "size", type: "number", required: false, description: "Number of results (default: 10)", default: 10 },
				{ name: "from", type: "number", required: false, description: "Offset for pagination", default: 0 },
			],
		},
		{
			method: "POST",
			path: "/variant/query",
			summary: "Batch resolve variant identifiers — form body: q (comma-sep IDs), scopes=_id,dbsnp.rsid,clinvar.rcv.accession, fields=_id,dbsnp.rsid,clinvar.variant_id,cosmic.cosmic_id",
			category: "variant",
			coveredByTool: "biothings_variant_resolve",
			body: { contentType: "application/x-www-form-urlencoded", description: "q=rs58991260,chr7:g.140453136A>T&scopes=_id,dbsnp.rsid,clinvar.rcv.accession&fields=_id,dbsnp.rsid,clinvar.variant_id,cosmic.cosmic_id" },
		},
		{
			method: "GET",
			path: "/variant/variant/{id}",
			summary: "Get variant annotation by HGVS ID (direct document lookup)",
			category: "variant",
			pathParams: [
				{ name: "id", type: "string", required: true, description: "HGVS variant ID (e.g. chr7:g.140453136A>T)" },
			],
			queryParams: [
				{ name: "fields", type: "string", required: false, description: "Comma-separated fields to return" },
			],
		},
		{
			method: "GET",
			path: "/variant/metadata",
			summary: "Get MyVariant.info metadata (build version, field stats)",
			category: "variant",
		},

		// ===================================================================
		// MyChem.info — Compound/drug entity resolution and annotation
		// Base: https://mychem.info/v1
		// ===================================================================
		{
			method: "GET",
			path: "/chem/query",
			summary: "Search/resolve a single compound by InChIKey, DrugBank ID, ChEMBL ID, or PubChem CID",
			category: "compound",
			queryParams: [
				{ name: "q", type: "string", required: true, description: "Query term (InChIKey, DrugBank ID, ChEMBL ID, PubChem CID)" },
				{ name: "fields", type: "string", required: false, description: "Comma-separated fields to return" },
				{ name: "size", type: "number", required: false, description: "Number of results (default: 10)", default: 10 },
				{ name: "from", type: "number", required: false, description: "Offset for pagination", default: 0 },
			],
		},
		{
			method: "POST",
			path: "/chem/query",
			summary: "Batch resolve compound identifiers — form body: q (comma-sep IDs), scopes=_id,drugbank.id,chembl.molecule_chembl_id,pubchem.cid, fields=chembl.molecule_chembl_id,drugbank.id,pubchem.cid,unii.unii,chebi.id",
			category: "compound",
			coveredByTool: "biothings_compound_resolve",
			body: { contentType: "application/x-www-form-urlencoded", description: "q=CHEMBL25,DB00945&scopes=_id,drugbank.id,chembl.molecule_chembl_id,pubchem.cid&fields=chembl.molecule_chembl_id,drugbank.id,pubchem.cid,unii.unii,chebi.id" },
		},
		{
			method: "GET",
			path: "/chem/chem/{id}",
			summary: "Get compound annotation by InChIKey (direct document lookup)",
			category: "compound",
			pathParams: [
				{ name: "id", type: "string", required: true, description: "InChIKey (e.g. HEFNNWSXXWATRW-UHFFFAOYSA-N) or DrugBank ID" },
			],
			queryParams: [
				{ name: "fields", type: "string", required: false, description: "Comma-separated fields to return" },
			],
		},
		{
			method: "GET",
			path: "/chem/metadata",
			summary: "Get MyChem.info metadata (build version, field stats)",
			category: "compound",
		},
	],
};
