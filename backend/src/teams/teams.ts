import pg from "pg";
import { query, queryOne, withTransaction } from "../db/index.js";
import { refreshPendingManagerTierAssignees } from "../employeeRequests/workflow.js";

export const TEAM_DEFINITIONS = [
  {
    slug: "product",
    name: "Product",
    sortOrder: 1,
  },
  {
    slug: "design",
    name: "Design",
    managerEmail: "nikhil.varia@parmarketing.agency",
    sortOrder: 2,
  },
  {
    slug: "social-media",
    name: "Social Media",
    managerEmail: "rizwan.shaikh@parmarketing.agency",
    sortOrder: 3,
  },
  {
    slug: "seo",
    name: "SEO",
    managerEmail: "rizwan.shaikh@parmarketing.agency",
    sortOrder: 4,
  },
  {
    slug: "content",
    name: "Content",
    managerEmail: "rizwan.shaikh@parmarketing.agency",
    sortOrder: 5,
  },
  {
    slug: "performance-marketing",
    name: "Performance Marketing",
    managerEmail: "wasif.siddiqui@parmarketing.agency",
    sortOrder: 6,
  },
  {
    slug: "management",
    name: "Management",
    sortOrder: 7,
  },
  {
    slug: "others",
    name: "Others",
    sortOrder: 8,
  },
] as const;

/** Removed from product; dropped from DB on startup/migration. */
export const LEGACY_TEAM_SLUGS = ["social-media-seo"] as const;

const ACTIVE_TEAM_SLUGS = new Set<string>(TEAM_DEFINITIONS.map((def) => def.slug));

function isActiveTeamSlug(slug: string): boolean {
  return ACTIVE_TEAM_SLUGS.has(slug);
}

/** Fixed employee ↔ team placements (re-applied on API startup). */
type PinnedTeamRule = {
  slug: (typeof TEAM_DEFINITIONS)[number]["slug"];
  email?: string;
  /** When ESSL name differs from login (e.g. Dhananjay Parmar ↔ jay.parmar). */
  employeeCode?: string;
  /** Match employee by first name (case-insensitive). */
  matchFirstName?: string;
};

const PINNED_EMPLOYEE_TEAMS: PinnedTeamRule[] = [
  { email: "santosh.choudhary@parmarketing.agency", slug: "product" },
  { email: "nikhil.varia@parmarketing.agency", slug: "design" },
  { email: "rizwan.shaikh@parmarketing.agency", slug: "social-media" },
  { email: "wasif.siddiqui@parmarketing.agency", slug: "performance-marketing" },
  { email: "jay.parmar@parmarketing.agency", slug: "management", employeeCode: "PMPL01" },
  { email: "mansi.prasad@parmarketing.agency", slug: "management" },
  { matchFirstName: "Taqi", slug: "social-media" },
  { matchFirstName: "Kashish", slug: "social-media" },
  { employeeCode: "PMPL25", slug: "seo" },
  { matchFirstName: "Bipin", slug: "seo" },
  { matchFirstName: "Saksham", slug: "content" },
];

export type TeamRecord = {
  id: number;
  slug: string;
  name: string;
  managerUserId: number | null;
  managerName: string | null;
  managerEmail: string | null;
  sortOrder: number;
  memberCount: number;
};

type TeamRow = {
  id: number;
  slug: string;
  name: string;
  manager_user_id: number | null;
  manager_name: string | null;
  manager_email: string | null;
  sort_order: number;
  member_count: number;
};

function mapTeamRow(row: TeamRow): TeamRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    managerUserId: row.manager_user_id,
    managerName: row.manager_name,
    managerEmail: row.manager_email,
    sortOrder: row.sort_order,
    memberCount: row.member_count,
  };
}

const teamSelect = `
  SELECT t.id, t.slug, t.name, t.manager_user_id, t.sort_order,
         u.name AS manager_name, u.email AS manager_email,
         COUNT(e.id)::int AS member_count
  FROM teams t
  LEFT JOIN users u ON u.id = t.manager_user_id
  LEFT JOIN employees e ON e.team_id = t.id
`;

export async function seedTeams(): Promise<void> {
  for (const def of TEAM_DEFINITIONS) {
    const managerEmail =
      "managerEmail" in def && typeof def.managerEmail === "string" ? def.managerEmail : null;
    const manager = managerEmail
      ? await queryOne<{ id: number }>(`SELECT id FROM users WHERE lower(email) = lower($1)`, [
          managerEmail,
        ])
      : null;
    await query(
      `INSERT INTO teams (slug, name, manager_user_id, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             manager_user_id = EXCLUDED.manager_user_id,
             sort_order = EXCLUDED.sort_order,
             updated_at = NOW()`,
      [def.slug, def.name, manager?.id ?? null, def.sortOrder],
    );
  }
}

