import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService, authService } from '../services/auth.service.js';
import { sanitizeErrorMessage } from '../config/db.js';

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .min(1, { message: 'Email cannot be empty' })
    .email({ message: 'Invalid email address format' }),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, { message: 'Password cannot be empty' })
});

export const googleLoginSchema = z.object({
  idToken: z
    .string({ required_error: 'Google ID token is required' })
    .trim()
    .min(1, { message: 'Google ID token cannot be empty' })
});

export const changePasswordSchema = z.object({
  oldPassword: z
    .string({ required_error: 'Current password is required' })
    .min(1, { message: 'Current password cannot be empty' }),
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(8, { message: 'New password must be at least 8 characters long' })
});

export class AuthController {
  constructor(private service: AuthService = authService) {}

  /**
   * HTTP POST handler for employee login.
   * Authenticates credentials and returns a signed 8-hour access token.
   */
  login = async (req: Request, res: Response): Promise<Response> => {
    try {
      const parseResult = loginSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const result = await this.service.login(parseResult.data);

      return res.status(200).json({
        success: true,
        message: 'Login successful.',
        data: {
          token: result.token,
          user: result.user
        }
      });
    } catch (err: unknown) {
      const message = (err as Error)?.message || '';

      // Generic authentication failure or account deactivation (HTTP 401)
      if (
        message.includes('Invalid email or password') ||
        message.includes('Account is deactivated')
      ) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message
        });
      }

      // Safe 500 for unexpected errors
      console.error('[AuthController] Unexpected login error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during authentication.'
      });
    }
  };

  /**
   * HTTP POST handler for Google Sign-In authentication.
   * Authenticates verified Google ID token against active CRM user records.
   */
  googleLogin = async (req: Request, res: Response): Promise<Response> => {
    try {
      const parseResult = googleLoginSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const result = await this.service.loginWithGoogle(parseResult.data);

      return res.status(200).json({
        success: true,
        message: 'Google authentication successful.',
        data: {
          token: result.token,
          user: result.user
        }
      });
    } catch (err: unknown) {
      const statusCode = (err as any)?.statusCode || 500;
      const message =
        (err as Error)?.message || 'An unexpected error occurred during Google authentication.';

      if (statusCode === 503) {
        return res.status(503).json({
          success: false,
          error: 'Service Unavailable',
          message
        });
      }

      if (statusCode === 400) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message
        });
      }

      if (statusCode === 401 || statusCode === 403) {
        return res.status(statusCode).json({
          success: false,
          error: statusCode === 403 ? 'Forbidden' : 'Unauthorized',
          message
        });
      }

      console.error('[AuthController] Unexpected Google login error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during Google authentication.'
      });
    }
  };

  /**
   * HTTP POST handler for changing password (e.g. on first login or session).
   * Requires authenticated user.
   */
  changePassword = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required.'
        });
      }

      const parseResult = changePasswordSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      await this.service.changePassword(req.user.id, parseResult.data);

      return res.status(200).json({
        success: true,
        message: 'Password changed successfully.'
      });
    } catch (err: unknown) {
      const statusCode = (err as any)?.statusCode || 500;
      const message = (err as Error)?.message || 'An unexpected error occurred while changing password.';

      if (statusCode === 400 || statusCode === 401 || statusCode === 404) {
        return res.status(statusCode).json({
          success: false,
          error: statusCode === 400 ? 'Validation Error' : statusCode === 401 ? 'Unauthorized' : 'Not Found',
          message
        });
      }

      console.error('[AuthController] Unexpected changePassword error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while changing password.'
      });
    }
  };
}

export const authController = new AuthController();
