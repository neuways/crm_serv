import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { bulkImportController } from '../controllers/bulk-import.controller.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB
  }
});

export const bulkImportRouter = Router();

// Standard CSV Template download (authenticated CRM users)
bulkImportRouter.get(
  '/template',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  (req, res) => bulkImportController.downloadTemplate(req, res)
);

// File Upload & Staging (Excel/CSV)
bulkImportRouter.post(
  '/upload',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  upload.single('file'),
  (req, res) => bulkImportController.uploadFile(req, res)
);

// Validation & Duplicate Preview
bulkImportRouter.post(
  '/preview',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  (req, res) => bulkImportController.previewImport(req, res)
);

// Confirm & Begin Sequential Background Import
bulkImportRouter.post(
  '/confirm',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  (req, res) => bulkImportController.confirmImport(req, res)
);

// Query Import Progress & Errors
bulkImportRouter.get(
  '/status/:importId',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  (req, res) => bulkImportController.getStatus(req, res)
);

// Download Safe Error/Duplicate CSV Report
bulkImportRouter.get(
  '/report/:importId',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  (req, res) => bulkImportController.downloadReport(req, res)
);

// Cancel In-Progress Import
bulkImportRouter.post(
  '/cancel/:importId',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  (req, res) => bulkImportController.cancelImport(req, res)
);

// List User's Import History
bulkImportRouter.get(
  '/history',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SALES'),
  (req, res) => bulkImportController.listHistory(req, res)
);
