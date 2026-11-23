import { Router } from 'express';
import { propertyMappingController } from '../controllers/property-mapping.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';

const propertyMappingRouter = Router();

// GET /api/v1/properties/mappings - Protected: View all property mappings (ADMIN and MANAGER)
propertyMappingRouter.get(
  '/mappings',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  (req, res) => propertyMappingController.listMappings(req, res)
);

// POST /api/v1/properties/mappings - Protected: Create or update mapping (ADMIN ONLY)
propertyMappingRouter.post(
  '/mappings',
  requireAuth,
  requireRole('ADMIN'),
  (req, res) => propertyMappingController.upsertMapping(req, res)
);

// PUT /api/v1/properties/mappings/:id - Protected: Update mapping by ID (ADMIN ONLY)
propertyMappingRouter.put(
  '/mappings/:id',
  requireAuth,
  requireRole('ADMIN'),
  (req, res) => propertyMappingController.upsertMapping(req, res)
);

// DELETE /api/v1/properties/mappings/:id - Protected: Delete mapping (ADMIN ONLY)
propertyMappingRouter.delete(
  '/mappings/:id',
  requireAuth,
  requireRole('ADMIN'),
  (req, res) => propertyMappingController.deleteMapping(req, res)
);

export { propertyMappingRouter };
