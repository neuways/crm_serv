import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const authRouter = Router();

// POST /api/v1/auth/login - Authenticate employee & issue 7-day access token and persistent cookie
authRouter.post('/login', authController.login);

// POST /api/v1/auth/google - Authenticate employee via verified Google ID token
authRouter.post('/google', authController.googleLogin);

// GET /api/v1/auth/me - Verify session and restore authenticated user (supports cookie and Bearer token)
authRouter.get('/me', requireAuth, authController.getCurrentUser);

// POST /api/v1/auth/logout - Terminate session and clear authentication cookie
authRouter.post('/logout', authController.logout);

// POST /api/v1/auth/change-password - Change current employee password (requires authentication)
authRouter.post('/change-password', requireAuth, authController.changePassword);

export { authRouter };
