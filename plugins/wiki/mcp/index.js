'use strict';

const { McpServer }            = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { tools }                = require('./src/tools');

const server = new McpServer({ name: 'wiki-mcp', version: '1.0.0' });

for (const [name, def] of Object.entries(tools)) {
  server.tool(name, def.description, def.inputSchema, def.handler);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('wiki-mcp running on stdio');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
