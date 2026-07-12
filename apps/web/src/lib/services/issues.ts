import type { CreateHomeIssueInput, HomeIssue, UpdateHomeIssueInput } from '@sst-monorepo/core';
import * as rest from './rest-api';

export async function listMyIssues(): Promise<{ items: HomeIssue[] }> {
  const items = await rest.listIssues();
  return { items };
}

export async function createIssue(input: CreateHomeIssueInput): Promise<HomeIssue> {
  return rest.createIssue(input);
}

export async function updateIssue(
  issueId: string,
  input: UpdateHomeIssueInput
): Promise<HomeIssue> {
  return rest.updateIssue(issueId, input);
}
