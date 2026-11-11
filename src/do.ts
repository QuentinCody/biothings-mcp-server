import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import { fieldMap, record } from "./lib/completeness";

// Native JSON retains all source annotations and scalar types without guessing a wide SQL schema.
const hitRow = (row: unknown) => record(row) ? { _id: row._id, query: row.query, _score: row._score,
  notfound: row.notfound, taxid: row.taxid, native_json: JSON.stringify(row) } : { native_json: JSON.stringify(row) };

export class BioThingsDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
      ? value.structuredContent.data : value;
    if (record(data)) {
      if (typeof data.sql === "string" && Array.isArray(data.rows)) return { query_rows: data.rows.map(native => ({ native })) };
      if (typeof data.biothing_type === "string" && record(data.src)) return {
        builds: [{ biothing_type: data.biothing_type, build_date: data.build_date, build_version: data.build_version }],
        sources: Object.entries(data.src).map(([source_name, native]) => ({ source_name, native_json: JSON.stringify(native) })),
      };
      if (fieldMap(data)) return { fields: Object.entries(data).map(([field_name, native]) => ({
        field_name, type: (native as Record<string, unknown>).type, indexed: (native as Record<string, unknown>).index, native_json: JSON.stringify(native),
      })) };
      if (Array.isArray(data.hits)) return { hits: data.hits.map(hitRow) };
      if (typeof data._id === "string") return { records: [hitRow(data)] };
    }
    if (Array.isArray(data) && data.length) {
      if (data.every(row => record(row) && typeof row.found === "boolean" && record(row.native))) {
        const rows = data.map(row => { const { native, ...projection } = row as Record<string, unknown>; return { ...projection, native_json: JSON.stringify(native) }; });
        const table = data.some(row => record(row) && ("symbol" in row || "ensembl_gene" in row)) ? "genes"
          : data.some(row => record(row) && "hgvs_id" in row) ? "variants"
          : data.some(row => record(row) && ("chembl_id" in row || "pubchem_cid" in row)) ? "compounds" : "resolution_rows";
        return { [table]: rows };
      }
      return { hits: data.map(hitRow) };
    }
    return data;
  }
}
