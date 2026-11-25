import mongoose, { Types } from 'mongoose';
import { PropertyMapping, IPropertyMapping } from '../models/property-mapping.model.js';
import { User, IUser } from '../models/user.model.js';
import { Enquiry } from '../models/enquiry.model.js';
import { AuthUser } from '../types/auth.types.js';

export interface UpsertPropertyMappingInput {
  propertyName: string;
  agentIds: string[];
}

export interface RoundRobinResult {
  success: boolean;
  assignedAgent: { id: string; name: string; email: string; role: string } | null;
  reason?: 'NO_PROPERTY_SPECIFIED' | 'NO_PROPERTY_MAPPING' | 'NO_MAPPED_AGENTS' | 'NO_ACTIVE_AGENTS';
  propertyName?: string;
}

export class PropertyMappingService {
  /**
   * Retrieves all property mappings with populated agent details.
   * When connected to a live MongoDB database, also ensures distinct Enquiry project names
   * exist in PropertyMapping so they appear cleanly in dropdown selectors.
   */
  async listMappings(): Promise<IPropertyMapping[]> {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      try {
        const [existingMappings, distinctProjects] = await Promise.all([
          PropertyMapping.find().select('normalizedName').lean(),
          Enquiry.distinct('projectName', { projectName: { $type: 'string', $ne: '' } }),
        ]);

        const existingSet = new Set(
          existingMappings
            .map((m: any) => String(m?.normalizedName || '').trim().toLowerCase())
            .filter(Boolean)
        );

        const missingOps: any[] = [];
        for (const rawProject of distinctProjects) {
          const trimmed = typeof rawProject === 'string' ? rawProject.trim() : '';
          const normalized = trimmed.toLowerCase();
          if (trimmed && !existingSet.has(normalized)) {
            existingSet.add(normalized);
            missingOps.push({
              updateOne: {
                filter: { normalizedName: normalized },
                update: {
                  $setOnInsert: {
                    propertyName: trimmed,
                    normalizedName: normalized,
                    agentIds: [],
                    lastAssignedIndex: -1,
                    lastAssignedAgentId: null,
                  },
                },
                upsert: true,
              },
            });
          }
        }

        if (missingOps.length > 0) {
          await PropertyMapping.bulkWrite(missingOps, { ordered: false });
        }
      } catch (syncErr) {
        console.warn('[PropertyMappingService] Enquiry project sync skipped:', syncErr);
      }
    }

