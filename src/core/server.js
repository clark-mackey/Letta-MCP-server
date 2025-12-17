#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import http from 'http';
import https from 'https';
import Letta from '@letta-ai/letta-client';
import { createLogger } from './logger.js';

/**
 * Core LettaServer class that handles initialization and API communication
 */
export class LettaServer {
    /**
     * Initialize the Letta MCP server
     */
    constructor() {
        // Create logger for this module
        this.logger = createLogger('LettaServer');

        // Guard: if the logger was mocked and returned a falsy value,
        // provide a minimal fallback logger so tests don't throw when
        // calling `this.logger.error` or `this.logger.info`.
        if (!this.logger || typeof this.logger.error !== 'function') {
            /* eslint-disable no-console */
            this.logger = {
                info: (...args) => console.log(...args),
                error: (...args) => console.error(...args),
                warn: (...args) => console.warn(...args),
                child: () => this.logger,
            };
            /* eslint-enable no-console */
        }

        // Initialize MCP server
        this.server = new Server(
            {
                name: 'letta-server',
                version: '0.1.0',
            },
            {
                capabilities: {
                    tools: {
                        listChanged: true,
                    },
                    prompts: {
                        listChanged: true,
                    },
                    resources: {
                        subscribe: true,
                        listChanged: true,
                    },
                },
            },
        );

        // Set up error handler
        this.server.onerror = (error) => this.logger.error('MCP Error', { error });

        // Flag to track if handlers have been registered
        this.handlersRegistered = false;

        // Validate environment variables
        this.apiBase = process.env.LETTA_BASE_URL ?? '';
        this.password = process.env.LETTA_PASSWORD ?? '';
        if (!this.apiBase) {
            throw new Error('Missing required environment variable: LETTA_BASE_URL');
        }

        // Initialize axios instance (keep for backward compatibility)
        if (!this.apiBase.endsWith('/v1')) {
            this.apiBase = `${this.apiBase}/v1`;
        }

        // Configure HTTP/HTTPS agents with connection pooling
        // These settings follow best practices for production environments:
        // - keepAlive: Reuse TCP connections for multiple requests
        // - maxSockets: Limit concurrent connections per host (prevents exhaustion)
        // - maxFreeSockets: Keep warm connections in pool for faster requests
        // - timeout: Socket timeout for connection establishment
        const httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 50, // Max concurrent connections per host
            maxFreeSockets: 10, // Keep 10 connections warm in pool
            timeout: 60000, // 60s socket timeout
        });

        const httpsAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 50,
            maxFreeSockets: 10,
            timeout: 60000,
        });

        this.api = axios.create({
            baseURL: this.apiBase,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            httpAgent,
            httpsAgent,
            timeout: 30000, // 30s request timeout
        });

        // Initialize Letta SDK client
        // The SDK provides type-safe methods for Letta API operations
        const baseUrl = process.env.LETTA_BASE_URL || '';
        this.client = new Letta({
            baseUrl: baseUrl.endsWith('/v1') ? baseUrl.slice(0, -3) : baseUrl,
            token: this.password,
        });
    }

    /**
     * Get standard headers for API requests
     * @returns {Object} Headers object
     */
    getApiHeaders() {
        return {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-BARE-PASSWORD': `password ${this.password}`,
            Authorization: `Bearer ${this.password}`,
        };
    }

    /**
     * Create a standard error response
     * @param {Error|string} error - The error object or message
     * @param {string} [context] - Additional context for the error
     * @throws {McpError} Always throws an McpError for proper JSON-RPC handling
     */
    createErrorResponse(error, context) {
        let errorMessage = '';
        let errorCode = ErrorCode.InternalError;
        let troubleshooting = '';

        if (typeof error === 'string') {
            errorMessage = error;
        } else if (error instanceof Error) {
            errorMessage = error.message;

            // Handle specific HTTP error codes with actionable troubleshooting
            if (error.response?.status === 404) {
                errorCode = ErrorCode.InvalidRequest;
                errorMessage = `Resource not found: ${error.message}`;
                troubleshooting = 'Check that the agent_id or resource ID exists and is correct.';
            } else if (error.response?.status === 422) {
                errorCode = ErrorCode.InvalidParams;
                errorMessage = `Validation error: ${error.message}`;
                troubleshooting = 'Check the request parameters match the expected schema.';
            } else if (error.response?.status === 401 || error.response?.status === 403) {
                errorCode = ErrorCode.InvalidRequest;
                errorMessage = `Authentication/Authorization error: ${error.message}`;
                troubleshooting = 'Check LETTA_PASSWORD environment variable and API credentials.';
            } else if (error.response?.status === 500) {
                // Parse Letta's generic 500 errors and provide helpful context
                const detail = error.response?.data?.detail || '';
                if (detail === 'An unknown error occurred' || detail === '') {
                    errorMessage = 'Letta server internal error';
                    troubleshooting = [
                        'Common causes:',
                        '1. Agent embedding model misconfigured (check agent embedding_config)',
                        '2. Invalid API key for embedding provider (OpenAI, Ollama, etc.)',
                        '3. Embedding service unreachable',
                        '4. Agent was created with different embedding model than currently configured',
                        '',
                        'To diagnose: Check Letta server logs with: docker logs <letta-container>',
                    ].join('\n');
                } else {
                    errorMessage = `Letta server error: ${detail}`;
                }
            }
        } else {
            errorMessage = 'Unknown error occurred';
        }

        // Add context if provided
        if (context) {
            errorMessage = `${context}: ${errorMessage}`;
        }

        // Add additional details if available
        if (error?.response?.data) {
            const data = error.response.data;
            // Don't repeat generic "unknown error" message for 500 errors
            const isGeneric500 =
                error.response?.status === 500 && data.detail === 'An unknown error occurred';
            if (!isGeneric500) {
                try {
                    errorMessage += ` Details: ${JSON.stringify(data)}`;
                } catch {
                    // Handle circular references gracefully
                    errorMessage += ' Details: [complex data - could not serialize]';
                }
            }
        }

        // Add troubleshooting hints
        if (troubleshooting) {
            errorMessage += `\n\nTroubleshooting:\n${troubleshooting}`;
        }

        throw new McpError(errorCode, errorMessage);
    }

    /**
     * Map HTTP status codes to MCP error codes
     * @param {number} statusCode - HTTP status code
     * @returns {ErrorCode} Corresponding MCP error code
     */
    mapErrorCode(statusCode) {
        switch (statusCode) {
            case 400:
                return ErrorCode.InvalidParams;
            case 401:
            case 403:
                return ErrorCode.InvalidRequest;
            case 404:
                return ErrorCode.InvalidRequest;
            case 422:
                return ErrorCode.InvalidParams;
            case 429:
                return ErrorCode.InvalidRequest;
            case 500:
            case 502:
            case 503:
            case 504:
                return ErrorCode.InternalError;
            default:
                return ErrorCode.InternalError;
        }
    }

    /**
     * Wrapper for SDK calls that converts SDK errors to MCP errors
     * Handles axios errors from API calls
     * @param {Function} sdkFunction - Async function that makes SDK calls
     * @param {string} [context] - Additional context for error messages
     * @returns {Promise<any>} Result from the SDK call
     * @throws {McpError} Always throws McpError on failure for proper JSON-RPC handling
     */
    async handleSdkCall(sdkFunction, context) {
        try {
            return await sdkFunction();
        } catch (error) {
            this.logger.error('SDK call failed:', { error, context });

            let errorMessage = '';
            let errorCode = ErrorCode.InternalError;

            // Handle axios errors
            if (error.response) {
                // Axios error format: { response: { status, data } }
                const statusCode = error.response.status || 500;
                errorCode = this.mapErrorCode(statusCode);
                errorMessage = error.message || 'Request failed';

                // Include response data if available
                if (error.response.data) {
                    const dataStr =
                        typeof error.response.data === 'string'
                            ? error.response.data
                            : JSON.stringify(error.response.data);
                    errorMessage += ` - ${dataStr}`;
                }
            }
            // Handle generic errors
            else if (error instanceof Error) {
                errorMessage = error.message || 'Unknown error occurred';
            } else {
                errorMessage = 'Unknown SDK error occurred';
            }

            // Add context if provided
            if (context) {
                errorMessage = `${context}: ${errorMessage}`;
            }

            throw new McpError(errorCode, errorMessage);
        }
    }
}
