import type { Db } from 'mongodb';
import type { Env } from '../config/env.js';
import { hashPassword, verifyPassword } from './password.js';

export interface UserDoc {
  _id: string; // username -- doubles as the unique key, no separate id needed
  passwordHash: string;
  salt: string;
  // Only one role exists today (this is a single-admin app for now), but
  // carrying the field means adding real roles later isn't a schema
  // migration, just new values.
  role: 'super_admin';
  createdAt: string;
}

function usersCollection(db: Db) {
  return db.collection<UserDoc>('users');
}

// Runs once at boot, right after connecting to Mongo. If no user exists yet,
// seeds exactly one super-admin from ADMIN_USERNAME/ADMIN_PASSWORD -- fails
// fast (clear error, not a silent no-login-possible state) if those aren't
// set and no user exists. Once a user exists, these env vars are ignored on
// every later boot, so leaving them in .env permanently doesn't reset the
// account.
export async function seedSuperAdminIfNeeded(db: Db, env: Env): Promise<void> {
  const users = usersCollection(db);
  const existingCount = await users.countDocuments({}, { limit: 1 });
  if (existingCount > 0) {
    return;
  }

  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    throw new Error(
      'No admin user exists yet and ADMIN_USERNAME/ADMIN_PASSWORD are not set -- set both in .env to seed the initial super-admin account.'
    );
  }

  const { salt, hash } = hashPassword(env.ADMIN_PASSWORD);
  await users.insertOne({
    _id: env.ADMIN_USERNAME,
    passwordHash: hash,
    salt,
    role: 'super_admin',
    createdAt: new Date().toISOString(),
  });
}

export async function verifyLogin(db: Db, username: string, password: string): Promise<boolean> {
  const user = await usersCollection(db).findOne({ _id: username });
  if (!user) {
    return false;
  }
  return verifyPassword(password, user.salt, user.passwordHash);
}