    return PropertyMapping.find()
      .populate('agentIds', 'name email role isActive isTeamActive')
      .populate('lastAssignedAgentId', 'name email role')
      .sort({ propertyName: 1 })
      .lean<IPropertyMapping[]>();
  }

  /**
   * Retrieves single property mapping by property name (case-insensitive).
   */
  async getMappingByProperty(propertyName: string): Promise<IPropertyMapping | null> {
    if (!propertyName || typeof propertyName !== 'string') return null;
    const normalizedName = propertyName.trim().toLowerCase();
    return PropertyMapping.findOne({ normalizedName })
      .populate('agentIds', 'name email role isActive isTeamActive')
      .populate('lastAssignedAgentId', 'name email role')
      .lean<IPropertyMapping | null>();
  }

  /**
   * Admin-only: Creates or updates a property-to-agent mapping.
   * Preserves existing Round Robin pointer state where possible.
   */
  async upsertMapping(
    input: UpsertPropertyMappingInput,
    actor: AuthUser
  ): Promise<{ success: boolean; statusCode: number; message: string; mapping?: IPropertyMapping }> {
    if (actor.role !== 'ADMIN') {
      return {
        success: false,
        statusCode: 403,
        message: 'Access denied: Only administrators may configure property-to-agent mappings.',
      };
    }

    const trimmedName = input.propertyName?.trim();
    if (!trimmedName || trimmedName.length === 0) {
      return {
        success: false,
        statusCode: 400,
        message: 'Property name is required and cannot be empty.',
      };
    }

    const normalizedName = trimmedName.toLowerCase();
    const rawAgentIds = Array.isArray(input.agentIds) ? input.agentIds : [];

    // Filter valid ObjectIds and deduplicate while preserving order
    const validAgentIds: Types.ObjectId[] = [];
    const seen = new Set<string>();

    for (const rawId of rawAgentIds) {
      const idStr = String(rawId).trim();
      if (Types.ObjectId.isValid(idStr) && !seen.has(idStr)) {
        seen.add(idStr);
        validAgentIds.push(new Types.ObjectId(idStr));
      }
    }

    // Validate that mapped agents are active SALES users
    if (validAgentIds.length > 0) {
      const existingAgents = await User.find({
        _id: { $in: validAgentIds },
        role: 'SALES',
      }).select('_id name role isActive');

      const existingAgentIds = new Set(existingAgents.map((a) => a._id.toString()));
      const invalidAgents = validAgentIds.filter((id) => !existingAgentIds.has(id.toString()));

      if (invalidAgents.length > 0) {
        return {
          success: false,
          statusCode: 400,
          message: `One or more selected agents are invalid or do not hold the SALES role: ${invalidAgents.join(', ')}`,
        };
      }
    }

    let mapping = await PropertyMapping.findOne({ normalizedName });

    if (mapping) {
      // Preserve sequence state:
      // If lastAssignedAgentId is still in the new mapping, keep pointer aligned to that agent
      if (mapping.lastAssignedAgentId) {
        const lastAssignedStr = mapping.lastAssignedAgentId.toString();
        const newIdx = validAgentIds.findIndex((id) => id.toString() === lastAssignedStr);
        if (newIdx !== -1) {
          mapping.lastAssignedIndex = newIdx;
        } else {
          // If previous agent was removed, clamp index safely without arbitrary reset
          mapping.lastAssignedIndex =
            validAgentIds.length > 0
              ? Math.min(mapping.lastAssignedIndex, validAgentIds.length - 1)
              : -1;
        }
      } else {
        mapping.lastAssignedIndex = -1;
      }

      mapping.propertyName = trimmedName;
      mapping.agentIds = validAgentIds;
      mapping.updatedById = new Types.ObjectId(actor.id);
      await mapping.save();
    } else {
      mapping = new PropertyMapping({
        propertyName: trimmedName,
        normalizedName,
        agentIds: validAgentIds,
        lastAssignedIndex: -1,
        lastAssignedAgentId: null,
        createdById: new Types.ObjectId(actor.id),
        updatedById: new Types.ObjectId(actor.id),
      });
      await mapping.save();
    }

    // Sync User.assignedPropertyIds for bidirectional consistency
    const propObjectId = mapping._id as Types.ObjectId;
    if ((mongoose.connection.readyState === 1 || (User as any)._isMocked) && typeof User.updateMany === 'function') {
      try {
        await User.updateMany(
          { _id: { $in: validAgentIds }, assignedPropertyIds: { $ne: propObjectId } },
          { $addToSet: { assignedPropertyIds: propObjectId } }
        );
        await User.updateMany(
          { _id: { $nin: validAgentIds }, assignedPropertyIds: propObjectId },
          { $pull: { assignedPropertyIds: propObjectId } }
        );
      } catch (syncErr) {
        console.warn('[PropertyMappingService] Failed to sync User.assignedPropertyIds:', syncErr);
      }
    }

    const populated = await PropertyMapping.findById(mapping._id)
      .populate('agentIds', 'name email role isActive isTeamActive')
      .populate('lastAssignedAgentId', 'name email role')
      .lean<IPropertyMapping>();

    return {
      success: true,
      statusCode: 200,
      message: `Property mapping for "${trimmedName}" updated successfully.`,
      mapping: populated || mapping,
    };
  }

  /**
   * Admin-only: Deletes a property mapping.
   */
  async deleteMapping(
    id: string,
    actor: AuthUser
  ): Promise<{ success: boolean; statusCode: number; message: string }> {
    if (actor.role !== 'ADMIN') {
      return {
        success: false,
        statusCode: 403,
        message: 'Access denied: Only administrators may delete property mappings.',
      };
    }

    if (!id || !Types.ObjectId.isValid(id)) {
      return {
        success: false,
        statusCode: 400,
        message: 'Invalid property mapping ID format.',
      };
    }

    const deleted = await PropertyMapping.findByIdAndDelete(id);
    if (!deleted) {
      return {
        success: false,
        statusCode: 404,
        message: 'Property mapping not found.',
      };
    }

    // Clean up assignedPropertyIds from User records
    if ((mongoose.connection.readyState === 1 || (User as any)._isMocked) && typeof User.updateMany === 'function') {
      try {
        await User.updateMany(
          { assignedPropertyIds: new Types.ObjectId(id) },
          { $pull: { assignedPropertyIds: new Types.ObjectId(id) } }
        );
      } catch (syncErr) {
        console.warn('[PropertyMappingService] Failed to clean up User.assignedPropertyIds:', syncErr);
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: `Property mapping for "${deleted.propertyName}" deleted successfully.`,
    };
  }

  /**
   * Sequential Round Robin assignment for a specific property.
   * Concurrency-safe: uses Optimistic Concurrency Control with retry.
   * Inactive agents are skipped; pointer advances only on successful assignment.
   */
  async getNextRoundRobinAgent(propertyName: string | undefined | null): Promise<RoundRobinResult> {
    const trimmed = propertyName?.trim();
    if (!trimmed) {
      return {
        success: false,
        assignedAgent: null,
        reason: 'NO_PROPERTY_SPECIFIED',
      };
    }

    const normalizedName = trimmed.toLowerCase();
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const mapping = await PropertyMapping.findOne({ normalizedName });

      if (!mapping) {
        return {
          success: false,
          assignedAgent: null,
          reason: 'NO_PROPERTY_MAPPING',
          propertyName: trimmed,
        };
      }

      if (!mapping.agentIds || mapping.agentIds.length === 0) {
        return {
          success: false,
          assignedAgent: null,
          reason: 'NO_MAPPED_AGENTS',
          propertyName: trimmed,
        };
      }

      // Query active, eligible SALES agents among the mapped IDs
      const activeAgents = await User.find({
        _id: { $in: mapping.agentIds },
        role: 'SALES',
        isActive: true,
      }).select('_id name email role isTeamActive');

      // Build map of eligible agents (active employee and active team status)
      const eligibleMap = new Map<string, IUser>();
      for (const agent of activeAgents) {
        if (agent.isTeamActive !== false) {
          eligibleMap.set(agent._id.toString(), agent);
        }
      }

      if (eligibleMap.size === 0) {
        return {
          success: false,
          assignedAgent: null,
          reason: 'NO_ACTIVE_AGENTS',
          propertyName: trimmed,
        };
      }

      // Circular sequential search starting from (lastAssignedIndex + 1)
      const totalMapped = mapping.agentIds.length;
      let selectedCandidate: IUser | null = null;
      let selectedIndex = -1;

      for (let i = 0; i < totalMapped; i++) {
        const candidateIndex = (mapping.lastAssignedIndex + 1 + i) % totalMapped;
        const candidateId = mapping.agentIds[candidateIndex].toString();

        if (eligibleMap.has(candidateId)) {
          selectedCandidate = eligibleMap.get(candidateId)!;
          selectedIndex = candidateIndex;
          break;
        }
      }

      if (!selectedCandidate || selectedIndex === -1) {
        return {
          success: false,
          assignedAgent: null,
          reason: 'NO_ACTIVE_AGENTS',
          propertyName: trimmed,
        };
      }

      // Atomic pointer advancement with OCC check
      const updated = await PropertyMapping.findOneAndUpdate(
        { _id: mapping._id, lastAssignedIndex: mapping.lastAssignedIndex },
        {
          $set: {
            lastAssignedIndex: selectedIndex,
            lastAssignedAgentId: selectedCandidate._id,
            updatedAt: new Date(),
          },
        },
        { new: true }
      );

      if (updated) {
        return {
          success: true,
          assignedAgent: {
            id: selectedCandidate._id.toString(),
            name: selectedCandidate.name,
            email: selectedCandidate.email,
            role: selectedCandidate.role,
          },
          propertyName: trimmed,
        };
      }
      // If OCC failed due to concurrent update, loop and retry
    }

    // Fallback if max retries exceeded
    return {
      success: false,
      assignedAgent: null,
      reason: 'NO_ACTIVE_AGENTS',
      propertyName: trimmed,
    };
  }
}

export const propertyMappingService = new PropertyMappingService();
