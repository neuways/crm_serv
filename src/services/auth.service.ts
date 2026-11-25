import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { User, UserRole } from '../models/user.model.js';
import { env } from '../config/env.js';
import { normalizeEmail } from '../utils/normalization.js';
import {
  AuthUser,
  JWTPayload,
  LoginInput,
  LoginResult,
  GoogleLoginInput,
  GoogleTokenPayload,
  IGoogleTokenVerifier
} from '../types/auth.types.js';

export const BCRYPT_SALT_ROUNDS = 12;
export const JWT_EXPIRES_IN = '7d';
export const AUTH_COOKIE_NAME = 'nueways_session';
export const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

export const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: AUTH_COOKIE_MAX_AGE_MS,
  path: '/'
});

export const getClearCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/'
});

/**
 * Production implementation verifying Google ID tokens via Google's official JWKS certificates.
 */
export class RealGoogleTokenVerifier implements IGoogleTokenVerifier {
  private client = new OAuth2Client();

  async verifyIdToken(idToken: string, audience: string): Promise<GoogleTokenPayload> {
    const ticket = await this.client.verifyIdToken({
      idToken,
      audience
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new Error('Invalid Google token payload');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      email_verified: Boolean(payload.email_verified),
      name: payload.name
    };
  }
}

export class AuthService {
  private googleVerifier: IGoogleTokenVerifier = new RealGoogleTokenVerifier();

  /**
   * Allows automated tests to inject a mock verifier without compromising production security.
   */
  setGoogleVerifier(verifier: IGoogleTokenVerifier): void {
    this.googleVerifier = verifier;
  }
  /**
   * Hashes a plaintext password using bcryptjs with work factor 12.
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  /**
   * Securely compares a plaintext password with a bcrypt hash.
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Signs a stateless JWT access token valid for 8 hours using HS256.
   */
  generateToken(user: { id: string; email: string; role: UserRole }): string {
    const payload: JWTPayload = {
      sub: user.id,
      email: user.email,
      role: user.role
    };

    return jwt.sign(payload, env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRES_IN
    });
  }

