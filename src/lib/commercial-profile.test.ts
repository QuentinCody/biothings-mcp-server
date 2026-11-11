import { LICENSE_PROFILE_META_KEY } from "@bio-mcp/shared";
import { McpServer } from "@bio-mcp/shared/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCompoundResolve } from "../tools/compound-resolve";
import { registerGeneResolve } from "../tools/gene-resolve";
import { registerVariantResolve } from "../tools/variant-resolve";
import { createBioThingsApiFetch } from "./api-adapter";
import {
	applyCommercialFilter,
	COMMERCIAL_SOURCE_FIELDS,
	commercialRequestRule,
	IDENTIFIER_FIELDS,
	isCommercialField,
	queryFieldReferences,
	splitFields,
} from "./commercial-profile";

// License audit 2026-11-10: "Strip the non-commercial source fields (CADD,
// DrugBank, dbNSFP, COSMIC, SIDER, UMLS) in the BioThings server." The rule is an
// allowlist of source fields whose license permits commercial use.
//
// The fixtures are real responses of the public APIs on 2026-11-10, cut to a few fields.
// GET https://myvariant.info/v1/variant/chr7:g.140453136A>T?fields=_id,chrom,vcf,dbsnp.rsid,cadd.phred,cosmic.cosmic_id,cosmic.tumor_site,clinvar.variant_id,gnomad_exome.af.af
const brafV600E = {
	_id: "chr7:g.140453136A>T",
	_version: 2,
	cadd: { _license: "http://bit.ly/2TIuab9", phred: 32 },
	chrom: "7",
	clinvar: { _license: "http://bit.ly/2SQdcI0", variant_id: 13961 },
	cosmic: { _license: "http://bit.ly/2VMkY7R", cosmic_id: "COSM476", tumor_site: "biliary_tract" },
	dbsnp: { _license: "http://bit.ly/2AqoLOc", rsid: "rs113488022" },
	gnomad_exome: { _license: "http://bit.ly/2I1cl1I", af: { af: 0.00000397994 } },
	vcf: { alt: "T", position: "140453136", ref: "A" },
};
// POST https://myvariant.info/v1/query q=rs113488022&scopes=dbsnp.rsid&fields=_id,dbsnp.rsid,clinvar.variant_id,cosmic.cosmic_id
const rsidBatch = [
	{ query: "rs113488022", _id: "chr7:g.140453136A>G", _score: 17.14107, cosmic: { _license: "http://bit.ly/2VMkY7R", cosmic_id: "COSM18443" }, dbsnp: { _license: "http://bit.ly/2AqoLOc", rsid: "rs113488022" } },
	{ query: "rs113488022", _id: "chr7:g.140453136A>T", _score: 17.14098, clinvar: { _license: "http://bit.ly/2SQdcI0", variant_id: 13961 }, cosmic: { _license: "http://bit.ly/2VMkY7R", cosmic_id: "COSM476" }, dbsnp: { _license: "http://bit.ly/2AqoLOc", rsid: "rs113488022" } },
	{ query: "missing", notfound: true },
];
// GET https://mychem.info/v1/chem/BSYNRYMUTXBXSQ-UHFFFAOYSA-N?fields=drugbank.id,drugbank.name,chembl.molecule_chembl_id,pubchem.cid,unii.unii,chebi.id,umls.cui
const aspirin = {
	_id: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
	_version: 1,
	chebi: { _license: "http://bit.ly/2KAUCAm", id: "CHEBI:15365" },
	chembl: { _license: "http://bit.ly/2KAUCAm", molecule_chembl_id: "CHEMBL25" },
	drugbank: { _license: "https://bit.ly/3Hikpvm", id: "DB00945", name: "Acetylsalicylic acid" },
	pubchem: { _license: "http://bit.ly/2AqoLOc", cid: 2244 },
	umls: { cui: "C0002185" },
	unii: { _license: "http://bit.ly/2Pg8Oo9", unii: "R16CO5Y76E" },
};
// GET https://mygene.info/v3/query?q=symbol:CDK2&species=human&size=1&fields=symbol,entrezgene,name,umls,uniprot.Swiss-Prot,HGNC,taxid,pantherdb.uniprot_kb
const cdk2Page = {
	took: 2,
	total: 1,
	max_score: 17.355864,
	hits: [
		{ HGNC: "1771", _id: "1017", _score: 17.355864, entrezgene: "1017", name: "cyclin dependent kinase 2", pantherdb: { _license: "http://pantherdb.org/tou.jsp", uniprot_kb: "P24941" }, symbol: "CDK2", taxid: 9606, umls: { cui: "C1332733" }, uniprot: { "Swiss-Prot": "P24941" } },
	],
};

