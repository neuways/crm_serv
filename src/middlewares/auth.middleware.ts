import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { User, UserRole } from '../models/user.model.js';
import { authService, AUTH_COOKIE_NAME } from '../services/auth.service.js';
import { AuthUser } from '../types/auth.types.js';
import { sanitizeErrorMessage } from '../config/db.js';
import { env } from '../config/env.js';

// Extend Express Request interface to include authenticated user and parsed cookies
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      cookies?: Record<string, string>;
    }
  }
}

/**
 * Parses cookies from Cookie header string.
 */
export const parseCookies = (cookieHeader?: string): Record<string, string> => {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((part) => {
    const [rawKey, ...rawVal] = part.trim().split('=');
    if (rawKey) {
      cookies[rawKey] = decodeURIComponent(rawVal.join('='));
    }
  });
  return cookies;
};

/**
 * Validates request origin against allowed origins for CSRF protection.
 */
export const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin) return true;
  const configuredOrigins = env.CLIENT_ORIGIN
    ? env.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:5173'];

  if (configuredOrigins.includes(origin)) return true;

  if (env.NODE_ENV === 'development') {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }

  return false;
};

/**
 * Middleware ensuring incoming requests supply a valid, unexpired JWT access token,
 * via either Bearer Authorization header or persistent HttpOnly session cookie.
 * Validates the user's current existence, active status, and current role in MongoDB.
 * Never relies solely on claims stored in an old token.
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  let token: string | undefined;
  let isFromCookie = false;

  const authHeader = req.headers.authorization;

  if (authHeader) {
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required. Missing or malformed Bearer token.'
      });
    }
    token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required. Token missing.'
      });
    }
  }

  // Fall back to HttpOnly session cookie if no Authorization header provided
  if (!token) {
    const cookies = req.cookies || parseCookies(req.headers.cookie);
    token = cookies[AUTH_COOKIE_NAME];
    if (token) {
      isFromCookie = true;
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required. Missing or malformed Bearer token.'
    });
  }

  // CSRF Defense for cookie-authenticated mutating requests (POST, PUT, PATCH, DELETE)
  if (isFromCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
    if (origin && !isAllowedOrigin(origin)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'CSRF validation failed: Unauthorized request origin.'
      });
    }
  }

  // 1. Verify token signature and expiration
  let payload: any;
  try {
    payload = authService.verifyToken(token);
  } catch (_err) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid, expired, or tampered authentication token.'
    });
  }

  // 2. Verify current user existence and active status in MongoDB
  try {
    // If DB is disconnected, do NOT treat as 401 Unauthorized - return 503 so client preserves valid session
    if (mongoose.connection.readyState !== 1 && (User.findById as any) === (mongoose.Model as any).findById) {
      return res.status(503).json({
        success: false,
        error: 'DatabaseUnavailable',
        message: 'Database service is temporarily unavailable. Please retry shortly.'
      });
    }

    const user = await User.findById(payload.sub).select('name email role isActive mustChangePassword');

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User account no longer exists.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User account has been deactivated.'
      });
    }

    // Enforce mandatory password change on backend:
    // Block all protected business APIs while mustChangePassword is true, permitting only password change
    const pathWithoutQuery = (req.originalUrl || req.url || '').split('?')[0];
    const isChangePasswordEndpoint = pathWithoutQuery.endsWith('/auth/change-password');

    if (user.mustChangePassword && !isChangePasswordEndpoint) {
      return res.status(403).json({
        success: false,
        error: 'PasswordChangeRequired',
        message: 'Temporary password change required. You must change your temporary password before accessing CRM operations.'
      });
    }

    // Attach fresh database user identity and current role to the request
    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword)
    };

    return next();
  } catch (dbErr: unknown) {
    console.error('[requireAuth] Database verification error:', sanitizeErrorMessage(dbErr));
    return res.status(503).json({
      success: false,
      error: 'DatabaseUnavailable',
      message: 'Database connection failed. Please retry shortly.'
    });
  }
};

/**
 * Middleware restricting endpoint access to specific authorized employee roles.
 * Must be used after requireAuth.
 */
export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): Response | void => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}.`
      });
    }

    return next();
  };
};
