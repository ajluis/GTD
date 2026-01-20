/**
 * @gtd/mcp - Model Context Protocol Client Package
 *
 * This package provides MCP client capabilities for the GTD agent system.
 * It enables the agent to connect to external tools and services via MCP.
 *
 * ## Key Concepts
 *
 * **MCP (Model Context Protocol)** is an open protocol for AI-tool integration:
 * - Tools: Functions the AI can invoke (like create_task, get_projects)
 * - Resources: Data the AI can read
 * - Prompts: Pre-defined prompt templates
 *
 * ## Architecture Decision
 *
 * By using MCP instead of direct API clients:
 * 1. We get standardized tool interfaces that work with any LLM
 * 2. We can add new integrations (Calendar, Email) by just connecting new MCP servers
 * 3. The agent loop doesn't need to know about specific APIs
 * 4. Todoist becomes the source of truth - no data duplication
 *
 * ## Usage
 *
 * ```typescript
 * import { connectTodoist, createMCPToolAdapters, todoistEntityExtractor } from '@gtd/mcp';
 *
 * // Connect to Todoist
 * const todoist = await connectTodoist(user.todoistAccessToken);
 *
 * // Use directly
 * const tasks = await todoist.getTasksDueToday();
 * await todoist.createTask({ content: "Buy milk", project: "Personal" });
 *
 * // Or create tool adapters for the agent loop
 * const tools = createMCPToolAdapters({
 *   client: todoist.getMCPClient(),
 *   entityExtractor: todoistEntityExtractor,
 * });
 * ```
 */

// Core MCP Client
export { MCPClient, createMCPClient } from './client.js';

// Todoist MCP Integration
export {
  TodoistMCPClient,
  connectTodoist,
  createTodoistMCPClient,
  TODOIST_MCP_URL,
  type TodoistMCPConfig,
  type CreateTaskParams,
  type GetTasksParams,
  type UpdateTaskParams,
} from './todoist.js';

// Tool Adapter (for agent loop integration)
export {
  createMCPToolAdapters,
  todoistEntityExtractor,
  MCPToolSet,
  type MCPToolAdapterOptions,
} from './tool-adapter.js';

// Types
export type {
  // Protocol types
  MCPClientConfig,
  MCPServerInfo,
  MCPCapabilities,
  MCPConnectionState,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,

  // Tool types
  MCPTool,
  MCPToolInputSchema,
  MCPSchemaProperty,
  MCPToolCallRequest,
  MCPToolCallResult,
  MCPContent,
  MCPTextContent,
  MCPImageContent,
  MCPResourceContent,

  // Resource types
  MCPResource,
  MCPResourceContents,

  // Prompt types
  MCPPrompt,
  MCPPromptArgument,
  MCPPromptMessage,

  // Todoist types
  TodoistTask,
  TodoistDue,
  TodoistProject,
  TodoistLabel,
  TodoistSection,
  TodoistComment,
} from './types.js';
