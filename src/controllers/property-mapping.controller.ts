import { Request, Response } from 'express';
import { z } from 'zod';
import { propertyMappingService } from '../services/property-mapping.service.js';
import { sanitizeErrorMessage } from '../config/db.js';

export const upsertPropertyMappingSchema = z.object({
  propertyName: z
    .string({ required_error: 'Property name is required' })
    .trim()
    .min(1, { message: 'Property name cannot be empty' })
    .max(200, { message: 'Property name cannot exceed 200 characters' }),
  agentIds: z
    .array(z.string().trim(), {
      required_error: 'agentIds array is required',
    })
    .default([]),
});

export class PropertyMappingController {
  async listMappings(req: Request, res: Response): Promise<Response> {
    try {
      const mappings = await propertyMappingService.listMappings();
      return res.status(200).json({
        success: true,
        data: {
          mappings,
        },
      });
    } catch (err: unknown) {
      console.error('[PropertyMappingController] listMappings error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to retrieve property mappings.',
      });
    }
  }

  async upsertMapping(req: Request, res: Response): Promise<Response> {
    try {
      const parseResult = upsertPropertyMappingSchema.safeParse(req.body);
      if (!parseResult.success) {
        const messages = parseResult.error.issues.map((i) => i.message);
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: messages.join('. '),
        });
      }

      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required.',
        });
      }

      const result = await propertyMappingService.upsertMapping(parseResult.data, req.user);

      return res.status(result.statusCode).json({
        success: result.success,
        message: result.message,
        data: result.mapping ? { mapping: result.mapping } : undefined,
      });
    } catch (err: unknown) {
      console.error('[PropertyMappingController] upsertMapping error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to save property mapping.',
      });
    }
  }

  async deleteMapping(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required.',
        });
      }

      const result = await propertyMappingService.deleteMapping(id, req.user);

      return res.status(result.statusCode).json({
        success: result.success,
        message: result.message,
      });
    } catch (err: unknown) {
      console.error('[PropertyMappingController] deleteMapping error:', sanitizeErrorMessage(err));
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to delete property mapping.',
      });
    }
  }
}

export const propertyMappingController = new PropertyMappingController();
