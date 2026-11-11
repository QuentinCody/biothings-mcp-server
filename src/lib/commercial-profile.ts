/**
 * The source-license rule for a reselling caller (`licenseProfile: "commercial"`).
 *
 * License audit 2026-11-10: "Strip the non-commercial source fields (CADD,
 * DrugBank, dbNSFP, COSMIC, SIDER, UMLS) in the BioThings server."
 *
 * Each top-level field of a BioThings record comes from one source. The rule is
 * an ALLOWLIST per service: a field stays only when its source license permits
 * commercial use. A field whose license is absent, non-commercial or unclear is
 * removed (fail closed), and so is each field that is not in the list. The
 * licenses come from the metadata routes (`src.<name>.license`, `license_url`;
 * observed 2026-11-10) and from the provider pages that they name:
 *
 * Removed by the audit:
 * - cadd: metadata license null, license_url http://cadd.gs.washington.edu/contact.
 *   https://cadd.gs.washington.edu/: "CADD scores are freely available for all
 *   non-commercial applications." docs.myvariant.info data page: "CADD data are
 *   free for non-commercial use only".
 * - dbnsfp: metadata license null, version "4.8a". https://sites.google.com/site/jpopgen/dbNSFP:
 *   "dbNSFP4.9a suitable for academic use"; "dbNSFP does not grant the
 *   non-academic usage of those scores/contents".
 * - cosmic: metadata license null. https://www.cosmickb.org/licensing/ (the
 *   target of http://cancer.sanger.ac.uk/cosmic/license): "If your use case falls
 *   within these descriptions, you will require a commercial licence."
 * - drugbank: metadata says "CC0" with license_url https://go.drugbank.com/releases/latest#open-data,
 *   but that page gives CC0 only to the Vocabulary and Structures sets; the
 *   MyChem field carries the full record: "These DrugBank datasets are released
 *   under a Creative Common's Attribution-NonCommercial 4.0 International License."
 * - sider: metadata license "CC BY-NC-SA 3.0" (ftp://xi.embl.de/SIDER/LICENSE).
 * - umls (MyGene, MyChem, MyDisease): metadata license null.
 *   https://www.nlm.nih.gov/research/umls/knowledge_sources/metathesaurus/release/license_agreement.html:
 *   "LICENSEE is prohibited from distributing the UMLS Metathesaurus or subsets of it".
 *
 * Also removed: snpedia ("CC BY-NC-SA"), ctd (CTD forbids commercial use without
 * permission, see the Monarch rule), and each field whose source has no license
 * in the metadata and no verified provider page (evs, geno2mp, grasp, gwassnps,
 * emv, mutdb, docm, wellderly, ginas, gsrs, hpo, disease_ontology, pathway and
 * its parts, reactome, clingen, pantherdb, exons, interpro, pfam, ...).
 *
 * Kept, with the evidence:
 * - NCBI (dbsnp, clinvar, Entrez Gene fields, Taxonomy fields): https://www.ncbi.nlm.nih.gov/home/about/policies/
 *   "NCBI itself places no restrictions on the use or distribution of the data contained therein."
 * - Ensembl (ensembl, genomic_pos*): "Ensembl imposes no restrictions on access to,
 *   or use of, the data provided" (ensembl.org/info/about/legal/disclaimer.html).
 * - UniProt (uniprot, pdb, pir, ipi, uniprot_name): "We have chosen to apply the
 *   Creative Commons Attribution 4.0 International (CC BY 4.0) License"
 *   (https://ftp.uniprot.org/pub/databases/uniprot/LICENSE).
 * - GO (go): "licensed under the Creative Commons Attribution 4.0 Unported License"
 *   (geneontology.org/docs/go-citation-policy/).
 * - HGNC (prev_symbol): metadata "CC0 1.0". orthology_agr (agr): "CC BY 4.0".
 *   mygene_unii / unii: "Creative Commons CC0 1.0 Universal" / "public domain".
 * - gnomad (gnomad_exome, gnomad_genome), exac (exac, exac_nontcga): metadata
 *   "ODbL". ODbL requires attribution; each source object keeps its `_license` URL.
 * - civic: license_url https://creativecommons.org/publicdomain/zero/1.0/.
 *   cgi: "CC0 1.0 Universal". snpeff: "LGPLv3".
 * - MyChem: pubchem, ndc, fda_orphan_drug "public domain"; aeolus "CC0 1.0";
 *   drugcentral, pharmgkb, gtopdb, unichem "CC BY-SA 4.0"; chebi: "The data on this
 *   website is available under the Creative Commons License (CC BY 4.0)"
 *   (ebi.ac.uk/chebi); chembl: "Provided under a Creative Commons
 *   Attribution-ShareAlike 3.0 Unported license" (ebi.ac.uk/chembl).
 * - mondo: "Creative Commons Attribution 4.0 International" (github.com/monarch-initiative/mondo LICENSE).
 */
