import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';

const userRouter = Router();

// Strictly enforce authenticated ADMIN access across all employee management routes
userRouter.use(requireAuth, requireRole('ADMIN'));

// GET /api/v1/users - List employees with safe profile fields
userRouter.get('/', userController.listEmployees);

// POST /api/v1/users - Provision a new MANAGER or SALES employee
userRouter.post('/', userController.createEmployee);

// PATCH /api/v1/users/:id - Update permitted employee details
userRouter.patch('/:id', userController.updateEmployee);
userRouter.put('/:id', userController.updateEmployee);

// PATCH /api/v1/users/:id/status - Activate or deactivate an employee account
userRouter.patch('/:id/status', userController.updateEmployeeStatus);

// DELETE /api/v1/users/:id - Delete an employee account (MANAGER or SALES)
userRouter.delete('/:id', userController.deleteEmployee);

export { userRouter };
