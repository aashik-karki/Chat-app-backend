import bcrypt from 'bcryptjs';
import { HttpError } from '../../common/errors/http-error.js';
import { isDuplicateKeyError } from '../../common/utils/mongo-errors.js';
import { User } from '../users/models/user.model.js';
import { toPublicUser, type PublicUser } from '../users/users.mapper.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

const BCRYPT_ROUNDS = 12;
// Compared against when the email doesn't exist, so a missing account takes
// the same time as a wrong password (stops email enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

export class AuthService {
  /** New accounts are always role `user`, status `pending` (admin must approve). */
  async register({ name, email, password }: RegisterDto): Promise<PublicUser> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    try {
      const user = await User.create({ name, email, passwordHash, role: 'user', status: 'pending' });
      return toPublicUser(user.toObject());
    } catch (error) {
      // Relies on the unique email index, so two parallel sign-ups can't both succeed.
      if (isDuplicateKeyError(error)) throw HttpError.conflict('EMAIL_IN_USE', 'An account already uses this email address');
      throw error;
    }
  }

  async validateCredentials({ email, password }: LoginDto): Promise<PublicUser> {
    const user = await User.findOne({ email }).select('+passwordHash').lean();
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

    if (user.status === 'pending') throw new HttpError(403, 'ACCOUNT_PENDING', 'Your account is pending admin approval');
    if (user.status === 'rejected') throw new HttpError(403, 'ACCOUNT_REJECTED', 'Your account registration was rejected');

    return toPublicUser(user);
  }
}