import { type ApiFetchFn, commercialUseRefusal } from "@bio-mcp/shared/codemode/catalog";
import { MYCHEM_BASE, MYDISEASE_BASE, MYGENE_BASE, MYTAXON_BASE, MYVARIANT_BASE } from "./http";

export type BioThingsService = "gene" | "variant" | "chem" | "disease" | "taxon";
type Refusal = ReturnType<typeof commercialUseRefusal>;
type Params = Parameters<ApiFetchFn>[0]["params"];

/** Fields that identify a record or a hit. They carry no source content and always stay. */
export const IDENTIFIER_FIELDS: readonly string[] = ["_id", "_version", "_score", "query", "notfound"];

const NCBI_GENE = [
	"entrezgene", "symbol", "name", "alias", "other_names", "taxid", "type_of_gene", "map_location",
	"summary", "generif", "accession", "refseq", "homologene", "locus_tag", "retired", "unigene",
	// Cross-reference identifiers from the NCBI gene_info dbXrefs column.
	"HGNC", "MIM", "MGI", "RGD", "FLYBASE", "WormBase", "ZFIN", "SGD", "TAIR", "Xenbase", "Vega",
	"HPRD", "RATMAP", "AnimalQTLdb", "miRBase", "AllianceGenome",
];
const NCBI_TAXONOMY = [
	"taxid", "scientific_name", "common_name", "genbank_common_name", "other_names", "rank",
	"parent_taxid", "lineage", "ancestors", "children", "has_gene",
];

/** The top-level source fields, per service, whose license permits commercial use. */
export const COMMERCIAL_SOURCE_FIELDS: Readonly<Record<BioThingsService, readonly string[]>> = {
	gene: [
		...NCBI_GENE, "go", "prev_symbol", "ensembl", "genomic_pos", "genomic_pos_hg19", "genomic_pos_mm9",
		"uniprot", "pdb", "pir", "ipi", "exac", "agr", "unii", "chembl", "pharmgkb",
	],
	// chrom, hg19, hg38, vcf, observed and _seqhashed are the coordinates of the variant itself.
	variant: [
		"chrom", "hg19", "hg38", "vcf", "observed", "_seqhashed", "dbsnp", "clinvar",
		"gnomad_exome", "gnomad_genome", "exac", "exac_nontcga", "civic", "cgi", "snpeff",
	],
	chem: [
		"pubchem", "unii", "ndc", "fda_orphan_drug", "aeolus", "chebi", "chembl", "drugcentral",
		"pharmgkb", "gtopdb", "unichem",
	],
	disease: ["mondo"],
	taxon: [...NCBI_TAXONOMY, "uniprot_name"],
};

/** Keys of a GET /query page around its hits. */
const ENVELOPE_FIELDS = new Set(["took", "total", "max_score", "hits", "_scroll_id", "max_total", "facets"]);
const IDENTIFIERS = new Set(IDENTIFIER_FIELDS);
const ALLOWED = Object.fromEntries(
	Object.entries(COMMERCIAL_SOURCE_FIELDS).map(([service, fields]) => [service, new Set(fields)]),
) as Record<BioThingsService, Set<string>>;
const METADATA_URL: Record<BioThingsService, string> = {
	gene: `${MYGENE_BASE}/metadata`,
	variant: `${MYVARIANT_BASE}/metadata`,
	chem: `${MYCHEM_BASE}/metadata`,
	disease: `${MYDISEASE_BASE}/metadata`,
	taxon: `${MYTAXON_BASE}/metadata`,
};

export const REASON = "The commercial profile keeps only source fields whose license permits commercial use. "
	+ "It removes CADD, dbNSFP, COSMIC, DrugBank, SIDER, UMLS, CTD and SNPedia, and each source whose license is absent or unclear.";
