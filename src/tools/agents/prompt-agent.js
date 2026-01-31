import { createLogger } from '../../core/logger.js';

const logger = createLogger('prompt_agent');

// Convex URL for logging interactions (GEPA feedback loop)
const CONVEX_URL = process.env.CONVEX_URL || '';

/**
 * Log interaction to Convex for GEPA optimization (fire-and-forget)
 */
async function logToConvex(agentId, tenantId, input, output) {
    if (!CONVEX_URL) {
        return; // Silently skip if not configured
    }

    try {
        const response = await fetch(`${CONVEX_URL}/logInteraction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId,
                tenantId,
                input: input.slice(0, 5000), // Truncate to avoid huge payloads
                output: output.slice(0, 10000),
            }),
        });

        if (!response.ok) {
            logger.warn(`Failed to log to Convex: ${response.status}`);
        } else {
            logger.debug('Interaction logged to Convex');
        }
    } catch (error) {
        // Fire-and-forget - don't fail the main request
        logger.warn('Error logging to Convex:', error.message);
    }
}

/**
 * Parse SSE data and extract assistant message content
 */
function parseSSEData(buffer) {
    const dataLines = buffer
        .split('\n')
        .filter((line) => line.trim().startsWith('data: '));

    const messages = [];
    let assistantResponse = '';

    for (const line of dataLines) {
        try {
            const jsonStr = line.substring(6);
            const eventData = JSON.parse(jsonStr);

            if (eventData.message_type === 'assistant_message' && eventData.content) {
                assistantResponse = eventData.content;
            } else if (eventData.message_type === 'reasoning_message' && eventData.reasoning) {
                messages.push(`[Reasoning]: ${eventData.reasoning}`);
            } else if (eventData.delta && eventData.delta.content) {
                messages.push(eventData.delta.content);
            }
        } catch {
            // Skip unparseable lines
        }
    }

    return assistantResponse || messages.join('\n') || null;
}

/**
 * Tool handler for prompting an agent in the Letta system.
 * Uses true streaming to prevent timeout on long-running requests.
 */
export async function handlePromptAgent(server, args) {
    try {
        // Validate arguments
        if (!args.agent_id || !args.message) {
            throw new Error('Missing required arguments: agent_id and message');
        }

        const headers = server.getApiHeaders();

        // Get agent name first (fast call)
        const agentInfoResponse = await server.api.get(`/agents/${args.agent_id}`, { headers });
        const agentName = agentInfoResponse.data.name;

        // Use the newer /messages endpoint with streaming=true
        // This keeps the connection alive by sending data continuously
        const response = await server.api.post(
            `/agents/${args.agent_id}/messages`,
            {
                messages: [
                    {
                        role: 'user',
                        content: args.message,
                    },
                ],
                streaming: true,
                include_pings: true, // Keep-alive pings during long processing
            },
            {
                headers,
                responseType: 'stream',
                // No timeout - let stream handle it
                timeout: 0,
            },
        );

        // Process the stream - accumulate chunks as they arrive
        // This keeps the HTTP connection alive because data is flowing
        let buffer = '';
        let responseText = '';

        await new Promise((resolve, reject) => {
            response.data.on('data', (chunk) => {
                buffer += chunk.toString();
                // Try to extract response as we go
                const parsed = parseSSEData(buffer);
                if (parsed) {
                    responseText = parsed;
                }
            });

            response.data.on('end', () => {
                // Final parse
                if (!responseText) {
                    const parsed = parseSSEData(buffer);
                    responseText = parsed || "Received response but couldn't extract message content";
                }
                resolve();
            });

            response.data.on('error', (err) => {
                logger.error('Stream error:', err);
                reject(err);
            });
        });

        // Log to Convex for GEPA optimization (fire-and-forget, don't await)
        // Use 'mcp-user' as default tenant, can be enhanced with identity later
        const tenantId = args.identity_id || 'mcp-user';
        logToConvex(args.agent_id, tenantId, args.message, responseText).catch(() => {});

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        agent_id: args.agent_id,
                        agent_name: agentName,
                        message: args.message,
                        response: responseText,
                    }),
                },
            ],
        };
    } catch (error) {
        server.createErrorResponse(error);
    }
}

/**
 * Tool definition for prompt_agent
 */
export const promptAgentToolDefinition = {
    name: 'prompt_agent',
    description:
        'Send a message to an agent and get a response. Ensure the agent has necessary tools attached (see attach_tool) first. Use list_agents to find agent IDs.',
    inputSchema: {
        type: 'object',
        properties: {
            agent_id: {
                type: 'string',
                description: 'ID of the agent to prompt',
            },
            message: {
                type: 'string',
                description: 'Message to send to the agent',
            },
        },
        required: ['agent_id', 'message'],
    },
};