async function teamIdForSlug(slug: string): Promise<number | null> {
  const row = await queryOne<{ id: number }>(`SELECT id FROM teams WHERE slug = $1`, [slug]);
  return row?.id ?? null;
}

async function employeeIdForEmail(email: string): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM employees
     WHERE email IS NOT NULL AND lower(trim(email)) = lower(trim($1))
     LIMIT 1`,
    [email],
  );
  return row?.id ?? null;
}

async function resolveEmployeeIdFromEmailLocalPart(loginEmail: string): Promise<number | null> {
  const local = loginEmail.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return null;
  const tokens = local.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length < 2) return null;

  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM employees
     WHERE lower(split_part(trim(name), ' ', 1)) = lower($1)
       AND lower(substring(trim(name) from '([^\\s]+)$')) = lower($2)
     ORDER BY length(name), id
     LIMIT 1`,
    [first, last],
  );
  return row?.id ?? null;
}

async function employeeIdByFirstName(firstName: string): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM employees
     WHERE lower(split_part(trim(name), ' ', 1)) = lower($1)
     ORDER BY length(name), id
     LIMIT 1`,
    [firstName.trim()],
  );
  return row?.id ?? null;
}

async function resolveEmployeeIdForPinRule(rule: PinnedTeamRule): Promise<number | null> {
  if (rule.matchFirstName?.trim()) {
    const byFirst = await employeeIdByFirstName(rule.matchFirstName);
    if (byFirst != null) return byFirst;
  }
  if (rule.employeeCode?.trim()) {
    const byCode = await queryOne<{ id: number }>(
      `SELECT id FROM employees WHERE lower(trim(employee_code)) = lower(trim($1)) LIMIT 1`,
      [rule.employeeCode.trim()],
    );
    if (byCode) return byCode.id;
  }
  if (!rule.email?.trim()) return null;
  return resolveEmployeeIdForUserEmail(rule.email);
}

/** Match HR login to ESSL employee row (email often missing on import). */
async function resolveEmployeeIdForUserEmail(loginEmail: string): Promise<number | null> {
  const direct = await employeeIdForEmail(loginEmail);
  if (direct != null) return direct;

  const user = await queryOne<{ id: number; name: string; email: string }>(
    `SELECT id, name, email FROM users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
    [loginEmail],
  );
  if (user) {
    const byExactName = await queryOne<{ id: number }>(
      `SELECT id FROM employees WHERE lower(trim(name)) = lower(trim($1)) ORDER BY id LIMIT 1`,
      [user.name],
    );
    if (byExactName) return byExactName.id;

    const parts = user.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const byParts = await queryOne<{ id: number }>(
        `SELECT id FROM employees
         WHERE lower(split_part(trim(name), ' ', 1)) = lower($1)
           AND lower(substring(trim(name) from '([^\\s]+)$')) = lower($2)
         ORDER BY length(name), id
         LIMIT 1`,
        [parts[0], parts[parts.length - 1]],
      );
      if (byParts) return byParts.id;
    }

    if (parts.length === 1) {
      const byFirst = await queryOne<{ id: number }>(
        `SELECT id FROM employees
         WHERE lower(split_part(trim(name), ' ', 1)) = lower($1)
         ORDER BY length(name), id
         LIMIT 1`,
        [parts[0]],
      );
      if (byFirst) return byFirst.id;
    }
  }

  return resolveEmployeeIdFromEmailLocalPart(loginEmail);
}

async function backfillEmployeeEmail(employeeId: number, email: string): Promise<void> {
  await query(
    `UPDATE employees
     SET email = COALESCE(NULLIF(trim(email), ''), lower(trim($2))), updated_at = NOW()
     WHERE id = $1`,
    [employeeId, email],
  );
}

async function pinRuleToTeam(rule: PinnedTeamRule): Promise<void> {
  const teamId = await teamIdForSlug(rule.slug);
  if (teamId == null) return;

  const employeeId = await resolveEmployeeIdForPinRule(rule);
  if (employeeId == null) {
    const label = rule.email ?? rule.matchFirstName ?? rule.employeeCode ?? "?";
    console.warn(`[teams] Could not resolve employee for pinned rule ${label} → ${rule.slug}`);
    return;
  }

  if (rule.email?.trim()) {
    await backfillEmployeeEmail(employeeId, rule.email);
  }
  await setEmployeeTeam(employeeId, teamId, "system:team-pin");
}

