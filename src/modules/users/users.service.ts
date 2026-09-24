import { HttpError } from '../../common/errors/http-error.js';
import { User } from './models/user.model.js';
import { toPublicUser, type PublicUser } from './users.mapper.js';
import type { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import type { UpdateApprovalDto } from './dto/update-approval.dto.js';
import type { UpdateRoleDto } from './dto/update-role.dto.js';

const PUBLIC_FIELDS = 'name email role status createdAt';
const SUMMARY_USER_LIMIT = 200;

export interface UsersSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  users: PublicUser[];
}

export class UsersService {
  async list({ status, role }: ListUsersQueryDto): Promise<PublicUser[]> {
    const users = await User.find({ role, status }).select(PUBLIC_FIELDS).sort({ createdAt: -1 }).lean();
    return users.map(toPublicUser);
  }

  /** Stat tiles + table for the admin dashboard, in one request. Customers only. */
  async summary(): Promise<UsersSummary> {
    const [counts, users] = await Promise.all([
      User.aggregate<{ _id: string; count: number }>([
        { $match: { role: 'user' } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      User.find({ role: 'user' }).select(PUBLIC_FIELDS).sort({ createdAt: -1 }).limit(SUMMARY_USER_LIMIT).lean(),
    ]);

    const byStatus = Object.fromEntries(counts.map((row) => [row._id, row.count]));
    const pending = byStatus.pending ?? 0;
    const approved = byStatus.approved ?? 0;
    const rejected = byStatus.rejected ?? 0;

    return { total: pending + approved + rejected, pending, approved, rejected, users: users.map(toPublicUser) };
  }

  /** Atomic: only a user that is still `pending` can be approved/rejected. */
  async updateApproval(userId: string, { status }: UpdateApprovalDto): Promise<PublicUser> {
    const user = await User.findOneAndUpdate(
      { _id: userId, role: 'user', status: 'pending' },
      { $set: { status } },
      { new: true },
    )
      .select(PUBLIC_FIELDS)
      .lean();
    if (!user) throw HttpError.notFound('PENDING_USER_NOT_FOUND', 'Pending user not found');
    return toPublicUser(user);
  }

  /** Promote an approved customer to agent (or demote). Admin accounts can't be changed here. */
  async updateRole(userId: string, { role }: UpdateRoleDto, actingAdminId: string): Promise<PublicUser> {
    if (userId === actingAdminId) throw HttpError.badRequest('CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role');

    const user = await User.findOneAndUpdate(
      { _id: userId, role: { $ne: 'admin' }, status: 'approved' },
      { $set: { role } },
      { new: true },
    )
      .select(PUBLIC_FIELDS)
      .lean();
    if (!user) throw HttpError.notFound('USER_NOT_FOUND', 'Approved non-admin user not found');
    return toPublicUser(user);
  }
}
