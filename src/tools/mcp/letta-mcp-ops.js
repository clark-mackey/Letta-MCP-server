/**
 * Tool handler for letta_mcp_ops - MCP Server Operations Hub
 * Provides unified interface for complete MCP server lifecycle management
 */
import { createLogger } from '../../core/logger.js';
import { mcpOpsInputSchema } from '../schemas/mcp-ops-schemas.js';
import { validateResponse } from '../../core/response-validator.js';
import { McpServerResponseSchema } from '../schemas/response-schemas.js';
import { extractArrayFromSdkResponse } from '../utils/sdk-helpers.js';

const logger = createLogger('letta_mcp_ops');

/**
 * Handle letta_mcp_ops tool requests
 * @param {Object} server - LettaServer instance
 * @param {Object} args - Tool arguments following mcpOpsInputSchema
 * @returns {Promise<Object>} MCP tool response with text content
 */
export async function handleLettaMcpOps(server, args) {
    const { operation } = args;

    logger.info(`Executing MCP operation: ${operation}`, { args });

    try {
        switch (operation) {
            case 'add':
                return await handleAddServer(server, args);
            case 'update':
                return await handleUpdateServer(server, args);
            case 'delete':
                return await handleDeleteServer(server, args);
            case 'test':
                return await handleTestServer(server, args);
            case 'connect':
                return await handleConnectServer(server, args);
            case 'resync':
                return await handleResyncServer(server, args);
            case 'execute':
                return await handleExecuteTool(server, args);
            case 'list_servers':
                return await handleListServers(server, args);
            case 'list_tools':
                return await handleListTools(server, args);
            case 'register_tool':
                return await handleRegisterTool(server, args);
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }
    } catch (error) {
        logger.error(`MCP operation failed: ${operation}`, { error, args });
        throw error;
    }
}

/**
 * Add a new MCP server
 * MIGRATED: Now using Letta SDK instead of axios
 */
async function handleAddServer(server, args) {
    const { server_config } = args;

    if (!server_config) {
        throw new Error('server_config is required for add operation');
    }

    const result = await server.handleSdkCall(async () => {
        // Use SDK client.tools.addMcpServer() method
        return await server.client.tools.addMcpServer(server_config);
    }, 'Adding MCP server');

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'add',
            server_name: server_config.serverName || server_config.name || 'unnamed',
            server_config: result,
            message: 'MCP server added successfully',
        },
        { context: 'mcp_ops' },
    );
}

/**
 * Update an existing MCP server
 * MIGRATED: Now using Letta SDK instead of axios
 */
async function handleUpdateServer(server, args) {
    const { server_name, server_config } = args;

    if (!server_name) {
        throw new Error('server_name is required for update operation');
    }
    if (!server_config) {
        throw new Error('server_config is required for update operation');
    }

    const result = await server.handleSdkCall(async () => {
        // Use SDK client.tools.updateMcpServer() method
        return await server.client.tools.updateMcpServer(server_name, server_config);
    }, 'Updating MCP server');

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'update',
            server_name,
            server_config: result,
            message: 'MCP server updated successfully',
        },
        { context: 'mcp_ops' },
    );
}

/**
 * Delete an MCP server
 * MIGRATED: Now using Letta SDK instead of axios
 */
async function handleDeleteServer(server, args) {
    const { server_name } = args;

    if (!server_name) {
        throw new Error('server_name is required for delete operation');
    }

    const result = await server.handleSdkCall(async () => {
        // Use SDK client.tools.deleteMcpServer() method
        return await server.client.tools.deleteMcpServer(server_name);
    }, 'Deleting MCP server');

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'delete',
            server_name,
            deleted_servers: result, // SDK returns array of deleted servers
            message: 'MCP server deleted successfully',
        },
        { context: 'mcp_ops' },
    );
}

/**
 * Test MCP server connection
 * MIGRATED: Now using Letta SDK instead of axios
 */
async function handleTestServer(server, args) {
    const { server_config } = args;

    if (!server_config) {
        throw new Error('server_config is required for test operation');
    }

    const startTime = Date.now();
    const result = await server.handleSdkCall(async () => {
        // Use SDK client.tools.testMcpServer() method
        return await server.client.tools.testMcpServer(server_config);
    }, 'Testing MCP server connection');
    const latency = Date.now() - startTime;

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'test',
            test_result: {
                connected: true,
                latency_ms: latency,
                ...result,
            },
            message: 'MCP server connection successful',
        },
        { context: 'mcp_ops' },
    );
}

/**
 * Connect to MCP server with OAuth
 * MIGRATED: Now using Letta SDK instead of axios
 * Note: SDK returns Stream for SSE, may need special handling
 */
