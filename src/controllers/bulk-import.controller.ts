import { Request, Response } from 'express';
import { bulkImportService } from '../services/bulk-import.service.js';
import { sanitizeErrorMessage } from '../config/db.js';

export class BulkImportController {
  /**
   * POST /api/v1/bulk-import/upload
   * Handles multipart Excel/CSV file upload, validates limits, extracts headers, and stages parsed rows.
   */
  async uploadFile(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required.' });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'No file uploaded. Please upload a valid .xlsx or .csv file.'
        });
      }

      const result = await bulkImportService.parseAndStageFile(
        file.buffer,
        file.originalname,
        file.size,
        req.user
      );

      return res.status(200).json({
        success: true,
        message: 'File parsed and staged successfully.',
        data: result
      });
    } catch (err: any) {
      const msg = err.message || 'Failed to parse upload file';
      const statusCode = msg.includes('active import job') ? 409 : msg.includes('Access denied') ? 403 : 400;
      return res.status(statusCode).json({
        success: false,
        error: statusCode === 409 ? 'Conflict' : statusCode === 403 ? 'Forbidden' : 'BadRequest',
        message: msg
      });
    }
  }

  /**
   * POST /api/v1/bulk-import/preview
   * Generates a pre-import validation and duplicate preview.
   */
  async previewImport(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { importId, columnMapping, assignmentMethod, assignedToId } = req.body;
      if (!importId) {
        return res.status(400).json({ success: false, error: 'BadRequest', message: 'importId is required.' });
      }
      if (!columnMapping || typeof columnMapping !== 'object') {
        return res.status(400).json({ success: false, error: 'BadRequest', message: 'columnMapping object is required.' });
      }

      const preview = await bulkImportService.previewStagedImport(
        importId,
        columnMapping,
        assignmentMethod,
        assignedToId,
        req.user
      );

      return res.status(200).json({
        success: true,
        data: preview
      });
    } catch (err: any) {
      return res.status(err.message?.includes('Access denied') ? 403 : 400).json({
        success: false,
        error: err.message?.includes('Access denied') ? 'Forbidden' : 'BadRequest',
        message: err.message || 'Preview generation failed'
      });
    }
  }

  /**
   * POST /api/v1/bulk-import/confirm
   * Confirms mapping and starts background sequential processing.
   */
  async confirmImport(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { importId, columnMapping, assignmentConfig } = req.body;
      if (!importId) {
        return res.status(400).json({ success: false, error: 'BadRequest', message: 'importId is required.' });
      }
      if (!columnMapping || typeof columnMapping !== 'object') {
        return res.status(400).json({ success: false, error: 'BadRequest', message: 'columnMapping is required.' });
      }

      const safeConfig = assignmentConfig || { method: req.user.role === 'SALES' ? 'SELF' : 'ROUND_ROBIN' };

      const job = await bulkImportService.confirmAndStartImport(
        importId,
        columnMapping,
        safeConfig,
        req.user
      );

      return res.status(202).json({
        success: true,
        message: 'Import confirmed and queued for processing.',
        data: {
          importId: job.importId,
          status: job.status,
          totalRows: job.totalRows,
          totalBatches: job.totalBatches,
          assignmentConfig: job.assignmentConfig
        }
      });
    } catch (err: any) {
      const msg = err.message || 'Import confirmation failed';
      const statusCode = msg.includes('active import job') ? 409 : msg.includes('Access denied') ? 403 : 400;
      return res.status(statusCode).json({
        success: false,
        error: statusCode === 409 ? 'Conflict' : statusCode === 403 ? 'Forbidden' : 'BadRequest',
        message: msg
      });
    }
  }

  /**
   * GET /api/v1/bulk-import/status/:importId
   * Retrieves persistent progress and error report.
   */
  async getStatus(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { importId } = req.params;
      const job = await bulkImportService.getImportStatus(importId, req.user);

      return res.status(200).json({
        success: true,
        data: {
          importId: job.importId,
          status: job.status,
          originalFilename: job.originalFilename,
          totalRows: job.totalRows,
          processedRows: job.processedRows,
          importedCount: job.importedCount,
          duplicateCount: job.duplicateCount,
          invalidCount: job.invalidCount,
          failedCount: job.failedCount,
          assignedCount: job.assignedCount,
          unassignedCount: job.unassignedCount,
          currentBatch: job.currentBatch,
          totalBatches: job.totalBatches,
          assignmentConfig: job.assignmentConfig,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          errorMessage: job.errorMessage,
          rowErrors: job.rowErrors
        }
      });
    } catch (err: any) {
      const msg = err.message || 'Failed to retrieve import status';
      const statusCode = msg.includes('Access denied') ? 403 : msg.includes('not found') ? 404 : 500;
      return res.status(statusCode).json({
        success: false,
        error: statusCode === 403 ? 'Forbidden' : statusCode === 404 ? 'NotFound' : 'InternalServerError',
        message: msg
      });
    }
  }

  /**
   * GET /api/v1/bulk-import/report/:importId
   * Downloads safe CSV error report.
   */
  async downloadReport(req: Request, res: Response): Promise<Response | void> {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { importId } = req.params;
      const category = (req.query.category as any) || 'ALL';
      const csv = await bulkImportService.generateReportCsv(importId, category, req.user);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="import-report-${importId}-${category.toLowerCase()}.csv"`);
      return res.status(200).send(csv);
    } catch (err: any) {
      const msg = err.message || 'Failed to download report';
      return res.status(msg.includes('Access denied') ? 403 : msg.includes('not found') ? 404 : 500).json({
        success: false,
        error: msg.includes('Access denied') ? 'Forbidden' : 'NotFound',
        message: msg
      });
    }
  }

  /**
   * POST /api/v1/bulk-import/cancel/:importId
   * Cancels in-progress or queued import.
   */
  async cancelImport(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { importId } = req.params;
      const job = await bulkImportService.cancelImport(importId, req.user);

      return res.status(200).json({
        success: true,
        message: 'Import cancellation requested.',
        data: {
          importId: job.importId,
          status: job.status
        }
      });
    } catch (err: any) {
      return res.status(err.message?.includes('Access denied') ? 403 : 400).json({
        success: false,
        error: err.message?.includes('Access denied') ? 'Forbidden' : 'BadRequest',
        message: err.message || 'Failed to cancel import'
      });
    }
  }

  /**
   * GET /api/v1/bulk-import/history
   * Lists recent imports for the authenticated user (or all for Admin).
   */
  async listHistory(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const list = await bulkImportService.listImports(req.user);
      return res.status(200).json({
        success: true,
        data: list
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: 'InternalServerError',
        message: sanitizeErrorMessage(err)
      });
    }
  }

  /**
   * GET /api/v1/bulk-import/template
   * Downloads standardized CSV template for bulk lead imports.
   */
  downloadTemplate(_req: Request, res: Response): void {
    const headers = [
      'Customer Name',
      'Contact Number',
      'Email ID',
      'Project Name',
      'Requirement',
      'Budget Min',
      'Budget Max',
      'Description',
      'Source',
      'Preferred Contact Method',
      'Preferred Contact Timing'
    ];

    const sampleRow = [
      'Rajesh Sharma',
      '9876543210',
      'rajesh.sharma@example.com',
      'Greenfield Heights',
      '3 BHK Apartment',
      '5000000',
      '7500000',
      'Looking for ready-to-move apartment near tech park',
      'Online Portal',
      'CALL',
      'Evening 5-7 PM'
    ];

    const sampleRow2 = [
      'Priya Patel',
      '9811223344',
      'priya.patel@example.com',
      '', // Missing property sample row to demonstrate Unassigned Queue placement
      'Commercial Retail Shop',
      '10000000',
      '15000000',
      'High footfall retail location inquiry',
      'Exhibition',
      'WHATSAPP',
      'Morning 10-12 AM'
    ];

    const csvContent = [headers.join(','), sampleRow.join(','), sampleRow2.join(',')].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="neuways-lead-import-template.csv"');
    res.status(200).send(csvContent);
  }
}

export const bulkImportController = new BulkImportController();