export const licenseTerms = (service: BioThingsService) =>
	`Source licenses: ${METADATA_URL[service]} (src.<name>.license, license_url). ODbL sources (gnomAD, ExAC) require attribution: keep the _license URL of each source object.`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const topLevel = (field: string) => field.trim().replace(/^[-+]/, "").split(".")[0];
const csv = (value: unknown): string[] =>
	(Array.isArray(value) ? value : [value])
		.filter((item) => item !== undefined && item !== null)
		.flatMap((item) => String(item).split(","))
		.map((item) => item.trim())
		.filter((item) => item.length > 0);

/** True when a field (`cadd.phred`, `dbsnp`, `_id`) may reach a commercial caller from this service. */
export function isCommercialField(service: BioThingsService, field: string): boolean {
	const top = topLevel(field);
	return IDENTIFIERS.has(top) || ALLOWED[service].has(top);
}

/**
 * Split a comma-separated field list into the fields that stay and the fields
 * that are removed. `all` and `*` (every field) stay: the response filter then
 * removes the fields that are not on the allowlist.
 */
export function splitFields(service: BioThingsService, value: unknown): { kept: string[]; removed: string[] } {
	const fields = csv(value);
	const keep = (field: string) => field === "all" || field === "*" || isCommercialField(service, field);
	return { kept: fields.filter(keep), removed: fields.filter((field) => !keep(field)) };
}

const GENOMIC_COORDINATE = /^chr(?:\d{1,2}|X|Y|M|MT)$/i;

/**
 * The field names that a BioThings (Lucene) `q` searches: `cadd.phred:>20`,
 * `-cosmic.cosmic_id:COSM476`, `_exists_:dbnsfp`. Quoted text and escaped
 * characters are not field names. A genomic coordinate (`chr7:g.140453136A>T`,
 * `chr1:69000-70000`) is not a field. An unfielded term searches the default
 * fields of the service and gives no name.
 */
export function queryFieldReferences(q: string): string[] {
	const plain = q.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\\./g, "_");
	const names: string[] = [];
	for (const match of plain.matchAll(/(?:^|[\s(+!&|-])([A-Za-z_@*][\w.*@-]*)\s*:\s*([A-Za-z_@*][\w.*@-]*)?/g)) {
		const [, name, value] = match;
		if (name === "_exists_" || name === "_missing_") names.push(value ?? name);
		else if (!GENOMIC_COORDINATE.test(name)) names.push(name);
	}
	return names;
}

const route = (service: BioThingsService) => `The ${service === "chem" ? "MyChem" : `My${service[0].toUpperCase()}${service.slice(1)}`}.info`;

function refusal(service: BioThingsService, what: string, why: string): { refusal: Refusal } {
	return { refusal: commercialUseRefusal(`${route(service)} ${what}`, `${why} ${licenseTerms(service)}`) };
}

/** True for the routes that describe the sources (build, versions, licenses, field names), not their data. */
export const isMetadataPath = (path: string) => /^\/metadata(?:\/fields)?\/?$/.test(path);

export interface CommercialRequest {
	params?: Params;
	body?: Record<string, string>;
	/** The top-level names of the fields removed from a `fields` list before the request. */
	stripped: string[];
}

/**
 * Decide, before the upstream request, what the commercial profile does with a
 * request to one service. `path` is the upstream path (`/query`, `/variant/{id}`).
 * The request is refused when its hits would be selected, sorted or counted by
 * a removed field (`q`, `scopes`, `sort`, `facets`), or when its `fields` list
 * names only removed fields. Removed fields leave a mixed `fields` list.
 */
export function commercialRequestRule(
	service: BioThingsService,
	path: string,
	params: Params,
	body?: Record<string, string>,
): CommercialRequest | { refusal: Refusal } {
	// A POST body `q` is a list of identifiers for `scopes`, not query syntax.
	if (/^\/query\/?$/.test(path)) {
		const refused = queryRefusal(service, params?.q);
		if (refused) return refused;
	}
	for (const source of [params, body]) {
		const refused = selectorRefusal(service, source);
		if (refused) return refused;
	}
	const stripped: string[] = [];
	const nextParams = withoutRemovedFields(service, params, stripped);
	if (nextParams && "refusal" in nextParams) return nextParams;
	const nextBody = withoutRemovedFields(service, body, stripped);
	if (nextBody && "refusal" in nextBody) return nextBody;
	return { params: nextParams?.value, body: nextBody?.value, stripped };
}

