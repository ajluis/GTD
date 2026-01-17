import type { Client } from '@notionhq/client';
import { FREQUENCY_TO_NOTION, DAY_TO_NOTION } from '@gtd/shared-types';
import type { MeetingFrequency, DayOfWeek, PersonForMatching } from '@gtd/shared-types';

/**
 * Person data for creating in Notion
 */
export interface CreatePersonData {
  name: string;
  aliases?: string[];
  frequency?: MeetingFrequency | null;
  dayOfWeek?: DayOfWeek | null;
  notes?: string | null;
}

/**
 * Create a person in Notion People database
 *
 * @param notion - Authenticated Notion client
 * @param databaseId - People database ID
 * @param data - Person data
 * @returns Notion page ID
 */
export async function createPerson(
  notion: Client,
  databaseId: string,
  data: CreatePersonData
): Promise<string> {
  const properties: Record<string, any> = {
    Name: {
      title: [{ text: { content: data.name } }],
    },
    Active: {
      checkbox: true,
    },
  };

  // Add aliases as comma-separated text
  if (data.aliases && data.aliases.length > 0) {
    properties['Aliases'] = {
      rich_text: [{ text: { content: data.aliases.join(', ') } }],
    };
  }

  if (data.frequency) {
    properties['Frequency'] = {
      select: { name: FREQUENCY_TO_NOTION[data.frequency] },
    };
  }

  if (data.dayOfWeek) {
    properties['Day'] = {
      select: { name: DAY_TO_NOTION[data.dayOfWeek] },
    };
  }

  if (data.notes) {
    properties['Notes'] = {
      rich_text: [{ text: { content: data.notes } }],
    };
  }

  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties,
  });

  return page.id;
}

/**
 * Sync all active people from Notion to local cache format
 *
 * @param notion - Authenticated Notion client
 * @param databaseId - People database ID
 * @returns Array of people for matching
 */
export async function syncPeopleFromNotion(
  notion: Client,
  databaseId: string
): Promise<PersonForMatching[]> {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Active',
      checkbox: { equals: true },
    },
  });

  return response.results.map((page: any) => {
    const props = page.properties;

    // Extract name from title property
    const name = props.Name?.title?.[0]?.plain_text ?? 'Unknown';

    // Extract aliases from rich_text, split by comma
    const aliasesRaw = props.Aliases?.rich_text?.[0]?.plain_text ?? '';
    const aliases = aliasesRaw
      .split(',')
      .map((a: string) => a.trim().toLowerCase())
      .filter(Boolean);

    // Always include lowercase name as an alias
    aliases.push(name.toLowerCase());

    // Extract frequency
    const frequencyRaw = props.Frequency?.select?.name;
    const frequency = frequencyRaw
      ? (Object.entries(FREQUENCY_TO_NOTION).find(
          ([, v]) => v === frequencyRaw
        )?.[0] as MeetingFrequency) ?? null
      : null;

    // Extract day of week
    const dayRaw = props.Day?.select?.name;
    const dayOfWeek = dayRaw
      ? (Object.entries(DAY_TO_NOTION).find(
          ([, v]) => v === dayRaw
        )?.[0] as DayOfWeek) ?? null
      : null;

    return {
      id: page.id,
      name,
      aliases,
      frequency,
      dayOfWeek,
    };
  });
}

/**
 * Query all people from Notion with their pending agenda counts
 *
 * Note: Pending count comes from the Rollup property if configured
 */
export async function queryPeopleWithPending(
  notion: Client,
  databaseId: string
): Promise<Array<PersonForMatching & { pendingCount: number }>> {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Active',
      checkbox: { equals: true },
    },
    sorts: [{ property: 'Name', direction: 'ascending' }],
  });

  return response.results.map((page: any) => {
    const props = page.properties;
    const name = props.Name?.title?.[0]?.plain_text ?? 'Unknown';

    const aliasesRaw = props.Aliases?.rich_text?.[0]?.plain_text ?? '';
    const aliases = aliasesRaw
      .split(',')
      .map((a: string) => a.trim().toLowerCase())
      .filter(Boolean);
    aliases.push(name.toLowerCase());

    const frequencyRaw = props.Frequency?.select?.name;
    const frequency = frequencyRaw
      ? (Object.entries(FREQUENCY_TO_NOTION).find(
          ([, v]) => v === frequencyRaw
        )?.[0] as MeetingFrequency) ?? null
      : null;

    const dayRaw = props.Day?.select?.name;
    const dayOfWeek = dayRaw
      ? (Object.entries(DAY_TO_NOTION).find(
          ([, v]) => v === dayRaw
        )?.[0] as DayOfWeek) ?? null
      : null;

    // Get pending count from rollup (if configured)
    const pendingCount = props.Pending?.rollup?.number ?? 0;

    return {
      id: page.id,
      name,
      aliases,
      frequency,
      dayOfWeek,
      pendingCount,
    };
  });
}
