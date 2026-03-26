import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createQueryDataHandler } from "@bio-mcp/shared/staging/utils";

interface QueryEnv {
	BIOTHINGS_DATA_DO?: unknown;
}

export function registerQueryData(server: McpServer, env?: QueryEnv): void {
	const handler = createQueryDataHandler("BIOTHINGS_DATA_DO", "biothings");

	server.registerTool(
		"biothings_query_data",
		{
			title: "Query Staged BioThings Data",
			description:
				"Query staged BioThings data using SQL. Use this when entity resolution responses are too large and have been staged with a data_access_id.",
			inputSchema: {
				data_access_id: z
					.string()
					.min(1)
					.describe("Data access ID for the staged dataset"),
				sql: z
					.string()
					.min(1)
					.describe("SQL query to execute against the staged data"),
				limit: z
					.number()
					.int()
					.positive()
					.max(10000)
					.default(100)
					.optional()
					.describe("Maximum number of rows to return (default: 100)"),
			},
		},
		async (args, extra) => {
			const runtimeEnv = env || (extra as { env?: QueryEnv })?.env || {};
			return handler(
				args as Record<string, unknown>,
				runtimeEnv as Record<string, unknown>,
			);
		},
	);
}