/** Refuse a GET `q` that names a removed field: its hits would come from that source. */
function queryRefusal(service: BioThingsService, q: unknown): { refusal: Refusal } | undefined {
	const query = csv(q).length > 0 ? (Array.isArray(q) ? q.join(" ") : String(q)) : "";
	const restricted = [...new Set(queryFieldReferences(query).filter((field) => !isCommercialField(service, field)))];
	if (restricted.length === 0) return undefined;
	return refusal(
		service,
		`query ${JSON.stringify(query)}`,
		`it searches inside ${restricted.join(", ")}, so its hits come from a source that does not permit commercial use. Search a kept field or an identifier.`,
	);
}

/** Refuse `scopes`, `sort`, `facets` or `aggs` that name a removed field. */
function selectorRefusal(service: BioThingsService, source: Record<string, unknown> | undefined): { refusal: Refusal } | undefined {
	for (const name of ["scopes", "sort", "facets", "aggs"]) {
		const { removed } = splitFields(service, source?.[name]);
		if (removed.length > 0) {
			return refusal(service, `parameter ${name}=${removed.join(",")}`, "it selects, sorts or counts hits by a source that does not permit commercial use.");
		}
	}
	return undefined;
}

/**
 * Remove the removed fields from `fields` (or its alias `filter`). Refuse a list
 * in which only identifier fields would stay. `stripped` collects the top-level names.
 */
function withoutRemovedFields<T extends Record<string, unknown>>(
	service: BioThingsService,
	source: T | undefined,
	stripped: string[],
): { value: T } | { refusal: Refusal } | undefined {
	if (!source) return undefined;
	const value: Record<string, unknown> = { ...source };
	for (const name of ["fields", "filter"]) {
		const { kept, removed } = splitFields(service, source[name]);
		if (removed.length === 0) continue;
		if (!kept.some((field) => !IDENTIFIERS.has(topLevel(field)))) {
			return refusal(service, `fields ${removed.join(",")}`, "these fields come only from sources that do not permit commercial use.");
		}
		stripped.push(...removed.map(topLevel));
		value[name] = kept.join(",");
	}
	return { value: value as T };
}

/** Remove each field that is not on the allowlist. `removed` collects the top-level names. */
export function stripRecord(service: BioThingsService, record: unknown, removed: Set<string>): unknown {
	if (!isRecord(record)) return record;
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (isCommercialField(service, key)) result[key] = value;
		else removed.add(topLevel(key));
	}
	return result;
}

export interface LicenseFilter {
	removed_fields: string[];
	reason: string;
	terms: string;
}

export const licenseFilter = (service: BioThingsService, removed: Iterable<string>): LicenseFilter => ({
	removed_fields: [...new Set(removed)].sort(),
	reason: REASON,
	terms: licenseTerms(service),
});

/**
 * Apply the allowlist to a BioThings JSON response: a batch array (each row), a
 * query page (each hit, and the facets), or one document. A page or a document
 * carries `_license_filter`. In a batch array, each row carries it when a field
 * was removed. `stripped` are the fields removed from the request.
 */
export function applyCommercialFilter(
	service: BioThingsService,
	data: unknown,
	stripped: readonly string[] = [],
): { data: unknown } | { refusal: Refusal } {
	const removed = new Set(stripped);
	if (Array.isArray(data)) {
		const rows = data.map((row) => stripRecord(service, row, removed));
		if (removed.size === 0) return { data: rows };
		const marker = licenseFilter(service, removed);
		return { data: rows.map((row) => (isRecord(row) ? { ...row, _license_filter: marker } : row)) };
	}
	if (!isRecord(data)) {
		return refusal(service, "response", "it is not a JSON record in which the source of each field can be checked.");
	}
	if (!Array.isArray(data.hits)) {
		const record = stripRecord(service, data, removed) as Record<string, unknown>;
		return { data: { ...record, _license_filter: licenseFilter(service, removed) } };
	}
	const page: Record<string, unknown> = { hits: data.hits.map((hit) => stripRecord(service, hit, removed)) };
	for (const [key, value] of Object.entries(data)) {
		if (key === "hits") continue;
		if (key === "facets") page.facets = stripRecord(service, value, removed);
		else if (ENVELOPE_FIELDS.has(key)) page[key] = value;
		else removed.add(key);
	}
	return { data: { ...page, _license_filter: licenseFilter(service, removed) } };
}
