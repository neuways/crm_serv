import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { EnquiryService, enquiryService } from '../services/enquiry.service.js';
import { CreateEnquiryInput } from '../types/enquiry.types.js';
import { sanitizeErrorMessage } from '../config/db.js';

/**
 * Zod schema for enquiry assignment payload validation.
 */
export const assignEnquirySchema = z
  .object({
    assignedToId: z.string().trim().optional(),
    assignedTo: z.string().trim().optional(),
  })
  .transform((data, ctx) => {
    const resolvedId = (data.assignedToId || data.assignedTo || '').trim();
    if (!resolvedId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assignedToId is required',
      });
      return z.NEVER;
    }
    if (!Types.ObjectId.isValid(resolvedId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assignedToId must be a valid MongoDB ObjectId',
      });
      return z.NEVER;
    }
    return { assignedToId: resolvedId };
  });

/**
 * Zod schema for adding a remark to an enquiry.
 */
export const addRemarkSchema = z.object({
  remark: z
    .string({ required_error: 'Remark content is required' })
    .trim()
    .min(1, { message: 'Remark cannot be empty' })
    .max(2000, { message: 'Remark cannot exceed 2000 characters' }),
  confirmContactDetails: z.boolean().optional().default(false)
});

/**
 * Zod schema for updating enquiry status (ACTIVE <-> CLOSED).
 */
export const changeStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'CLOSED'], {
    errorMap: () => ({ message: "Status must be 'ACTIVE' or 'CLOSED'" })
  }),
  reason: z.string().trim().optional()
});

/**
 * Zod schema for follow-up creation payload validation.
 */
export const createFollowUpSchema = z
  .object({
    purpose: z.enum(['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'SITE_VISIT', 'OTHER'], {
      errorMap: () => ({ message: 'Purpose must be CALL, WHATSAPP, EMAIL, MEETING, SITE_VISIT, or OTHER' })
    }),
    followUpDate: z
      .string({ required_error: 'Follow-up date is required' })
      .trim()
      .min(1, { message: 'Follow-up date is required' }),
    followUpTime: z
      .string({ required_error: 'Follow-up time is required' })
      .trim()
      .min(1, { message: 'Follow-up time is required' }),
    notes: z
      .string({ required_error: 'Follow-up remark/notes cannot be empty' })
      .trim()
      .min(1, { message: 'Follow-up remark/notes cannot be empty' })
      .max(2000, { message: 'Follow-up notes cannot exceed 2000 characters' }),
    status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED']).optional(),
    outcome: z
      .enum(['CONNECTED', 'NO_ANSWER', 'SWITCHED_OFF', 'CALL_BACK_REQUESTED', 'MEETING_SCHEDULED', 'SITE_VISIT_COMPLETED', 'DEAL_DONE', 'NOT_INTERESTED', 'OTHER'], {
        errorMap: () => ({ message: 'Invalid follow-up outcome' })
      })
      .optional(),
    nextFollowUpDate: z.string().trim().optional(),
    nextFollowUpTime: z.string().trim().optional(),
    leadStatus: z.enum(['ACTIVE', 'CLOSED']).optional(),
    closingReason: z.string().trim().optional()
  })
  .refine(
    (data) => {
      if (data.outcome === 'CALL_BACK_REQUESTED') {
        return Boolean(data.nextFollowUpDate && data.nextFollowUpDate.trim()) && Boolean(data.nextFollowUpTime && data.nextFollowUpTime.trim());
      }
      return true;
    },
    {
      message: 'Next follow-up date and time are required when outcome is CALL_BACK_REQUESTED',
      path: ['nextFollowUpDate']
    }
  )
  .refine(
    (data) => {
      if (data.leadStatus === 'CLOSED') {
        return Boolean(data.closingReason && data.closingReason.trim());
      }
      return true;
    },
    {
      message: 'Closing reason is required when setting lead status to CLOSED',
      path: ['closingReason']
    }
  );

/**
 * Zod schema for incoming HTTP request payload validation.
 */
/**
 * Zod schema for updating follow-up task status.
 */