const AUDIT_FIELDS = ["cadd", "drugbank", "dbnsfp", "cosmic", "sider", "umls"];
const marker = (removed: string[], service = "myvariant.info/v1") => ({
	removed_fields: removed,
	reason: expect.stringContaining("CADD, dbNSFP, COSMIC, DrugBank, SIDER, UMLS"),
	terms: expect.stringContaining(`https://${service}/metadata`),
});

afterEach(() => vi.unstubAllGlobals());

interface Call {
	url: URL;
	body?: URLSearchParams;
}
function stubUpstream(body: unknown) {
	const calls: Call[] = [];
	vi.stubGlobal("fetch", async (url: URL | string, init?: RequestInit) => {
		calls.push({ url: new URL(String(url)), ...(typeof init?.body === "string" ? { body: new URLSearchParams(init.body) } : {}) });
		return Response.json(body);
	});
	return calls;
}

describe("BioThings adapter under the commercial license profile", () => {
	const api = createBioThingsApiFetch();
	const commercial = { licenseProfile: "commercial" as const };

	it("removes the CADD and COSMIC fields of a variant document and keeps the open fields", async () => {
		const calls = stubUpstream(brafV600E);
		const result = await api({ ...commercial, method: "GET", path: "/variant/variant/chr7:g.140453136A>T" });
		const { cadd, cosmic, ...open } = brafV600E;
		expect([cadd, cosmic]).not.toContain(undefined);
		expect(result.status).toBe(200);
		expect(result.data).toEqual({ ...open, _license_filter: marker(["cadd", "cosmic"]) });
		expect(calls).toHaveLength(1);
	});

	it("removes the removed fields from a fields list before the request", async () => {
		const calls = stubUpstream({ _id: brafV600E._id, _version: 2, dbsnp: brafV600E.dbsnp });
		const params = { fields: "_id,dbsnp.rsid,cadd.phred,cosmic.cosmic_id,dbnsfp.sift.pred" };
		const result = await api({ ...commercial, method: "GET", path: "/variant/variant/chr7:g.140453136A>T", params });
		expect(calls[0].url.searchParams.get("fields")).toBe("_id,dbsnp.rsid");
		expect(result.data).toEqual({ _id: brafV600E._id, _version: 2, dbsnp: brafV600E.dbsnp, _license_filter: marker(["cadd", "cosmic", "dbnsfp"]) });
	});

	it("filters each row of a batch POST, marks it, and strips the fields of the form body", async () => {
		const calls = stubUpstream(rsidBatch);
		const body = { q: "rs113488022,missing", scopes: "dbsnp.rsid", fields: "_id,dbsnp.rsid,clinvar.variant_id,cosmic.cosmic_id" };
		const result = await api({ ...commercial, method: "POST", path: "/variant/query", body });
		expect(Object.fromEntries(calls[0].body ?? [])).toEqual({ ...body, fields: "_id,dbsnp.rsid,clinvar.variant_id" });
		const strip = ({ cosmic: _cosmic, ...row }: Record<string, unknown>) => ({ ...row, _license_filter: marker(["cosmic"]) });
		expect(result.data).toEqual(rsidBatch.map(strip));
		expect(JSON.stringify(result.data)).not.toMatch(/COSM\d/);
	});

	it("filters the hits of a query page and keeps the page envelope", async () => {
		stubUpstream(cdk2Page);
		const result = await api({ ...commercial, method: "GET", path: "/gene/query", params: { q: "symbol:CDK2", species: "human" } });
		const { umls, pantherdb, ...hit } = cdk2Page.hits[0];
		expect([umls, pantherdb]).not.toContain(undefined);
		expect(result.data).toEqual({ ...cdk2Page, hits: [hit], _license_filter: marker(["pantherdb", "umls"], "mygene.info/v3") });
		expect(result.upstreamTotal).toBe(1);
	});

	it("removes the DrugBank and UMLS fields of a compound and keeps ChEBI, ChEMBL, PubChem and UNII", async () => {
		stubUpstream(aspirin);
		const result = await api({ ...commercial, method: "GET", path: "/chem/chem/BSYNRYMUTXBXSQ-UHFFFAOYSA-N" });
		const { drugbank, umls, ...open } = aspirin;
		expect([drugbank, umls]).not.toContain(undefined);
		expect(result.data).toEqual({ ...open, _license_filter: marker(["drugbank", "umls"], "mychem.info/v1") });
	});

	it("refuses with HTTP 451 a request whose hits a removed field selects, and makes no upstream request", async () => {
		const calls = stubUpstream(rsidBatch);
		const refused: Array<[string, Record<string, unknown> | undefined, Record<string, unknown> | undefined, string]> = [
			["/variant/query", { q: "cadd.phred:>20" }, undefined, "cadd"],
			["/variant/query", { q: "dbsnp.rsid:rs113488022 AND -cosmic.cosmic_id:COSM476" }, undefined, "cosmic"],
			["/variant/query", { q: "_exists_:dbnsfp" }, undefined, "dbnsfp"],
			["/variant/query", { q: "(dbnsfp.sift.pred:D OR clinvar.rcv.clinical_significance:Pathogenic)" }, undefined, "dbnsfp"],
			["/variant/query", { q: "cadd.*:32" }, undefined, "cadd"],
			["/variant/query", { q: "cadd\\.phred:32" }, undefined, "cadd"],
			["/gene/query", { q: "umls.cui:C1332733" }, undefined, "umls"],
			["/chem/query", { q: "sider.side_effect.name:nausea" }, undefined, "sider"],
			["/disease/query", { q: "ctd.chemical_related_to_disease.mesh_chemical_id:D000082" }, undefined, "ctd"],
			["/variant/query", { q: "chr7:140453136", sort: "-cadd.phred" }, undefined, "cadd"],
			["/chem/query", { q: "aspirin", facets: "drugbank.groups" }, undefined, "drugbank"],
			["/chem/query", undefined, { q: "DB00945", scopes: "drugbank.id" }, "drugbank"],
			["/variant/variant/chr7:g.140453136A>T", { fields: "cadd.phred,cosmic" }, undefined, "cadd"],
			["/variant/variant/chr7:g.140453136A>T", { fields: "_id,cadd.phred" }, undefined, "cadd"],
			["/chem/query", undefined, { q: "CHEMBL25", scopes: "chembl.molecule_chembl_id", fields: "drugbank.id" }, "drugbank"],
		];
		for (const [path, params, body, field] of refused) {
			const result = await api({ ...commercial, method: body ? "POST" : "GET", path, params, body });
			expect(result.status, `${path} ${JSON.stringify(params ?? body)}`).toBe(451);
			expect(result.data).toMatchObject({ error: "NOT_LICENSED_FOR_COMMERCIAL_USE", message: expect.stringContaining(field) });
		}
		expect(calls).toEqual([]);
	});

	it("sends a query that searches only kept fields, identifiers or a genomic coordinate", async () => {
		const calls = stubUpstream({ took: 1, total: 0, max_score: null, hits: [] });
		const queries = [
			"dbsnp.rsid:rs113488022",
			"chr7:g.140453136A>T",
			'_id:"chr7:g.140453136A>T"',
			"rs113488022",
			"clinvar.rcv.accession:RCV000013961 AND gnomad_exome.af.af:<0.01",
			'cgi.association:"Responsive" OR civic.variant_id:12',
		];
		for (const q of queries) expect((await api({ ...commercial, method: "GET", path: "/variant/query", params: { q } })).status, q).toBe(200);
		expect(calls.map((call) => call.url.searchParams.get("q"))).toEqual(queries);
	});

	it("does not change the metadata routes, which list the sources and their licenses", async () => {
		const metadata = { build_version: "20250624", src: { cadd: { license_url: "http://cadd.gs.washington.edu/contact" } } };
		for (const path of ["/variant/metadata", "/variant/metadata/fields"]) {
			stubUpstream(metadata);
			expect((await api({ ...commercial, method: "GET", path })).data, path).toEqual(metadata);
		}
	});

	it("does not change the behavior of a caller without the commercial profile", async () => {
		const calls = stubUpstream(brafV600E);
		const open = { method: "GET", path: "/variant/variant/chr7:g.140453136A>T" };
		expect((await api(open)).data).toEqual(brafV600E);
		expect((await api({ ...open, params: { fields: "cadd.phred,cosmic" } })).data).toEqual(brafV600E);
		expect((await api({ method: "GET", path: "/variant/query", params: { q: "cadd.phred:>20", sort: "-cadd.phred" } })).data).toEqual(brafV600E);
		expect(calls.map((call) => call.url.searchParams.get("fields") ?? call.url.searchParams.get("q"))).toEqual([null, "cadd.phred,cosmic", "cadd.phred:>20"]);
		stubUpstream(rsidBatch);
		expect((await api({ method: "POST", path: "/variant/query", body: { q: "rs113488022", scopes: "dbsnp.rsid" } })).data).toEqual(rsidBatch);
	});
});

