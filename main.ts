import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerLookupVersionTool } from "./src/tools/lookup-version.ts";
import { registerListVersionsTool } from "./src/tools/list-versions.ts";
import { registerCheckVulnerabilitiesTool } from "./src/tools/check-vulnerabilities.ts";
import { registerAnalyzeDependenciesTool } from "./src/tools/analyze-dependencies.ts";
import { registerGetPackageDocsTool } from "./src/tools/get-package-docs.ts";
import { registerGetLicensesTool } from "./src/tools/get-licenses.ts";
import { registerFindParentVersionTool } from "./src/tools/find-parent-version.ts";

const server = new McpServer({
  name: "mcp-dependency-version",
  version: "1.0.0",
});

// Register all tools
registerLookupVersionTool(server);
registerListVersionsTool(server);
registerCheckVulnerabilitiesTool(server);
registerAnalyzeDependenciesTool(server);
registerGetPackageDocsTool(server);
registerGetLicensesTool(server);
registerFindParentVersionTool(server);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