export const updateTaskStatusSchema = z
  .object({
    status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED'], {
      errorMap: () => ({ message: 'Status must be PENDING, IN_PROGRESS, COMPLETED, CANCELLED, or RESCHEDULED' })
    }),
    notes: z.string().trim().max(2000, { message: 'Notes cannot exceed 2000 characters' }).optional(),
    cancellationReason: z.string().trim().optional(),
    followUpDate: z.string().trim().optional(),
    followUpTime: z.string().trim().optional(),
    rescheduledDate: z.string().trim().optional(),
    rescheduledTime: z.string().trim().optional()
  })
  .refine(
    (data) => {
      if (data.status === 'CANCELLED') {
        return Boolean(data.cancellationReason && data.cancellationReason.trim());
      }
      return true;
    },
    {
      message: 'Cancellation reason is mandatory when cancelling a task',
      path: ['cancellationReason']
    }
  )
  .refine(
    (data) => {
      if (data.status === 'RESCHEDULED') {
        const date = data.rescheduledDate || data.followUpDate;
        const time = data.rescheduledTime || data.followUpTime;
        return Boolean(date && date.trim()) && Boolean(time && time.trim());
      }
      return true;
    },
    {
      message: 'A valid rescheduled date and time are required when rescheduling a task',
      path: ['rescheduledDate']
    }
  );

export const createEnquirySchema = z
  .object({
    name: z.string({ required_error: 'Enquiry name is required' }).trim().min(1, { message: 'Enquiry name is required' }),
    mobile: z.string({ required_error: 'Enquiry mobile number is required' }).trim().min(1, { message: 'Enquiry mobile number is required' }),
    email: z
      .string()
      .trim()
      .email({ message: 'Invalid email address format' })
      .optional()
      .or(z.literal('')),
    projectName: z.string().trim().optional(),
    requirement: z.string().trim().optional(),
    budgetMin: z.number({ invalid_type_error: 'Minimum budget must be a number' }).min(0, { message: 'Minimum budget cannot be negative' }).optional(),
    budgetMax: z.number({ invalid_type_error: 'Maximum budget must be a number' }).min(0, { message: 'Maximum budget cannot be negative' }).optional(),
    description: z.string().trim().optional(),
    source: z.string().trim().optional(),
    preferredContactMethod: z
      .enum(['CALL', 'WHATSAPP', 'EMAIL'], {
        errorMap: () => ({ message: 'Preferred contact method must be CALL, WHATSAPP, or EMAIL' })
      })
      .optional(),
    preferredContactTiming: z.string().trim().optional(),
    assignedToId: z.string().trim().optional()
  })
  .refine(
    (data) => {
      if (typeof data.budgetMin === 'number' && typeof data.budgetMax === 'number') {
        return data.budgetMin <= data.budgetMax;
      }
      return true;
    },
    {
      message: 'Minimum budget cannot exceed maximum budget',
      path: ['budgetMin']
    }
  );

export class EnquiryController {
  constructor(private service: EnquiryService = enquiryService) {}

  /**
   * HTTP POST handler to create an enquiry.
   * Intercepts duplicates, cross-field collisions, and input validation errors.
   */
  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      // 1. Validate payload schema
      const parseResult = createEnquirySchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      // Convert empty string email to undefined
      const validatedData = parseResult.data;
      const input: CreateEnquiryInput = {
        ...validatedData,
        email: validatedData.email ? validatedData.email : undefined
      };

      // 2. Delegate to Enquiry Service
      const result = await this.service.createEnquiry(input, req.user);

      // 3. Handle Duplicate / Conflict Result (HTTP 409 Conflict)
      if (result.isDuplicate) {
        return res.status(409).json({
          success: false,
          isDuplicate: true,
          duplicateType: result.duplicateType,
          message: result.message,
          data: {
            matches: result.matches,
            matchedEnquiries: result.matchedEnquiries
          }
        });
      }