/** Move staff off legacy combined Social Media and SEO team slug (pre-split). */
export async function migrateLegacySocialMediaSeoTeam(): Promise<void> {
  const legacyId = await teamIdForSlug("social-media-seo");
  if (legacyId == null) return;

  const moves: Array<{ first: string; slug: string }> = [
    { first: "Taqi", slug: "social-media" },
    { first: "Kashish", slug: "social-media" },
    { first: "Ghanshyam", slug: "seo" },
    { first: "Bipin", slug: "seo" },
    { first: "Saksham", slug: "content" },
  ];

  for (const { first, slug } of moves) {
    const teamId = await teamIdForSlug(slug);
    if (teamId == null) continue;
    const rows = await query<{ id: number }>(
      `SELECT id FROM employees
       WHERE team_id = $1 AND lower(split_part(trim(name), ' ', 1)) = lower($2)`,
      [legacyId, first],
    );
    for (const row of rows) {
      await setEmployeeTeam(row.id, teamId, "system:split-social-seo");
    }
  }
}

/** Unassign stragglers and delete retired team rows (e.g. old combined Social Media and SEO). */
export async function removeLegacyTeams(): Promise<void> {
  for (const legacySlug of LEGACY_TEAM_SLUGS) {
    const legacyId = await teamIdForSlug(legacySlug);
    if (legacyId == null) continue;

    const stragglers = await query<{ id: number; name: string }>(
      `SELECT id, name FROM employees WHERE team_id = $1`,
      [legacyId],
    );
    if (stragglers.length > 0) {
      const othersId = await teamIdForSlug("others");
      for (const row of stragglers) {
        console.warn(
          `[teams] Moving ${row.name} off legacy team ${legacySlug} → ${othersId != null ? "others" : "unassigned"}`,
        );
        await setEmployeeTeam(row.id, othersId, "system:remove-legacy-team");
      }
    }

    await query(`DELETE FROM teams WHERE id = $1`, [legacyId]);
    console.log(`[teams] Removed legacy team ${legacySlug}`);
  }
}

/** Keep team managers, leadership, and named staff on their designated teams. */
export async function seedPinnedEmployeeTeams(): Promise<void> {
  for (const rule of PINNED_EMPLOYEE_TEAMS) {
    await pinRuleToTeam(rule);
  }

  await migrateLegacySocialMediaSeoTeam();
  await removeLegacyTeams();

  const othersTeamId = await teamIdForSlug("others");
  if (othersTeamId != null) {
    const rows = await query<{ id: number }>(
      `SELECT id FROM employees WHERE lower(name) LIKE '%preeti%'`,
    );
    for (const row of rows) {
      await setEmployeeTeam(row.id, othersTeamId, "system:team-pin");
    }
  }
}

async function managerEmployeeIdForTeam(managerUserId: number): Promise<number | null> {
  const user = await queryOne<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [
    managerUserId,
  ]);
  if (!user?.email) return null;
  return resolveEmployeeIdForUserEmail(user.email);
}

export async function listTeams(): Promise<TeamRecord[]> {
  const rows = await query<TeamRow>(
    `${teamSelect}
     GROUP BY t.id, u.name, u.email
     ORDER BY t.sort_order, t.name`,
  );
  return rows.map(mapTeamRow).filter((team) => isActiveTeamSlug(team.slug));
}

export async function getTeamById(teamId: number): Promise<TeamRecord | null> {
  const row = await queryOne<TeamRow>(
    `${teamSelect}
     WHERE t.id = $1
     GROUP BY t.id, u.name, u.email`,
    [teamId],
  );
  if (!row || !isActiveTeamSlug(row.slug)) return null;
  return mapTeamRow(row);
}

export async function getTeamMembers(teamId: number): Promise<{
  team: TeamRecord;
  employeeIds: number[];
}> {
  const team = await getTeamById(teamId);
  if (!team) {
    throw Object.assign(new Error("Team not found"), { status: 404 });
  }
  const rows = await query<{ id: number }>(
    `SELECT id FROM employees WHERE team_id = $1 ORDER BY employee_code`,
    [teamId],
  );
  return { team, employeeIds: rows.map((r) => r.id) };
}

