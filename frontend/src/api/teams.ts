import { client } from './client'

export type TeamRecord = {
  id: number
  slug: string
  name: string
  managerUserId: number | null
  managerName: string | null
  managerEmail: string | null
  sortOrder: number
  memberCount: number
}

export async function listTeams(): Promise<TeamRecord[]> {
  const { data } = await client.get<{ teams: TeamRecord[] }>('/api/teams')
  return data.teams
}

export async function loadTeamMembers(teamId: number): Promise<{ employeeIds: number[] }> {
  const { data } = await client.get<{ employeeIds: number[] }>(
    `/api/admin/teams/${teamId}/members`,
  )
  return data
}

export async function saveTeamMembers(
  teamId: number,
  employeeIds: number[],
): Promise<{ memberCount: number }> {
  const { data } = await client.put<{ memberCount: number }>(
    `/api/admin/teams/${teamId}/members`,
    { employeeIds },
  )
  return data
}

export async function saveTeamManager(
  teamId: number,
  managerUserId: number | null,
): Promise<TeamRecord> {
  const { data } = await client.put<{ team: TeamRecord }>(`/api/admin/teams/${teamId}/manager`, {
    managerUserId,
  })
  return data.team
}