async function handleConnectServer(server, args) {
    const { server_name, oauth_config } = args;

    if (!server_name) {
        throw new Error('server_name is required for connect operation');
    }
    if (!oauth_config) {
        throw new Error('oauth_config is required for connect operation');
    }

    const result = await server.handleSdkCall(async () => {
        // Use SDK client.tools.connectMcpServer() method
        // SDK returns Stream<StreamingResponse> for SSE
        return await server.client.tools.connectMcpServer({
            serverName: server_name,
            ...oauth_config,
        });
    }, 'Connecting to MCP server with OAuth');

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'connect',
            server_name,
            oauth_stream: result, // SDK returns Stream object for SSE
            message: 'OAuth flow initiated. SDK returns stream for authorization events.',
        },
        { context: 'mcp_ops' },
    );
}

/**
 * Resync MCP server tools
 * Note: SDK may not have direct support - keeping axios for now
 * TODO: Check if SDK adds resync support in future releases
 */
async function handleResyncServer(server, args) {
    const { server_name } = args;

    if (!server_name) {
        throw new Error('server_name is required for resync operation');
    }

    const result = await server.handleSdkCall(async () => {
        const headers = server.getApiHeaders();
        const response = await server.api.post(
            `/tools/mcp/servers/${encodeURIComponent(server_name)}/resync`,
            {},
            { headers },
        );
        return response.data;
    }, 'Resyncing MCP server');

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'resync',
            server_name,
            servers: result.tools || result,
            message: 'MCP server resynced successfully',
        },
        { context: 'mcp_ops' },
    );
}

/**
 * Execute a tool from an MCP server
 * Note: SDK may not have direct support - keeping axios for now
 * TODO: Check if SDK adds tool execution support in future releases
 */
async function handleExecuteTool(server, args) {
    const { server_name, tool_name, tool_args = {} } = args;

    if (!server_name) {
        throw new Error('server_name is required for execute operation');
    }
    if (!tool_name) {
        throw new Error('tool_name is required for execute operation');
    }

    const result = await server.handleSdkCall(async () => {
        const headers = server.getApiHeaders();
        const response = await server.api.post(
            `/tools/mcp/servers/${encodeURIComponent(server_name)}/tools/${encodeURIComponent(tool_name)}/execute`,
            tool_args,
            { headers },
        );
        return response.data;
    }, 'Executing MCP tool');

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'execute',
            server_name,
            tool_name,
            execution_result: result,
            message: 'Tool executed successfully',
        },
        { context: 'mcp_ops' },
    );
}

/**
 * List all MCP servers
 * MIGRATED: Now using Letta SDK instead of axios
 */
async function handleListServers(server, _args) {
    const result = await server.handleSdkCall(async () => {
        // Use SDK client.tools.listMcpServers() method
        return await server.client.tools.listMcpServers();
    }, 'Listing MCP servers');

    // SDK returns object with server names as keys
    const serversList = Object.entries(result || {}).map(([name, config]) => ({
        name,
        type: config.type || config.transport,
        status: config.status || 'unknown',
        ...config,
    }));

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'list_servers',
            servers: serversList,
            message: `Found ${serversList.length} MCP servers`,
        },
        { context: 'mcp_ops' },
    );
}

/**
 * List tools from an MCP server
 * MIGRATED: Now using Letta SDK instead of axios
 */
async function handleListTools(server, args) {
    const { server_name } = args;

    if (!server_name) {
        throw new Error('server_name is required for list_tools operation');
    }

    const result = await server.handleSdkCall(async () => {
        // Use SDK client.tools.listMcpToolsByServer() method
        return await server.client.tools.listMcpToolsByServer(server_name);
    }, 'Listing MCP server tools');

    // Extract tools array from SDK response
    const tools = extractArrayFromSdkResponse(result);

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'list_tools',
            server_name,
            tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                schema: t.schema || t.inputSchema,
            })),
            message: `Found ${tools.length} tools on server ${server_name}`,
        },
        { context: 'mcp_ops' },
    );
}

/**
 * Register an MCP tool in Letta
 * MIGRATED: Now using Letta SDK instead of axios
 */
async function handleRegisterTool(server, args) {
    const { server_name, tool_name } = args;

    if (!server_name) {
        throw new Error('server_name is required for register_tool operation');
    }
    if (!tool_name) {
        throw new Error('tool_name is required for register_tool operation');
    }

    const result = await server.handleSdkCall(async () => {
        // Use SDK client.tools.addMcpTool() method
        return await server.client.tools.addMcpTool(server_name, tool_name);
    }, 'Registering MCP tool in Letta');

    return validateResponse(
        McpServerResponseSchema,
        {
            success: true,
            operation: 'register_tool',
            server_name,
            tool_name,
            tool_id: result.id || result.tool_id,
            tool: result,
            message: `Tool ${tool_name} from ${server_name} registered successfully in Letta`,
        },
        { context: 'mcp_ops' },
    );
}

/**
 * Tool definition for letta_mcp_ops
 */
export const lettaMcpOpsDefinition = {
    name: 'letta_mcp_ops',
    description:
        'MCP Server Operations Hub - Unified tool for complete MCP server lifecycle management including server management (add, update, delete, test, connect, resync), tool operations (list_servers, list_tools, register_tool, execute). Provides 10 operations with discriminator-based operation routing. Replaces 10 individual MCP server endpoints.',
    inputSchema: mcpOpsInputSchema,
};
