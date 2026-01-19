/**
 * Settings Lookup Tool
 * Get user preferences and account info
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import { users, tasks, people } from '@gtd/database';
import { eq, and, ne, count } from 'drizzle-orm';

export const getUserSettings: Tool = {
  name: 'get_user_settings',
  description: 'Get the user\'s current settings and preferences including timezone, digest time, weekly review schedule, and account stats.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    try {
      const user = await context.db.query.users.findFirst({
        where: eq(users.id, context.userId),
      });

      if (!user) {
        return {
          success: false,
          error: 'User not found',
        };
      }

      return {
        success: true,
        data: {
          settings: {
            timezone: user.timezone,
            digestTime: user.digestTime,
            meetingReminderHours: user.meetingReminderHours,
            weeklyReviewDay: user.weeklyReviewDay,
            weeklyReviewTime: user.weeklyReviewTime,
          },
          status: user.status,
          stats: {
            totalTasksCaptured: user.totalTasksCaptured,
            totalTasksCompleted: user.totalTasksCompleted,
          },
          notion: {
            connected: !!user.notionAccessToken,
            workspaceName: user.notionWorkspaceName,
          },
        },
      };
    } catch (error) {
      console.error('[get_user_settings] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get settings',
      };
    }
  },
};

export const getProductivityStats: Tool = {
  name: 'get_productivity_stats',
  description: 'Get detailed productivity statistics including task counts by type, completion rates, and recent activity.',
  parameters: {
    type: 'object',
    properties: {
      daysBack: {
        type: 'number',
        description: 'Number of days to look back (default 7)',
        default: 7,
      },
    },
    required: [],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { daysBack = 7 } = params as { daysBack?: number };

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);

      // Get task counts by type
      const allTasks = await context.db.query.tasks.findMany({
        where: eq(tasks.userId, context.userId),
      });

      type TaskType = typeof allTasks[0];
      const activeTasks = allTasks.filter(
        (t: TaskType) => t.status !== 'completed' && t.status !== 'discussed'
      );
      const completedTasks = allTasks.filter(
        (t: TaskType) => t.status === 'completed' || t.status === 'discussed'
      );

      // Recent completions
      const recentCompletions = completedTasks.filter(
        (t: TaskType) => t.completedAt && t.completedAt >= cutoffDate
      );

      // Recent additions
      const recentAdditions = allTasks.filter(
        (t: TaskType) => t.createdAt >= cutoffDate
      );

      // Tasks by type
      const byType = {
        action: activeTasks.filter((t: TaskType) => t.type === 'action').length,
        project: activeTasks.filter((t: TaskType) => t.type === 'project').length,
        waiting: activeTasks.filter((t: TaskType) => t.type === 'waiting').length,
        someday: activeTasks.filter((t: TaskType) => t.type === 'someday').length,
        agenda: activeTasks.filter((t: TaskType) => t.type === 'agenda').length,
      };

      // Tasks by context
      const byContext = {
        computer: activeTasks.filter((t: TaskType) => t.context === 'computer').length,
        phone: activeTasks.filter((t: TaskType) => t.context === 'phone').length,
        home: activeTasks.filter((t: TaskType) => t.context === 'home').length,
        outside: activeTasks.filter((t: TaskType) => t.context === 'outside').length,
        unassigned: activeTasks.filter((t: TaskType) => !t.context).length,
      };

      // Overdue tasks
      const today = new Date().toISOString().split('T')[0];
      const overdueTasks = activeTasks.filter(
        (t: TaskType) => t.dueDate && today && t.dueDate < today
      );

      // People count
      const userPeople = await context.db.query.people.findMany({
        where: and(
          eq(people.userId, context.userId),
          eq(people.active, true)
        ),
      });

      return {
        success: true,
        data: {
          period: {
            days: daysBack,
            from: cutoffDate.toISOString().split('T')[0],
            to: today,
          },
          summary: {
            totalActive: activeTasks.length,
            totalCompleted: completedTasks.length,
            recentlyCompleted: recentCompletions.length,
            recentlyAdded: recentAdditions.length,
            netProgress: recentCompletions.length - recentAdditions.length,
            overdue: overdueTasks.length,
          },
          byType,
          byContext,
          people: {
            total: userPeople.length,
            withPendingAgenda: userPeople.filter((p: typeof userPeople[0]) =>
              activeTasks.some((t: TaskType) => t.personId === p.id && t.type === 'agenda')
            ).length,
          },
        },
      };
    } catch (error) {
      console.error('[get_productivity_stats] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get stats',
      };
    }
  },
};
