import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const authRouter = Router();

// POST /api/v1/auth/login - Authenticate employee & issue 8-hour access token
authRouter.post('/login', authController.login);

// POST /api/v1/auth/google - Authenticate employee via verified Google ID token
authRouter.post('/google', authController.googleLogin);

// POST /api/v1/auth/change-password - Change current employee password (requires authentication)
authRouter.post('/change-password', requireAuth, authController.changePassword);

export { authRouter };
