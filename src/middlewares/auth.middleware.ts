import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { User, UserRole } from '../models/user.model.js';
import { authService } from '../services/auth.service.js';
import { AuthUser } from '../types/auth.types.js';
import { sanitizeErrorMessage } from '../config/db.js';

// Extend Express Request interface to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Middleware ensuring incoming requests supply a valid, unexpired JWT access token.
 * Validates the user's current existence, active status, and current role in MongoDB.
 * Never relies solely on claims stored in an old token.
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required. Missing or malformed Bearer token.'
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required. Token missing.'
    });
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
