// Client
export { TodoistClient, createTodoistClient } from './client.js';

// OAuth
export {
  getAuthorizationUrl,
  exchangeCodeForToken,
  createOAuthConfig,
  getUserInfo,
  TodoistOAuthError,
  type TodoistOAuthConfig,
  type TodoistOAuthTokenResponse,
  type TodoistUserInfo,
} from './oauth.js';

// Discovery Service (query Todoist structure dynamically)
export {
  discoverTodoistStructure,
  getProjectNames,
  getProjectNamesWithHierarchy,
  findProjectIdByName,
  findLabelIdByName,
  hasLabel,
  findProjectsByKeyword,
  type TodoistStructure,
  type DiscoveredProject,
} from './services/discovery.js';

// Labels Service (GTD label management)
export {
  ensureGTDLabels,
  buildTaskLabels,
  getPersonLabel,
  ensurePersonLabel,
  GTD_LABELS,
  CONTEXT_TO_LABEL,
  TYPE_TO_LABEL,
  type GTDLabel,
} from './services/labels.js';

// Task Service
export {
  createTask,
  createTaskWithRouting,
  completeTask,
  updateTask,
  deleteTask,
  getProjects,
  getLabels,
  createProject,
  deleteProject,
  type CreateTaskWithRoutingInput,
  type UpdateTaskData,
} from './services/tasks.js';

// Query Service (GTD queries via Todoist filters)
export {
  queryByContext,
  queryWaiting,
  queryOverdueWaiting,
  queryPersonAgenda,
  queryByProject,
  queryDueToday,
  queryDueTomorrow,
  queryOverdue,
  queryDueThisWeek,
  queryHighPriority,
  queryByLabel,
  searchTasks,
  queryNoDueDate,
  queryWithFilter,
  queryAllTasks,
  getTaskById,
  type TodoistTaskResult,
} from './services/queries.js';

// Types
export type { CreateTaskData, TodoistTask, TodoistProject, TodoistLabel } from './types.js';