async function syncEmployeeManagerFromTeam(
  employeeId: number,
  teamId: number | null,
  actor: string,
  client?: pg.PoolClient,
): Promise<void> {
  const run = async (c: pg.PoolClient) => {
    await c.query(`DELETE FROM manager_employee_assignments WHERE employee_id = $1`, [employeeId]);
    if (!teamId) return;
    const team = await c.query<{ manager_user_id: number | null }>(
      `SELECT manager_user_id FROM teams WHERE id = $1`,
      [teamId],
    );
    const managerUserId = team.rows[0]?.manager_user_id;
    if (!managerUserId) return;
    await c.query(
      `INSERT INTO manager_employee_assignments (manager_user_id, employee_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [managerUserId, employeeId, actor],
    );
  };

  if (client) {
    await run(client);
    return;
  }
  await withTransaction(run);
}

export async function setEmployeeTeam(
  employeeId: number,
  teamId: number | null,
  actor: string,
): Promise<void> {
  let teamName: string | null = null;
  if (teamId != null) {
    const team = await getTeamById(teamId);
    if (!team) {
      throw Object.assign(new Error("Team not found"), { status: 404 });
    }
    teamName = team.name;
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE employees
       SET team_id = $1, department = $2, updated_at = NOW()
       WHERE id = $3`,
      [teamId, teamName, employeeId],
    );
    await syncEmployeeManagerFromTeam(employeeId, teamId, actor, client);
  });
}

export async function setTeamManager(
  teamId: number,
  managerUserId: number | null,
  actor: string,
): Promise<TeamRecord> {
  const team = await getTeamById(teamId);
  if (!team) {
    throw Object.assign(new Error("Team not found"), { status: 404 });
  }

  if (managerUserId != null) {
    const manager = await queryOne<{ id: number; role: string }>(
      `SELECT id, role FROM users WHERE id = $1`,
      [managerUserId],
    );
    if (!manager || manager.role.trim().toLowerCase() !== "manager") {
      throw Object.assign(new Error("Manager not found"), { status: 400 });
    }
  }

  await query(`UPDATE teams SET manager_user_id = $2, updated_at = NOW() WHERE id = $1`, [
    teamId,
    managerUserId,
  ]);

  const members = await query<{ id: number }>(`SELECT id FROM employees WHERE team_id = $1`, [teamId]);
  for (const member of members) {
    await syncEmployeeManagerFromTeam(member.id, teamId, actor);
  }
  await refreshPendingManagerTierAssignees();

  const updated = await getTeamById(teamId);
  if (!updated) {
    throw Object.assign(new Error("Team not found"), { status: 404 });
  }
  return updated;
}

export async function setTeamMembers(
  teamId: number,
  employeeIds: number[],
  actor: string,
): Promise<{ memberCount: number }> {
  const team = await getTeamById(teamId);
  if (!team) {
    throw Object.assign(new Error("Team not found"), { status: 404 });
  }

  const uniqueIds = [...new Set(employeeIds.filter((id) => Number.isFinite(id) && id > 0))];

  if (team.managerUserId != null) {
    const managerEmployeeId = await managerEmployeeIdForTeam(team.managerUserId);
    if (managerEmployeeId != null && !uniqueIds.includes(managerEmployeeId)) {
      uniqueIds.push(managerEmployeeId);
    }
  }

  if (uniqueIds.length > 0) {
    const found = await query<{ id: number }>(`SELECT id FROM employees WHERE id = ANY($1::int[])`, [
      uniqueIds,
    ]);
    if (found.length !== uniqueIds.length) {
      throw Object.assign(new Error("One or more employees were not found"), { status: 400 });
    }
  }

  await withTransaction(async (client) => {
    const current = await client.query<{ id: number }>(
      `SELECT id FROM employees WHERE team_id = $1`,
      [teamId],
    );
    const currentIds = new Set(current.rows.map((r) => r.id));
    const nextIds = new Set(uniqueIds);

    for (const id of currentIds) {
      if (nextIds.has(id)) continue;
      await client.query(
        `UPDATE employees SET team_id = NULL, department = NULL, updated_at = NOW() WHERE id = $1`,
        [id],
      );
      await syncEmployeeManagerFromTeam(id, null, actor, client);
    }

    for (const id of uniqueIds) {
      await client.query(
        `UPDATE employees SET team_id = $1, department = $2, updated_at = NOW() WHERE id = $3`,
        [teamId, team.name, id],
      );
      await syncEmployeeManagerFromTeam(id, teamId, actor, client);
    }
  });

  await refreshPendingManagerTierAssignees();

  return { memberCount: uniqueIds.length };
}