  /**
   * Verifies and decodes a JWT access token.
   * Strictly enforces HS256 algorithm to prevent algorithm confusion attacks.
   * Throws if expired, tampered, invalid algorithm, or invalid signature.
   */
  verifyToken(token: string): JWTPayload {
    return jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256']
    }) as JWTPayload;
  }

  /**
   * Authenticates an employee by email and password.
   * Enforces account active status and returns a signed 8-hour access token.
   */
  async login(input: LoginInput): Promise<LoginResult> {
    if (!input.email || typeof input.email !== 'string') {
      throw new Error('Email is required');
    }

    if (!input.password || typeof input.password !== 'string') {
      throw new Error('Password is required');
    }

    const normalizedEmail = normalizeEmail(input.email);
    if (!normalizedEmail) {
      throw new Error('Invalid email or password');
    }

    // Explicitly select passwordHash as it is excluded by default in schema (select: false)
    const user = await User.findOne({ email: input.email }).select('+passwordHash');

    // Generic error for nonexistent user or missing password hash (prevents account enumeration)
    if (!user || !user.passwordHash) {
      throw new Error('Invalid email or password');
    }

    // Verify password hash
    const isPasswordValid = await this.verifyPassword(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Enforce active status
    if (!user.isActive) {
      throw new Error('Account is deactivated. Contact an administrator.');
    }

    const authUser: AuthUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone || null,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword)
    };

    const token = this.generateToken(authUser);

    return {
      token,
      user: authUser
    };
  }

  /**
   * Authenticates an employee via verified Google ID token.
   * Enforces that the CRM account already exists, is active, and loads the role exclusively from MongoDB.
   * Performs safe atomic account linking without automatic user creation.
   */
  async loginWithGoogle(input: GoogleLoginInput): Promise<LoginResult> {
    if (!env.GOOGLE_CLIENT_ID) {
      const err = new Error('Google Sign-In is not configured on this server. GOOGLE_CLIENT_ID is missing.');
      (err as any).statusCode = 503;
      throw err;
    }

    if (!input.idToken || typeof input.idToken !== 'string') {
      const err = new Error('Google ID token is required');
      (err as any).statusCode = 400;
      throw err;
    }

    let payload: GoogleTokenPayload;
    try {
      payload = await this.googleVerifier.verifyIdToken(input.idToken, env.GOOGLE_CLIENT_ID);
    } catch (_err) {
      const err = new Error('Invalid, expired, or tampered Google authentication token.');
      (err as any).statusCode = 401;
      throw err;
    }

    if (!payload.email_verified) {
      const err = new Error('Google email address is not verified. Unverified accounts cannot access the CRM.');
      (err as any).statusCode = 401;
      throw err;
    }

    const normalizedEmail = normalizeEmail(payload.email);
    if (!normalizedEmail) {
      const err = new Error('Invalid email in Google token.');
      (err as any).statusCode = 401;
      throw err;
    }

    // Step 1: Look up by previously linked stable googleSub
    let user = await User.findOne({ googleSub: payload.sub });

    if (user) {
      // Enforce active status
      if (!user.isActive) {
        const err = new Error('Account is deactivated. Contact an administrator.');
        (err as any).statusCode = 401;
        throw err;
      }

      // Security check: Verify email matches current profile
      if (user.email !== normalizedEmail) {
        const err = new Error('Account identity conflict: Linked Google identity email does not match registered CRM profile. Contact an administrator.');
        (err as any).statusCode = 401;
        throw err;
      }

      // If account still had mustChangePassword: true, invalidate temporary password and clear flag
      if (user.mustChangePassword) {
        const randomEntropy = crypto.randomBytes(32).toString('hex');
        user.passwordHash = await this.hashPassword(randomEntropy);
        user.mustChangePassword = false;
        await user.save();
      }
    } else {
      // Step 2: Unlinked Google identity. Query strictly for pre-existing CRM user by exact normalized email
      const candidateUser = await User.findOne({ email: normalizedEmail }).select('+googleSub');

      if (!candidateUser) {
        // Unknown account: Never automatically register CRM users
        const err = new Error('Access Denied: No authorized CRM account was found matching this Google identity. Self-registration is disabled.');
        (err as any).statusCode = 401;
        throw err;
      }

      if (!candidateUser.isActive) {
        const err = new Error('Account is deactivated. Contact an administrator.');
        (err as any).statusCode = 401;
        throw err;
      }

      // Reject if account is already linked to a different Google identity
      if (candidateUser.googleSub && candidateUser.googleSub !== payload.sub) {
        const err = new Error('Account identity conflict: A different Google identity is already linked to this CRM account. Administrator-assisted linking is required.');
        (err as any).statusCode = 401;
        throw err;
      }

      // Security: If employee was provisioned with a temporary password (mustChangePassword: true),
      // authenticating with Google invalidates the temporary password with 256-bit cryptographic entropy
      // and clears mustChangePassword, closing credential backdoors while granting immediate Google SSO access.
      const updateFields: Record<string, unknown> = {
        googleSub: payload.sub
      };

      if (candidateUser.mustChangePassword) {
        const randomEntropy = crypto.randomBytes(32).toString('hex');
        updateFields.passwordHash = await this.hashPassword(randomEntropy);
        updateFields.mustChangePassword = false;
      }

      // Atomic account linking to prevent concurrent race conditions
      const linkedUser = await User.findOneAndUpdate(
        {
          _id: candidateUser._id,
          $or: [{ googleSub: { $exists: false } }, { googleSub: null }]
        },
        { $set: updateFields },
        { new: true }
      );

      if (!linkedUser) {
        // Handle concurrent linking attempts safely
        const fresh = await User.findById(candidateUser._id).select('+googleSub');
        if (fresh?.googleSub !== payload.sub) {
          const err = new Error('Account linking conflict detected during concurrent sign-in. Administrator-assisted linking is required.');
          (err as any).statusCode = 401;
          throw err;
        }
        user = fresh;
      } else {
        user = linkedUser;
      }
    }

    // Step 3: Populate role strictly from trusted MongoDB user record
    const authUser: AuthUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone || null,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword)
    };

    const token = this.generateToken(authUser);

    return {
      token,
      user: authUser
    };
  }

  /**
   * Updates an employee password and clears the mustChangePassword flag.
   */
  async changePassword(
    userId: string,
    input: { oldPassword: string; newPassword: string }
  ): Promise<void> {
    if (!input.oldPassword || typeof input.oldPassword !== 'string') {
      const err = new Error('Current password is required');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!input.newPassword || typeof input.newPassword !== 'string' || input.newPassword.length < 8) {
      const err = new Error('New password must be at least 8 characters long');
      (err as any).statusCode = 400;
      throw err;
    }

    if (input.oldPassword === input.newPassword) {
      const err = new Error('New password must be different from current password');
      (err as any).statusCode = 400;
      throw err;
    }

    const user = await User.findById(userId).select('+passwordHash');
    if (!user || !user.passwordHash) {
      const err = new Error('User account not found');
      (err as any).statusCode = 404;
      throw err;
    }

    if (!user.isActive) {
      const err = new Error('Account is deactivated. Contact an administrator.');
      (err as any).statusCode = 401;
      throw err;
    }

    const isMatch = await this.verifyPassword(input.oldPassword, user.passwordHash);
    if (!isMatch) {
      const err = new Error('Current password is incorrect');
      (err as any).statusCode = 400;
      throw err;
    }

    user.passwordHash = await this.hashPassword(input.newPassword);
    user.mustChangePassword = false;
    await user.save();
  }
}

export const authService = new AuthService();