describe("BioThings resolvers under the commercial license profile", () => {
	const commercialExtra = { _meta: { [LICENSE_PROFILE_META_KEY]: "commercial" } };
	function tools() {
		const server = new McpServer({ name: "fixture", version: "1" });
		const env = {};
		registerGeneResolve(server, env);
		registerVariantResolve(server, env);
		registerCompoundResolve(server, env);
		return (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ structuredContent: Record<string, unknown> }> }> })._registeredTools;
	}

	it("drops the COSMIC ID from the variant resolver request and response", async () => {
		const calls = stubUpstream(rsidBatch);
		const { structuredContent } = await tools().biothings_variant_resolve.handler({ ids: ["rs113488022", "missing"] }, commercialExtra);
		expect(calls[0].body?.get("fields")).toBe("_id,dbsnp.rsid,clinvar.variant_id");
		expect(structuredContent).toMatchObject({ success: true, _license_filter: marker(["cosmic"]) });
		const rows = structuredContent.data as Array<Record<string, unknown>>;
		expect(rows.map((row) => row.cosmic_id)).toEqual([undefined, undefined, undefined]);
		expect(rows.map((row) => row.rsid)).toEqual(["rs113488022", "rs113488022", undefined]);
		expect(JSON.stringify(structuredContent.data)).not.toMatch(/COSM\d/);
	});

	it("drops DrugBank from the compound resolver fields and scopes, and UMLS from the gene resolver response", async () => {
		const calls = stubUpstream([{ query: "CHEMBL25", ...aspirin }]);
		const compound = (await tools().mcp_biothings_compound_resolve.handler({ ids: ["CHEMBL25"] }, commercialExtra)).structuredContent;
		expect(Object.fromEntries(calls[0].body ?? [])).toMatchObject({ scopes: "_id,chembl.molecule_chembl_id,pubchem.cid", fields: "chembl.molecule_chembl_id,pubchem.cid,unii.unii,chebi.id" });
		expect(compound).toMatchObject({ _license_filter: { ...marker(["drugbank", "umls"], "mychem.info/v1"), removed_scopes: ["drugbank.id"] } });
		expect(compound.data).toEqual([expect.objectContaining({ chembl_id: "CHEMBL25", chebi_id: "CHEBI:15365", drugbank_id: undefined })]);
		expect(JSON.stringify(compound.data)).not.toContain("DB00945");

		const geneCalls = stubUpstream([{ query: "CDK2", ...cdk2Page.hits[0] }]);
		const gene = (await tools().biothings_gene_resolve.handler({ ids: ["CDK2"] }, commercialExtra)).structuredContent;
		expect(geneCalls[0].body?.get("fields")).toBe("entrezgene,ensembl.gene,ensembl.protein,uniprot.Swiss-Prot,HGNC,symbol,alias,taxid");
		expect(gene).toMatchObject({ _license_filter: marker(["pantherdb", "umls"], "mygene.info/v3"), data: [{ symbol: "CDK2", uniprot: "P24941", hgnc: "1771" }] });
		expect(JSON.stringify(gene.data)).not.toContain("C1332733");
	});

	it("does not change the resolvers for a caller without the profile", async () => {
		const calls = stubUpstream(rsidBatch);
		const variant = (await tools().biothings_variant_resolve.handler({ ids: ["rs113488022"] }, {})).structuredContent;
		expect(calls[0].body?.get("fields")).toBe("_id,dbsnp.rsid,clinvar.variant_id,cosmic.cosmic_id");
		expect(variant).not.toHaveProperty("_license_filter");
		expect((variant.data as Array<Record<string, unknown>>).map((row) => row.cosmic_id)).toEqual(["COSM18443", "COSM476", undefined]);
		const compoundCalls = stubUpstream([{ query: "DB00945", ...aspirin }]);
		const compound = (await tools().biothings_compound_resolve.handler({ ids: ["DB00945"] }, {})).structuredContent;
		expect(compoundCalls[0].body?.get("scopes")).toContain("drugbank.id");
		expect(compound.data).toEqual([expect.objectContaining({ drugbank_id: "DB00945" })]);
	});
});

