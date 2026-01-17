// Client
export { createNotionClient, type NotionClient } from './client.js';

// OAuth
export {
  getAuthorizationUrl,
  exchangeCodeForToken,
  createOAuthConfig,
  NotionOAuthError,
  type NotionOAuthConfig,
} from './oauth.js';

// Services
export { setupNotionDatabases, type DatabaseSetupResult } from './services/setup.js';

export {
  createTask,
  completeTask,
  markDiscussed,
  queryTasks,
  queryTasksDueToday,
  queryActiveActions,
  queryAgendaForPerson,
  queryActiveProjects,
  queryWaitingTasks,
  querySomedayTasks,
  queryTasksByContext,
  findTaskByText,
  extractTaskTitle,
  extractTaskDueDate,
  extractTaskContext,
  extractTaskPriority,
  isTaskDueToday,
  type CreateTaskData,
} from './services/tasks.js';

export {
  createPerson,
  syncPeopleFromNotion,
  queryPeopleWithPending,
  type CreatePersonData,
} from './services/people.js';