      // 4. Handle Success Result (HTTP 201 Created)
      return res.status(201).json({
        success: true,
        message: 'Enquiry created successfully.',
        data: {
          enquiry: result.enquiry
        }
      });
    } catch (err: unknown) {
      // 5. Handle Business & Domain Validation Errors from Service (HTTP 400)
      const errorMessage = (err as Error)?.message || 'An error occurred';
      const statusCode = (err as any)?.statusCode;
      if (statusCode === 403 || errorMessage.includes('Access denied') || errorMessage.includes('Forbidden')) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: errorMessage
        });
      }
      if (
        errorMessage.includes('required') ||
        errorMessage.includes('Invalid') ||
        errorMessage.includes('cannot exceed') ||
        errorMessage.includes('not a valid')
      ) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: errorMessage
        });
      }

      // 6. Safe 500 Internal Server Error (Never exposes stack traces, credentials, or internal details)
      console.error(
        '[EnquiryController] Unexpected error during enquiry creation:',
        sanitizeErrorMessage(err)
      );
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while processing the enquiry.'
      });
    }
  };

  /**
   * HTTP PATCH handler to assign an existing enquiry to an employee.
   * Restricted to ADMIN and MANAGER roles via middleware.
   */
  assign = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const parseResult = assignEnquirySchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const result = await this.service.assignEnquiry(
        enquiryId,
        parseResult.data.assignedToId,
        req.user
      );

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 500
            ? 'Internal Server Error'
            : 'Validation Error';
        return res.status(result.statusCode).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Enquiry successfully assigned.',
        data: {
          enquiry: result.enquiry
        }
      });
    } catch (err: unknown) {
      console.error(
        '[EnquiryController] Unexpected error during enquiry assignment:',
        sanitizeErrorMessage(err)
      );
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while assigning the enquiry.'
      });
    }
  };

  /**
   * HTTP POST handler to add an immutable remark to an enquiry.
   * Authorized for ADMIN, MANAGER, and SALES employees.
   */
  addRemark = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const parseResult = addRemarkSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const result = await this.service.addRemark(
        enquiryId,
        parseResult.data,
        req.user
      );

      if (!result.success) {
        if (result.requiresConfirmation) {
          return res.status(400).json({
            success: false,
            requiresConfirmation: true,
            error: 'Contact Details Detected',
            message: result.message,
            data: {
              detectedTypes: result.detectedTypes
            }
          });
        }

        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 500
            ? 'Internal Server Error'
            : 'Validation Error';
        return res.status(result.statusCode).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Remark added successfully.',
        data: {
          activity: result.activity
        }
      });
    } catch (err: unknown) {
      console.error(
        '[EnquiryController] Unexpected error during remark creation:',
        sanitizeErrorMessage(err)
      );
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while adding the remark.'
      });
    }
  };

  /**
   * HTTP PATCH handler to update enquiry status (ACTIVE <-> CLOSED).
   * Restricted by role (ADMIN, MANAGER for any enquiry; SALES for assigned enquiries).
   */
  changeStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const parseResult = changeStatusSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const result = await this.service.changeStatus(
        enquiryId,
        parseResult.data,
        req.user
      );

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: result.statusChanged ? 'Enquiry status updated successfully.' : 'Status unchanged.',
        data: {
          enquiry: result.enquiry,
          statusChanged: result.statusChanged,
          ...(result.activity ? { activity: result.activity } : {})
        }
      });
    } catch (err: unknown) {
      console.error(
        '[EnquiryController] Unexpected error during status update:',
        sanitizeErrorMessage(err)
      );
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while updating enquiry status.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve paginated activity history for an enquiry.
   * Authorized for ADMIN, MANAGER, and SALES.
   */
  getActivities = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      if (isNaN(page) || page < 1) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Page must be a positive integer'
        });
      }

      if (isNaN(limit) || limit < 1) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Limit must be a positive integer'
        });
      }

      const result = await this.service.getActivityHistory(enquiryId, page, limit);

      if (!result.success) {
        const errorTitle = result.statusCode === 404 ? 'Not Found' : 'Validation Error';
        return res.status(result.statusCode).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          activities: result.activities,
          pagination: result.pagination
        }
      });
    } catch (err: unknown) {
      console.error(
        '[EnquiryController] Unexpected error during activity history retrieval:',
        sanitizeErrorMessage(err)
      );
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving enquiry activity history.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve paginated enquiries with role-based scoping:
   * ADMIN & MANAGER can view all enquiries; SALES can view only assigned enquiries.
   */
  list = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const rawPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const page = !isNaN(rawPage) && rawPage > 0 ? rawPage : 1;
      const limit = !isNaN(rawLimit) && rawLimit > 0 ? rawLimit : 20;
      const status = req.query.status as 'ACTIVE' | 'CLOSED' | undefined;
      const search = req.query.search as string | undefined;
      const completedDeals = req.query.completedDeals as string | undefined;
      const excludeCompletedDeals = req.query.excludeCompletedDeals as string | undefined;
      const rejected = req.query.rejected as string | undefined;
      const dealLost = req.query.dealLost as string | undefined;
      const closureType = req.query.closureType as string | undefined;
      const unassigned = req.query.unassigned === 'true' ? true : req.query.unassigned === 'false' ? false : undefined;
      const assignedOnly = req.query.assignedOnly === 'true' ? true : req.query.assignedOnly === 'false' ? false : undefined;
      const unassignedReason = req.query.unassignedReason as string | undefined;
      const assignedTo = req.query.assignedTo as string | undefined;
      const excludeAssignedTo = req.query.excludeAssignedTo as string | undefined;
      const managerId = req.query.managerId as string | undefined;
      const project = req.query.project as string | undefined;

      const result = await this.service.listEnquiries(
        {
          page,
          limit,
          status,
          search,
          completedDeals,
          excludeCompletedDeals,
          rejected,
          dealLost,
          closureType,
          unassigned,
          assignedOnly,
          unassignedReason,
          assignedTo,
          excludeAssignedTo,
          managerId,
          project,
        },
        req.user
      );

      return res.status(200).json({
        success: true,
        message: 'Enquiries retrieved successfully.',
        data: {
          enquiries: result.enquiries,
          pagination: result.pagination
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] list error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while listing enquiries.'
      });
    }
  };

  /**
   * HTTP POST handler to record a follow-up for an enquiry.
   */
  createFollowUp = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const parseResult = createFollowUpSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const result = await this.service.createFollowUp(enquiryId, parseResult.data, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Follow-up recorded successfully.',
        data: {
          followUp: result.followUp,
          activity: result.activity,
          enquiry: result.enquiry
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] createFollowUp error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while recording the follow-up.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve dynamic dashboard summary data.
   * Scoped by role: SALES agents receive data for their assigned enquiries,
   * while ADMIN and MANAGER receive organization-wide aggregated metrics.
   */
  getDashboardSummary = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const result = await this.service.getDashboardSummary(req.user);

      if (!result.success) {
        return res.status(result.statusCode || 500).json({
          success: false,
          error: 'Dashboard Error',
          message: result.message || 'Failed to retrieve dashboard summary'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Dashboard summary retrieved successfully.',
        data: result.data
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getDashboardSummary error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving dashboard summary.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve all recorded follow-ups for an enquiry.
   */
  getFollowUps = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const result = await this.service.getFollowUps(enquiryId, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          followUps: result.followUps
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getFollowUps error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving follow-ups.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve a single enquiry with full details.
   * Scoped by role: SALES agents can only view their assigned enquiries.
   */
  /**
   * HTTP PATCH handler to update the status of a specific follow-up task.
   */
  updateTaskStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId, taskId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      if (!taskId || !Types.ObjectId.isValid(taskId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid task ID: must be a valid MongoDB ObjectId'
        });
      }

      const parseResult = updateTaskStatusSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. ')
        });
      }

      const result = await this.service.updateTaskStatus(enquiryId, taskId, parseResult.data, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message || 'Task status updated successfully',
        data: {
          task: result.task,
          activity: result.activity
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] updateTaskStatus error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while updating task status.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve finalized property deals.
   * Path: GET /api/v1/enquiries/completed-deals
   */
  listCompletedDeals = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const search = req.query.search as string | undefined;

      const result = await this.service.listCompletedDeals({ page, limit, search }, req.user);
      return res.status(200).json({
        ...result,
        message: 'Completed deals retrieved successfully.',
        data: result
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] listCompletedDeals error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while listing completed deals.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve duplicate records.
   * Path: GET /api/v1/enquiries/duplicates
   */
  getDuplicates = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const search = req.query.search as string | undefined;
      const matchReason = req.query.matchReason as string | undefined;
      const includeBulk = req.query.includeBulk !== undefined ? req.query.includeBulk === 'true' : undefined;
      const source = req.query.source as string | undefined;

      const result = await this.service.getDuplicateRecords({ page, limit, search, matchReason, includeBulk, source }, req.user);
      return res.status(200).json({
        success: true,
        message: 'Duplicate records retrieved successfully.',
        data: result,
        ...result
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getDuplicates error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while fetching duplicate records.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve quick total duplicate count.
   * Path: GET /api/v1/enquiries/duplicates/count
   */
  getDuplicatesCount = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      const includeBulk = req.query.includeBulk === 'true';
      const source = req.query.source as string | undefined;
      const count = await this.service.getDuplicateCount(req.user, { includeBulk, source });
      return res.status(200).json({
        success: true,
        count,
        data: {
          totalCount: count,
          count
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getDuplicatesCount error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while counting duplicates.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve team performance metrics.
   * Path: GET /api/v1/enquiries/team
   */
  getTeam = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      const result = await this.service.getTeamPerformance(req.user);
      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          error: result.statusCode === 403 ? 'Forbidden' : 'Bad Request',
          message: result.message
        });
      }
      return res.status(200).json({
        ...result,
        message: 'Team performance retrieved successfully.',
        data: result
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getTeam error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving team performance.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve team roster with assignment status.
   * Path: GET /api/v1/enquiries/team/roster
   */
  getTeamRoster = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      const result = await this.service.getTeamRoster(req.user);
      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          error: result.statusCode === 403 ? 'Forbidden' : 'Bad Request',
          message: result.message
        });
      }
      return res.status(200).json({
        ...result,
        data: {
          agents: result.agents || []
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getTeamRoster error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving team roster.'
      });
    }
  };

  /**
   * HTTP POST handler to assign an agent to a team.
   * Path: POST /api/v1/enquiries/team/assign
   */
  assignAgentToTeam = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      const { agentId, initialLeadIds } = req.body;
      if (!agentId || !Types.ObjectId.isValid(agentId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Valid agent ID is required'
        });
      }
      if (initialLeadIds !== undefined && !Array.isArray(initialLeadIds)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'initialLeadIds must be an array of valid lead IDs'
        });
      }
      const result = await this.service.assignAgentToTeam(req.user, agentId, initialLeadIds);
      if (!result.success) {
        const errorTitle = result.statusCode === 409 ? 'Conflict' : result.statusCode === 403 ? 'Forbidden' : 'Bad Request';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }
      return res.status(200).json(result);
    } catch (err: unknown) {
      console.error('[EnquiryController] assignAgentToTeam error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while assigning agent to team.'
      });
    }
  };

  /**
   * HTTP PATCH handler to activate or deactivate team membership.
   * Path: PATCH /api/v1/enquiries/team/members/:agentId/status
   */
  updateTeamMemberStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      const { agentId } = req.params;
      if (!agentId || !Types.ObjectId.isValid(agentId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Valid agent ID is required'
        });
      }
      const isTeamActive = req.body.isTeamActive !== undefined ? Boolean(req.body.isTeamActive) : Boolean(req.body.isActive);
      const result = await this.service.updateTeamMemberStatus(req.user, agentId, isTeamActive);
      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          error: result.statusCode === 403 ? 'Forbidden' : 'Bad Request',
          message: result.message
        });
      }
      return res.status(200).json(result);
    } catch (err: unknown) {
      console.error('[EnquiryController] updateTeamMemberStatus error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while updating team member status.'
      });
    }
  };

  /**
   * HTTP POST handler to batch assign multiple enquiries.
   * Path: POST /api/v1/enquiries/bulk-assign
   */
  bulkAssign = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      const { enquiryIds, assignedTo, assignedToId, method } = req.body;
      const targetAgentId = assignedToId || assignedTo;
      const assignMethod: 'MANUAL' | 'ROUND_ROBIN' =
        method === 'ROUND_ROBIN' ? 'ROUND_ROBIN' : 'MANUAL';

      if (!Array.isArray(enquiryIds) || enquiryIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Enquiry IDs array cannot be empty'
        });
      }
      if (assignMethod === 'MANUAL' && (!targetAgentId || !Types.ObjectId.isValid(targetAgentId))) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Valid assignedTo user ID is required'
        });
      }
      if (targetAgentId && !Types.ObjectId.isValid(targetAgentId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid assignedTo user ID format'
        });
      }
      const result = await this.service.bulkAssignEnquiries(
        enquiryIds,
        { assignedToId: targetAgentId, method: assignMethod },
        req.user
      );
      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          error: result.statusCode === 403 ? 'Forbidden' : 'Bad Request',
          message: result.message
        });
      }
      return res.status(200).json(result);
    } catch (err: unknown) {
      console.error('[EnquiryController] bulkAssign error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during bulk assignment.'
      });
    }
  };

  /**
   * HTTP PATCH handler to record lead rejection / lost status.
   * Path: PATCH /api/v1/enquiries/:id/reject
   */
  rejectLead = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }
      const result = await this.service.rejectEnquiry(enquiryId, req.body, req.user);
      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }
      return res.status(200).json(result);
    } catch (err: unknown) {
      console.error('[EnquiryController] rejectLead error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while rejecting the lead.'
      });
    }
  };

  /**
   * REQ-36: HTTP PATCH handler to record Deal Lost status.
   * Path: PATCH /api/v1/enquiries/:id/deal-lost
   */
  markDealLost = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }
      const result = await this.service.markDealLost(enquiryId, req.body, req.user);
      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }
      return res.status(200).json(result);
    } catch (err: unknown) {
      console.error('[EnquiryController] markDealLost error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while marking the deal as lost.'
      });
    }
  };

  /**
   * HTTP PATCH handler to record lead qualification scoring.
   * Path: PATCH /api/v1/enquiries/:id/qualification
   */
  qualifyLead = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }
      const result = await this.service.qualifyLead(enquiryId, req.body, req.user);
      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }
      return res.status(200).json(result);
    } catch (err: unknown) {
      console.error('[EnquiryController] qualifyLead error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while qualifying lead.'
      });
    }
  };

  /**
   * DELETE /api/v1/enquiries/:id
   * Deletes an enquiry. Only ADMIN can delete leads (cannot delete DEAL_DONE leads).
   */
  deleteEnquiry = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required.'
        });
      }

      const { id } = req.params;
      const result = await this.service.deleteEnquiry(id, req.user);

      if (!result.success) {
        const errorType =
          result.statusCode === 403
            ? 'Forbidden'
            : result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 400
            ? 'Validation Error'
            : 'Internal Server Error';

        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorType,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] deleteEnquiry error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while deleting the lead.'
      });
    }
  };

  getById = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const result = await this.service.getEnquiryById(enquiryId, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          enquiry: result.enquiry
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getById error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving the enquiry.'
      });
    }
  };

  /**
   * HTTP GET handler to retrieve active CRM manager accounts for meeting/site visit selection.
   */
  getManagers = async (_req: Request, res: Response): Promise<Response> => {
    try {
      const result = await this.service.getActiveManagers();
      return res.status(200).json({
        success: true,
        data: {
          managers: result.managers
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getManagers error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving manager accounts.'
      });
    }
  };

  /**
   * HTTP PATCH handler to record a sequential workflow step with persistence.
   */
  saveWorkflowStep = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const step = req.body?.step;
      if (!step || !['FOLLOW_UP', 'MEETING_PLAN', 'SITE_VISIT_PLAN', 'DEAL_DONE'].includes(step)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Valid workflow step (FOLLOW_UP, MEETING_PLAN, SITE_VISIT_PLAN, DEAL_DONE) is required'
        });
      }

      const result = await this.service.saveWorkflowStep(enquiryId, req.body, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: `Workflow step ${step} saved successfully.`,
        data: {
          enquiry: result.enquiry,
          activity: result.activity,
          followUp: result.followUp
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] saveWorkflowStep error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while saving the workflow step.'
      });
    }
  };

  /**
   * REQ-31: HTTP PATCH handler to cancel a scheduled meeting plan.
   * Path: PATCH /api/v1/enquiries/:id/meeting/cancel
   */
  cancelMeetingPlan = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const result = await this.service.cancelMeetingPlan(enquiryId, req.body, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Meeting plan cancelled successfully.',
        data: {
          enquiry: result.enquiry,
          activity: result.activity,
          followUp: result.followUp
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] cancelMeetingPlan error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while cancelling the meeting plan.'
      });
    }
  };

  /**
   * REQ-31: HTTP PATCH handler to cancel a scheduled site visit plan.
   * Path: PATCH /api/v1/enquiries/:id/site-visit/cancel
   */
  cancelSiteVisitPlan = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const result = await this.service.cancelSiteVisitPlan(enquiryId, req.body, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Site visit plan cancelled successfully.',
        data: {
          enquiry: result.enquiry,
          activity: result.activity,
          followUp: result.followUp
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] cancelSiteVisitPlan error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while cancelling the site visit plan.'
      });
    }
  };

  /**
   * REQ-38: HTTP PATCH handler to enable Do Not Contact (DNC) restriction.
   * Path: PATCH /api/v1/enquiries/:id/do-not-contact/enable
   */
  enableDoNotContact = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const result = await this.service.enableDoNotContact(enquiryId, req.body, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message,
        data: {
          enquiry: result.enquiry,
          dncRecord: result.dncRecord,
          cancelledTasksCount: result.cancelledTasksCount,
          affectedEnquiriesCount: result.affectedEnquiriesCount
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] enableDoNotContact error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while enabling Do Not Contact restriction.'
      });
    }
  };

  /**
   * REQ-38: HTTP PATCH handler to revoke Do Not Contact (DNC) restriction.
   * Path: PATCH /api/v1/enquiries/:id/do-not-contact/revoke
   */
  revokeDoNotContact = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const result = await this.service.revokeDoNotContact(enquiryId, req.body, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message,
        data: {
          enquiry: result.enquiry,
          dncRecord: result.dncRecord,
          affectedEnquiriesCount: result.affectedEnquiriesCount
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] revokeDoNotContact error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while revoking Do Not Contact restriction.'
      });
    }
  };

  /**
   * REQ-38: HTTP GET handler to fetch Do Not Contact (DNC) status for an enquiry.
   * Path: GET /api/v1/enquiries/:id/do-not-contact
   */
  getDoNotContactStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const result = await this.service.getDoNotContactStatus(enquiryId, req.user);

      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          isDoNotContact: result.isDoNotContact,
          normalizedMobile: result.normalizedMobile,
          details: result.details
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getDoNotContactStatus error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving Do Not Contact status.'
      });
    }
  };

  /**
   * POST /api/v1/enquiries/:id/quick-activity
   * Records a 1-click call attempt / interaction outcome and triggers hierarchical reporting.
   */
  logQuickActivity = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id: enquiryId } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!enquiryId || !Types.ObjectId.isValid(enquiryId)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Invalid enquiry ID: must be a valid MongoDB ObjectId'
        });
      }

      const result = await this.service.logQuickActivity(enquiryId, req.body || {}, req.user);
      if (!result.success) {
        const errorTitle =
          result.statusCode === 404
            ? 'Not Found'
            : result.statusCode === 403
            ? 'Forbidden'
            : 'Validation Error';
        return res.status(result.statusCode || 400).json({
          success: false,
          error: errorTitle,
          message: result.message
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Interaction logged successfully.',
        data: {
          enquiry: result.enquiry,
          activity: result.activity,
          followUp: result.followUp
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] logQuickActivity error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while logging quick interaction.'
      });
    }
  };

  /**
   * GET /api/v1/enquiries/team-activity-report
   * Returns period-scoped employee call & workflow accountability metrics.
   */
  getTeamActivityReport = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const result = await this.service.getTeamActivityReport(
        {
          period: req.query.period as any,
          startDate: req.query.startDate as string | undefined,
          endDate: req.query.endDate as string | undefined,
          employeeId: req.query.employeeId as string | undefined,
          managerId: req.query.managerId as string | undefined
        },
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          error: result.statusCode === 403 ? 'Forbidden' : 'Bad Request',
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          period: result.period,
          rangeStart: result.rangeStart,
          rangeEnd: result.rangeEnd,
          employees: result.employees || [],
          managers: result.managers || [],
          summary: result.summary
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getTeamActivityReport error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while generating the work accountability report.'
      });
    }
  };

  /**
   * GET /api/v1/enquiries/activity-feed
   * Retrieves role-scoped chronological activity stream across employees and leads.
   */
  getActivityFeed = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const result = await this.service.getActivityFeed(
        {
          period: req.query.period as any,
          startDate: req.query.startDate as string | undefined,
          endDate: req.query.endDate as string | undefined,
          employeeId: req.query.employeeId as string | undefined,
          managerId: req.query.managerId as string | undefined,
          outcome: req.query.outcome as string | undefined,
          activityType: req.query.activityType as string | undefined,
          enquiryId: req.query.enquiryId as string | undefined,
          search: req.query.search as string | undefined,
          page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
          limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 30
        },
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          error: result.statusCode === 403 ? 'Forbidden' : 'Bad Request',
          message: result.message
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          activities: result.activities || [],
          employees: result.employees || [],
          pagination: result.pagination
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] getActivityFeed error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving activity feed.'
      });
    }
  };

  /**
   * POST /api/v1/enquiries/work-report/submit
   * Submits an explicit daily work report upward (Sales -> Manager + Admin, Manager -> Admin).
   */
  submitWorkReport = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const result = await this.service.submitWorkReport(req.body || {}, req.user);
      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          error: 'Validation Error',
          message: result.message
        });
      }

      return res.status(201).json({
        success: true,
        message: result.message,
        data: {
          activity: result.activity
        }
      });
    } catch (err: unknown) {
      console.error('[EnquiryController] submitWorkReport error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while submitting daily work report.'
      });
    }
  };
}

export const enquiryController = new EnquiryController();