describe("the allowlist and its predicates", () => {
	it("keeps no field named by the audit, in any service", () => {
		for (const [service, fields] of Object.entries(COMMERCIAL_SOURCE_FIELDS)) {
			for (const field of AUDIT_FIELDS) expect(fields, `${service} ${field}`).not.toContain(field);
		}
		for (const field of ["cadd.phred", "dbnsfp", "cosmic.cosmic_id", "snpedia", "evs", "grasp"]) expect(isCommercialField("variant", field), field).toBe(false);
		for (const field of ["drugbank.id", "sider", "umls.cui", "ginas", "gsrs"]) expect(isCommercialField("chem", field), field).toBe(false);
		for (const field of ["ctd", "hpo", "umls", "disease_ontology"]) expect(isCommercialField("disease", field), field).toBe(false);
		for (const field of ["umls", "pathway.kegg", "clingen", "an_unknown_source"]) expect(isCommercialField("gene", field), field).toBe(false);
	});

	it("keeps the identifier fields and the open source fields", () => {
		for (const service of ["gene", "variant", "chem", "disease", "taxon"] as const) {
			for (const field of IDENTIFIER_FIELDS) expect(isCommercialField(service, field)).toBe(true);
		}
		for (const field of ["dbsnp.rsid", "clinvar", "gnomad_genome", "civic", "cgi", "vcf.ref", "-chrom"]) expect(isCommercialField("variant", field), field).toBe(true);
		for (const field of ["chebi.id", "chembl", "pubchem.cid", "unii", "drugcentral"]) expect(isCommercialField("chem", field), field).toBe(true);
		for (const field of ["symbol", "entrezgene", "uniprot.Swiss-Prot", "go.BP", "ensembl.gene"]) expect(isCommercialField("gene", field), field).toBe(true);
		expect(splitFields("variant", ["_id, dbsnp.rsid", "cadd.phred"])).toEqual({ kept: ["_id", "dbsnp.rsid"], removed: ["cadd.phred"] });
	});

	it("reads the field names of a query, not quoted text, escaped colons or genomic coordinates", () => {
		expect(queryFieldReferences('cadd.phred:>20 AND -cosmic.cosmic_id:COSM476 OR _exists_:dbnsfp')).toEqual(["cadd.phred", "cosmic.cosmic_id", "dbnsfp"]);
		expect(queryFieldReferences('_id:"chr7:g.140453136A>T" chr1:69000-70000 rs58991260')).toEqual(["_id"]);
		expect(queryFieldReferences("symbol:CDK2 AND (taxid:9606 OR uniprot.Swiss-Prot:P24941)")).toEqual(["symbol", "taxid", "uniprot.Swiss-Prot"]);
		expect(queryFieldReferences("aspirin")).toEqual([]);
		expect(queryFieldReferences("drugbank\\:DB00945")).toEqual([]);
		expect(commercialRequestRule("variant", "/query", { q: "dbsnp.rsid:rs1", fields: "all" })).toEqual({ params: { q: "dbsnp.rsid:rs1", fields: "all" }, body: undefined, stripped: [] });
		expect(commercialRequestRule("variant", "/query", { q: "rs1", fields: "*,cadd" })).toEqual({ params: { q: "rs1", fields: "*" }, body: undefined, stripped: ["cadd"] });
		// A POST `q` is a list of identifiers, not query syntax.
		expect(commercialRequestRule("disease", "/query", undefined, { q: "MONDO:0007947,DOID:14323", scopes: "_id,mondo.xrefs.doid" })).not.toHaveProperty("refusal");
	});

	it("refuses a response that is not a JSON record", () => {
		expect(applyCommercialFilter("gene", "1017")).toHaveProperty("refusal");
		expect(applyCommercialFilter("gene", [])).toEqual({ data: [] });
	});
});
