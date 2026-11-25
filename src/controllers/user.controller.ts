import { Request, Response } from 'express';
import { z } from 'zod';
import { UserService, userService } from '../services/user.service.js';
import { sanitizeErrorMessage } from '../config/db.js';

import { EMPLOYEE_PHONE_REGEX } from '../models/user.model.js';

const optionalPhoneSchema = z
  .string()
  .trim()
  .refine((val) => val === '' || EMPLOYEE_PHONE_REGEX.test(val), {
    message: 'Mobile number must be a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9'
  })
  .nullable()
  .optional();

export const createEmployeeSchema = z.object({
  name: z
    .string({ required_error: 'Full name is required' })
    .trim()
    .min(2, { message: 'Full name must be at least 2 characters long' })
    .max(100, { message: 'Full name cannot exceed 100 characters' }),
  email: z
    .string({ required_error: 'Email address is required' })
    .trim()
    .email({ message: 'Invalid email address format' }),
  phone: optionalPhoneSchema,
  role: z.enum(['MANAGER', 'SALES'], {
    errorMap: () => ({
      message: 'Role must be MANAGER or SALES. Initial ADMIN provisioning requires server CLI.'
    })
  }),
  temporaryPassword: z
    .string({ required_error: 'Temporary password is required' })
    .min(8, { message: 'Temporary password must be at least 8 characters long' }),
  managerId: z.string().nullable().optional(),
  propertyIds: z.array(z.string().trim()).optional()
});

export const updateEmployeeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'Full name must be at least 2 characters long' })
    .max(100, { message: 'Full name cannot exceed 100 characters' })
    .optional(),
  phone: optionalPhoneSchema,
  role: z.enum(['MANAGER', 'SALES']).optional(),
  managerId: z.string().nullable().optional(),
  temporaryPassword: z
    .string()
    .min(8, { message: 'Temporary password must be at least 8 characters long' })
    .optional(),
  propertyIds: z.array(z.string().trim()).optional()
});

export const updateStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive boolean flag is required' }),
  transferOption: z.enum(['TRANSFER_TO_MANAGER', 'ADMIN_HANDLE']).optional(),
  targetManagerId: z.string().trim().optional()
});

export class UserController {
  constructor(private service: UserService = userService) {}

  /**
   * GET /api/v1/users
   * Lists all employees with safe profile fields. ADMIN only.
   */
  listEmployees = async (req: Request, res: Response): Promise<Response> => {
    try {
      const employees = await this.service.listEmployees();

      return res.status(200).json({
        success: true,
        message: 'Employees retrieved successfully.',
        data: employees
      });
    } catch (err: unknown) {
      console.error('[UserController] Failed to list employees:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while listing employees.'
      });
    }
  };

  /**
   * POST /api/v1/users
   * Provisions a new employee account. ADMIN only.
   */
  createEmployee = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required.'
        });
      }

      const parseResult = createEmployeeSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const newEmployee = await this.service.createEmployee(parseResult.data, req.user);

      return res.status(201).json({
        success: true,
        message: 'Employee account provisioned successfully.',
        data: newEmployee
      });
    } catch (err: unknown) {
      const statusCode = (err as any)?.statusCode || 500;
      const message = (err as Error)?.message || 'An unexpected error occurred while provisioning employee.';

      if (statusCode === 400 || statusCode === 403 || statusCode === 404 || statusCode === 409) {
        return res.status(statusCode).json({
          success: false,
          error:
            statusCode === 400
              ? 'Validation Error'
              : statusCode === 403
              ? 'Forbidden'
              : statusCode === 409
              ? 'Conflict'
              : 'Not Found',
          message
        });
      }

      console.error('[UserController] Failed to provision employee:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while provisioning employee.'
      });
    }
  };

  /**
   * PATCH /api/v1/users/:id
   * Updates permitted employee details (name, role, assigned manager, temp password). ADMIN only.
   */
  updateEmployee = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required.'
        });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Employee ID is required.'
        });
      }

      const parseResult = updateEmployeeSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const updated = await this.service.updateEmployee(id, parseResult.data, req.user);

      return res.status(200).json({
        success: true,
        message: 'Employee details updated successfully.',
        data: updated
      });
    } catch (err: unknown) {
      const statusCode = (err as any)?.statusCode || 500;
      const message = (err as Error)?.message || 'An unexpected error occurred while updating employee details.';

      if (statusCode === 400 || statusCode === 403 || statusCode === 404 || statusCode === 409) {
        return res.status(statusCode).json({
          success: false,
          error:
            statusCode === 400
              ? 'Validation Error'
              : statusCode === 403
              ? 'Forbidden'
              : statusCode === 409
              ? 'Conflict'
              : 'Not Found',
          message
        });
      }

      console.error('[UserController] Failed to update employee details:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while updating employee details.'
      });
    }
  };

  /**
   * PATCH /api/v1/users/:id/status
   * Toggles employee active/inactive status. ADMIN only.
   */
  updateEmployeeStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required.'
        });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Employee ID is required.'
        });
      }

      const parseResult = updateStatusSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const updated = await this.service.updateEmployeeStatus(id, parseResult.data.isActive, req.user, {
        transferOption: parseResult.data.transferOption,
        targetManagerId: parseResult.data.targetManagerId
      });

      return res.status(200).json({
        success: true,
        message: `Employee account ${updated.isActive ? 'activated' : 'deactivated'} successfully.`,
        data: updated
      });
    } catch (err: unknown) {
      const statusCode = (err as any)?.statusCode || 500;
      const message = (err as Error)?.message || 'An unexpected error occurred while updating employee status.';

      if (statusCode === 400 || statusCode === 403 || statusCode === 404) {
        return res.status(statusCode).json({
          success: false,
          error:
            statusCode === 400
              ? 'Validation Error'
              : statusCode === 403
              ? 'Forbidden'
              : 'Not Found',
          message
        });
      }

      console.error('[UserController] Failed to update employee status:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while updating employee status.'
      });
    }
  };

  /**
   * DELETE /api/v1/users/:id
   * Deletes an employee account (MANAGER or SALES). ADMIN only.
   */
  deleteEmployee = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required.'
        });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Employee ID is required.'
        });
      }

      const result = await this.service.deleteEmployee(id, req.user);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (err: unknown) {
      const statusCode = (err as any)?.statusCode || 500;
      const message = (err as Error)?.message || 'An unexpected error occurred while deleting employee account.';

      if (statusCode === 400 || statusCode === 403 || statusCode === 404) {
        return res.status(statusCode).json({
          success: false,
          error:
            statusCode === 400
              ? 'Validation Error'
              : statusCode === 403
              ? 'Forbidden'
              : 'Not Found',
          message
        });
      }

      console.error('[UserController] Failed to delete employee:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while deleting employee account.'
      });
    }
  };
}

export const userController = new UserController();
