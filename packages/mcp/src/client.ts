/**
 * MCP Client
 *
 * Generic Model Context Protocol client for connecting to MCP servers.
 * Handles the SSE-based transport, initialization handshake, and tool execution.
 *
 * The MCP protocol works as follows:
 * 1. Client sends POST to /sse endpoint to establish SSE stream
 * 2. Server sends back endpoint URL for making requests
 * 3. Client POSTs JSON-RPC requests to that endpoint
 * 4. Responses come via the SSE stream
 */

import type {
  MCPClientConfig,
  MCPServerInfo,
  MCPTool,
  MCPToolCallResult,
  MCPConnectionState,
  JSONRPCRequest,
  JSONRPCResponse,
  MCPContent,
} from './types.js';

/**
 * MCP Client for connecting to Model Context Protocol servers
 */
export class MCPClient {
  private config: Required<MCPClientConfig>;
  private state: MCPConnectionState = 'disconnected';
  private serverInfo: MCPServerInfo | null = null;
  private tools: MCPTool[] = [];
  private requestId = 0;
  private messageEndpoint: string | null = null;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private eventSource: EventSource | null = null;
  private abortController: AbortController | null = null;

  constructor(config: MCPClientConfig) {
    this.config = {
      serverUrl: config.serverUrl,
      authToken: config.authToken ?? '',
      timeout: config.timeout ?? 30000,
      debug: config.debug ?? false,
    };
  }

  /**
   * Get current connection state
   */
  get connectionState(): MCPConnectionState {
    return this.state;
  }

  /**
   * Get server information (available after connection)
   */
  get server(): MCPServerInfo | null {
    return this.serverInfo;
  }

  /**
   * Connect to the MCP server
   *
   * The Todoist MCP server uses HTTP with SSE for responses.
   * We establish a connection and perform the initialization handshake.
   */
  async connect(): Promise<MCPServerInfo> {
    if (this.state === 'connected') {
      return this.serverInfo!;
    }

    this.state = 'connecting';
    this.abortController = new AbortController();

    try {
      this.log('Connecting to MCP server:', this.config.serverUrl);

      // For HTTP-based MCP (like Todoist), we use direct HTTP requests
      // The server URL format is: https://ai.todoist.net/mcp
      // We send JSON-RPC requests directly via POST

      // Initialize the connection
      const initResponse = await this.sendRequest<MCPServerInfo>('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        clientInfo: {
          name: 'gtd-agent',
          version: '1.0.0',
        },
      });

      this.serverInfo = initResponse;
      this.log('Server initialized:', initResponse);

      // Send initialized notification
      await this.sendNotification('notifications/initialized', {});

      // Fetch available tools
      await this.refreshTools();

      this.state = 'connected';
      this.log('Connected successfully. Tools available:', this.tools.length);

      return this.serverInfo;
    } catch (error) {
      this.state = 'error';
      const err = error instanceof Error ? error : new Error(String(error));
      this.log('Connection failed:', err.message);
      throw err;
    }
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    this.eventSource?.close();
    this.eventSource = null;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();

    this.state = 'disconnected';
    this.serverInfo = null;
    this.tools = [];
    this.log('Disconnected');
  }

  /**
   * Get list of available tools
   */
  listTools(): MCPTool[] {
    return [...this.tools];
  }

  /**
   * Refresh the tools list from the server
   */
  async refreshTools(): Promise<MCPTool[]> {
    const response = await this.sendRequest<{ tools: MCPTool[] }>('tools/list', {});
    this.tools = response.tools || [];
    return this.tools;
  }

  /**
   * Call a tool by name with arguments
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<MCPToolCallResult> {
    this.ensureConnected();

    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}. Available tools: ${this.tools.map((t) => t.name).join(', ')}`);
    }

    this.log(`Calling tool: ${name}`, args);

    const result = await this.sendRequest<MCPToolCallResult>('tools/call', {
      name,
      arguments: args,
    });

    this.log(`Tool result:`, result);
    return result;
  }

  /**
   * Call a tool and extract text content from the result
   */
  async callToolForText(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<string> {
    const result = await this.callTool(name, args);
    return this.extractTextContent(result);
  }

  /**
   * Call a tool and parse JSON from the result
   */
  async callToolForJSON<T>(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<T> {
    const text = await this.callToolForText(name, args);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Failed to parse tool result as JSON: ${text.slice(0, 100)}`);
    }
  }

  /**
   * Send a JSON-RPC request to the server
   */
  private async sendRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.requestId;

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    this.log(`Sending request [${id}]:`, method);

    const response = await fetch(this.config.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.authToken
          ? { Authorization: `Bearer ${this.config.authToken}` }
          : {}),
      },
      body: JSON.stringify(request),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MCP request failed (${response.status}): ${errorText}`);
    }

    const jsonResponse = (await response.json()) as JSONRPCResponse<T>;

    if (jsonResponse.error) {
      throw new Error(
        `MCP error [${jsonResponse.error.code}]: ${jsonResponse.error.message}`
      );
    }

    return jsonResponse.result as T;
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    const request = {
      jsonrpc: '2.0' as const,
      method,
      params,
    };

    this.log(`Sending notification:`, method);

    const response = await fetch(this.config.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.authToken
          ? { Authorization: `Bearer ${this.config.authToken}` }
          : {}),
      },
      body: JSON.stringify(request),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.log(`Notification warning (${response.status}):`, errorText);
    }
  }

  /**
   * Ensure the client is connected
   */
  private ensureConnected(): void {
    if (this.state !== 'connected') {
      throw new Error(`MCP client not connected (state: ${this.state})`);
    }
  }

  /**
   * Extract text content from a tool result
   */
  private extractTextContent(result: MCPToolCallResult): string {
    if (result.isError) {
      const errorText = result.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      throw new Error(`Tool error: ${errorText}`);
    }

    return result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  }

  /**
   * Log debug messages
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[MCPClient]', ...args);
    }
  }
}

/**
 * Create an MCP client instance
 */
export function createMCPClient(config: MCPClientConfig): MCPClient {
  return new MCPClient(config);
}
