/**
 * Role → permission map. To add a new role or permission, edit only this
 * file; routes ask for a *permission*, never a role name.
 */
export const roles = ['admin', 'agent', 'user'] as const;
export type Role = (typeof roles)[number];

export const permissions = [
  'chat:read_own',
  'chat:send_own',
  'chat:read_any',
  'chat:reply',
  'chat:export',
  'agent:set_status',
  'agent:view',
  'agent:manage',
  'agent:assign',
  'user:approve',
  'metrics:view',
] as const;
export type Permission = (typeof permissions)[number];

const rolePermissions: Record<Role, readonly Permission[]> = {
  user: ['chat:read_own', 'chat:send_own', 'chat:export'],
  agent: ['chat:read_any', 'chat:reply', 'chat:export', 'agent:set_status', 'agent:view'],
  admin: permissions, // admin can do everything
};

export const hasPermission = (role: Role, permission: Permission): boolean =>
  rolePermissions[role].includes(permission);

export const isStaff = (role: Role): boolean => role === 'admin' || role === 'agent';