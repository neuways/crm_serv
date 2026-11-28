import mongoose, { Types } from 'mongoose';
import { User, IUser, UserRole, EMPLOYEE_PHONE_REGEX, extractNormalized10DigitPhone } from '../models/user.model.js';
import { PropertyMapping } from '../models/property-mapping.model.js';
import { Enquiry } from '../models/enquiry.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { notificationService } from './notification.service.js';
import { authService } from './auth.service.js';
import { normalizeEmail } from '../utils/normalization.js';
import { AuthUser } from '../types/auth.types.js';
import { CreateEmployeeInput, UpdateEmployeeInput, SafeEmployeeData, UpdateEmployeeStatusOptions } from '../types/user.types.js';
import { sanitizeErrorMessage, withOptionalTransaction } from '../config/db.js';

export class UserService {
  private parseAndValidatePhone(phone: string | null | undefined): string | null {
    if (phone === null || phone === undefined) {
      return null;
    }

    const trimmed = String(phone).trim();
    if (!trimmed) {
      return null;
    }

    const normalized = extractNormalized10DigitPhone(trimmed);
    if (!normalized || !EMPLOYEE_PHONE_REGEX.test(normalized)) {
      const err = new Error(
        'Mobile number must be a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.'
      );
      (err as any).statusCode = 400;
      throw err;
    }

    return normalized;
  }

  private async ensureUniqueEmployeePhone(normalizedPhone: string, excludeUserId?: string): Promise<void> {
    const filter: Record<string, any> = {
      $or: [{ normalizedPhone }, { phone: normalizedPhone }]
    };
    if (excludeUserId && Types.ObjectId.isValid(excludeUserId)) {
      filter._id = { $ne: new Types.ObjectId(excludeUserId) };
    }

    const existing = await User.findOne(filter).select('_id name phone normalizedPhone');
    if (
      existing &&
      (!excludeUserId || existing._id?.toString() !== excludeUserId) &&
      extractNormalized10DigitPhone(existing.normalizedPhone || existing.phone) === normalizedPhone
    ) {
      const err = new Error(`An employee account with mobile number "${normalizedPhone}" already exists.`);
      (err as any).statusCode = 409;
      throw err;
    }
  }

  private async findSupervisorById(supervisorId: string): Promise<IUser | null> {
    let supervisor = await User.findOne({ _id: supervisorId, role: 'MANAGER' });
    if (!supervisor) {
      supervisor = await User.findOne({ _id: supervisorId, role: 'ADMIN' });
    }
    if (!supervisor) {
      const candidate = await User.findById(supervisorId);
      if (candidate && (candidate.role === 'MANAGER' || candidate.role === 'ADMIN')) {
        supervisor = candidate;
      }
    }
    return supervisor;
  }

  private async resolveSalesSupervisor(
    requestedManagerId: string | null | undefined,
    actor: AuthUser
  ): Promise<{ managerId: Types.ObjectId | null; managerName: string | null; managerRole: UserRole | null }> {
    const trimmedManagerId = typeof requestedManagerId === 'string' ? requestedManagerId.trim() : '';

    if (trimmedManagerId) {
      if (!Types.ObjectId.isValid(trimmedManagerId)) {
        const err = new Error('Invalid Manager ID format.');
        (err as any).statusCode = 400;
        throw err;
      }

      const supervisor = await this.findSupervisorById(trimmedManagerId);
      if (!supervisor) {
        const err = new Error('Assigned Manager or Admin not found.');
        (err as any).statusCode = 404;
        throw err;
      }

      return {
        managerId: supervisor._id as Types.ObjectId,
        managerName: supervisor.name,
        managerRole: supervisor.role
      };
    }

    // Default to Direct Admin oversight (creating/updating ADMIN's ID) when managerId is empty/null
    if (actor.role === 'ADMIN' && actor.id && Types.ObjectId.isValid(actor.id)) {
      const adminDoc = await User.findById(actor.id);
      if (adminDoc) {
        return {
          managerId: adminDoc._id as Types.ObjectId,
          managerName: adminDoc.name,
          managerRole: adminDoc.role
        };
      }
      return {
        managerId: new Types.ObjectId(actor.id),
        managerName: actor.name || 'Admin',
        managerRole: 'ADMIN'
      };
    }

    return {
      managerId: null,
      managerName: null,
      managerRole: null
    };
  }

  /**
   * Retrieves all registered employees excluding sensitive authentication secrets.
   * Excludes passwordHash and googleSub.
   */
  async listEmployees(): Promise<SafeEmployeeData[]> {
    const query: any = User.find()
      .select('name email phone role isActive mustChangePassword googleSub managerId assignedPropertyIds createdAt updatedAt');

    if (typeof query.populate === 'function') {
      query.populate('managerId', 'name email role');
    }

    const users = await query.sort({ createdAt: -1 }).lean();
    let allMappings: any[] = [];
    if (mongoose.connection.readyState === 1 || (PropertyMapping as any)._isMocked) {
      try {
        allMappings = await PropertyMapping.find().select('_id propertyName agentIds').lean();
      } catch {
        allMappings = [];
      }
    }

    return users.map((u: any) => {
      let assignedProperties: { id: string; name: string }[] | undefined = undefined;
      let assignedPropertyIds: string[] | undefined = undefined;

      if (u.role === 'SALES') {
        const userPropMap = new Map<string, string>();
        for (const m of allMappings) {
          const isAgentMapped = m.agentIds?.some((aId: any) => aId.toString() === u._id.toString());
          const isUserAssigned = u.assignedPropertyIds?.some((pId: any) => pId.toString() === m._id.toString());
          if (isAgentMapped || isUserAssigned) {
            userPropMap.set(m._id.toString(), m.propertyName);
          }
        }
        assignedProperties = Array.from(userPropMap.entries()).map(([id, name]) => ({ id, name }));
        assignedPropertyIds = assignedProperties.map((p) => p.id);
      }

      return {
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        phone: u.phone || null,
        role: u.role,
        isActive: u.isActive,
        mustChangePassword: Boolean(u.mustChangePassword),
        hasGoogleLinked: Boolean(u.googleSub),
        managerId: u.managerId?._id ? u.managerId._id.toString() : u.managerId ? u.managerId.toString() : null,
        managerName: u.managerId?.name || null,
        managerRole: u.managerId?.role || null,
        assignedPropertyIds,
        assignedProperties,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt
      };
    });
  }

  /**
   * Provisions a new employee account with role MANAGER or SALES.
   * Strictly enforces ADMIN authorization, input normalization, duplicate email checks,
   * and hashing of the temporary password.
   */
  async createEmployee(input: CreateEmployeeInput, actor: AuthUser): Promise<SafeEmployeeData> {
    if (actor.role !== 'ADMIN') {
      const err = new Error('Access denied. Only ADMIN users may create employee accounts.');
      (err as any).statusCode = 403;
      throw err;
    }

    // Role check: Only MANAGER or SALES can be created via this endpoint
    if (input.role !== 'MANAGER' && input.role !== 'SALES') {
      const err = new Error(
        'Invalid role. Only MANAGER and SALES employee accounts can be created through this interface. Initial ADMIN provisioning requires the server bootstrap CLI.'
      );
      (err as any).statusCode = 400;
      throw err;
    }

    const trimmedName = input.name ? input.name.trim() : '';
    if (!trimmedName || trimmedName.length < 2) {
      const err = new Error('Full name is required and must be at least 2 characters long.');
      (err as any).statusCode = 400;
      throw err;
    }

    const normalized = normalizeEmail(input.email);
    if (!normalized || !normalized.includes('@')) {
      const err = new Error('A valid email address is required.');
      (err as any).statusCode = 400;
      throw err;
    }

    const validatedPhone = this.parseAndValidatePhone(input.phone);

    if (!input.temporaryPassword || input.temporaryPassword.length < 8) {
      const err = new Error('Temporary password must be at least 8 characters long.');
      (err as any).statusCode = 400;
      throw err;
    }

    // Duplicate check
    const existingUser = await User.findOne({ email: normalized });
    if (existingUser) {
      const err = new Error(`An employee account with email "${normalized}" already exists.`);
      (err as any).statusCode = 409;
      throw err;
    }

    if (validatedPhone) {
      await this.ensureUniqueEmployeePhone(validatedPhone);
    }

    let validatedManagerId: Types.ObjectId | null = null;
    let managerNameStr: string | null = null;
    let managerRole: UserRole | null = null;
    if (input.role === 'SALES') {
      const resolvedSupervisor = await this.resolveSalesSupervisor(input.managerId, actor);
      validatedManagerId = resolvedSupervisor.managerId;
      managerNameStr = resolvedSupervisor.managerName;
      managerRole = resolvedSupervisor.managerRole;
    }

    // Validate assigned properties for SALES role
    let assignedProperties: { id: string; name: string }[] | undefined = undefined;
    let assignedPropertyIds: string[] | undefined = undefined;
    let validPropertyObjectIds: Types.ObjectId[] = [];

    if (input.role === 'SALES' && Array.isArray(input.propertyIds) && input.propertyIds.length > 0) {
      const cleanIds = input.propertyIds
        .map((p) => String(p).trim())
        .filter((p) => Types.ObjectId.isValid(p))
        .map((p) => new Types.ObjectId(p));

      if (cleanIds.length > 0 && (mongoose.connection.readyState === 1 || (PropertyMapping as any)._isMocked)) {
        try {
          const matched = await PropertyMapping.find({ _id: { $in: cleanIds } });
          validPropertyObjectIds = matched.map((m) => m._id as Types.ObjectId);
          assignedProperties = matched.map((m) => ({ id: m._id.toString(), name: m.propertyName }));
          assignedPropertyIds = assignedProperties.map((p) => p.id);
        } catch {
          // Fallback if disconnected
        }
      }
    }

    // Hash temporary password
    const passwordHash = await authService.hashPassword(input.temporaryPassword);

    const newEmployee = new User({
      name: trimmedName,
      email: normalized,
      phone: validatedPhone,
      normalizedPhone: validatedPhone || undefined,
      passwordHash,
      role: input.role,
      isActive: true,
      mustChangePassword: true,
      managerId: validatedManagerId,
      assignedPropertyIds: validPropertyObjectIds
    });

    await newEmployee.save();

    // Bi-directionally sync PropertyMapping.agentIds
    if (validPropertyObjectIds.length > 0 && (mongoose.connection.readyState === 1 || (PropertyMapping as any)._isMocked)) {
      try {
        await PropertyMapping.updateMany(
          { _id: { $in: validPropertyObjectIds } },
          { $addToSet: { agentIds: newEmployee._id } }
        );
      } catch {
        // Fallback if disconnected
      }
    }

    return {
      id: newEmployee._id.toString(),
      name: newEmployee.name,
      email: newEmployee.email,
      phone: newEmployee.phone || null,
      role: newEmployee.role,
      isActive: newEmployee.isActive,
      mustChangePassword: true,
      hasGoogleLinked: false,
      managerId: validatedManagerId ? validatedManagerId.toString() : null,
      managerName: managerNameStr,
      managerRole,
      assignedPropertyIds,
      assignedProperties,
      createdAt: newEmployee.createdAt,
      updatedAt: newEmployee.updatedAt
    };
  }

  /**
   * Updates permitted employee details (name, role, assigned manager, temporary password, assigned properties).
   * Enforces ADMIN authorization.
   */
  async updateEmployee(
    targetUserId: string,
    input: UpdateEmployeeInput,
    actor: AuthUser
  ): Promise<SafeEmployeeData> {
    if (actor.role !== 'ADMIN') {
      const err = new Error('Access denied. Only ADMIN users may update employee details.');
      (err as any).statusCode = 403;
      throw err;
    }

    if (!targetUserId || !Types.ObjectId.isValid(targetUserId)) {
      const err = new Error('Invalid employee ID.');
      (err as any).statusCode = 400;
      throw err;
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      const err = new Error('Employee account not found.');
      (err as any).statusCode = 404;
      throw err;
    }

    // Protection: Prevent demoting ADMIN accounts
    if (user.role === 'ADMIN' && input.role) {
      const err = new Error('Administrator accounts cannot be demoted through this interface.');
      (err as any).statusCode = 400;
      throw err;
    }

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length < 2) {
        const err = new Error('Full name must be at least 2 characters long.');
        (err as any).statusCode = 400;
        throw err;
      }
      user.name = trimmed;
    }

    if (input.phone !== undefined) {
      const validatedPhone = this.parseAndValidatePhone(input.phone);
      if (validatedPhone) {
        await this.ensureUniqueEmployeePhone(validatedPhone, targetUserId);
      }
      user.phone = validatedPhone;
      user.normalizedPhone = validatedPhone || undefined;
    }

    if (input.role !== undefined && user.role !== 'ADMIN') {
      if (input.role !== 'MANAGER' && input.role !== 'SALES') {
        const err = new Error('Role must be MANAGER or SALES.');
        (err as any).statusCode = 400;
        throw err;
      }
      user.role = input.role;
    }

    let managerNameStr: string | null = null;
    let managerRole: UserRole | null = null;
    if (user.role === 'MANAGER') {
      user.managerId = null;
    } else if (user.role === 'SALES') {
      if (input.managerId !== undefined) {
        const resolvedSupervisor = await this.resolveSalesSupervisor(input.managerId, actor);
        user.managerId = resolvedSupervisor.managerId as any;
        managerNameStr = resolvedSupervisor.managerName;
        managerRole = resolvedSupervisor.managerRole;
      } else if (user.managerId) {
        const mgr = await User.findById(user.managerId).select('name role');
        if (mgr) {
          managerNameStr = mgr.name;
          managerRole = mgr.role || null;
        }
      }
    } else if (user.managerId) {
      const mgr = await User.findById(user.managerId).select('name role');
      if (mgr) {
        managerNameStr = mgr.name;
        managerRole = mgr.role || null;
      }
    }

    if (input.temporaryPassword !== undefined && input.temporaryPassword.trim() !== '') {
      if (input.temporaryPassword.length < 8) {
        const err = new Error('Temporary password must be at least 8 characters long.');
        (err as any).statusCode = 400;
        throw err;
      }
      user.passwordHash = await authService.hashPassword(input.temporaryPassword);
      user.mustChangePassword = true;
    }

    // Handle Property Assignment sync
    let assignedProperties: { id: string; name: string }[] | undefined = undefined;
    let assignedPropertyIds: string[] | undefined = undefined;

    if (user.role === 'MANAGER') {
      // Clear properties if user is or became a manager
      user.assignedPropertyIds = [];
      if (mongoose.connection.readyState === 1 || (PropertyMapping as any)._isMocked) {
        try {
          const mappingsWithUser = await PropertyMapping.find({ agentIds: user._id });
          for (const rm of mappingsWithUser) {
            rm.agentIds = rm.agentIds.filter((aId) => aId.toString() !== user._id.toString());
            if (rm.lastAssignedAgentId && rm.lastAssignedAgentId.toString() === user._id.toString()) {
              rm.lastAssignedAgentId = null;
            }
            if (rm.agentIds.length > 0) {
              if (rm.lastAssignedIndex >= rm.agentIds.length) {
                rm.lastAssignedIndex = rm.agentIds.length - 1;
              }
            } else {
              rm.lastAssignedIndex = -1;
            }
            await rm.save();
          }
        } catch {
          // Fallback
        }
      }
      assignedProperties = [];
      assignedPropertyIds = [];
    } else if (user.role === 'SALES' && input.propertyIds !== undefined) {
      const cleanIds = input.propertyIds
        .map((p) => String(p).trim())
        .filter((p) => Types.ObjectId.isValid(p))
        .map((p) => new Types.ObjectId(p));

      let matchedMappings: any[] = [];
      if (cleanIds.length > 0 && (mongoose.connection.readyState === 1 || (PropertyMapping as any)._isMocked)) {
        try {
          matchedMappings = await PropertyMapping.find({ _id: { $in: cleanIds } });
        } catch {
          matchedMappings = [];
        }
      }

      const newPropObjectIds = matchedMappings.map((m) => m._id as Types.ObjectId);
      user.assignedPropertyIds = newPropObjectIds;
      assignedProperties = matchedMappings.map((m) => ({ id: m._id.toString(), name: m.propertyName }));
      assignedPropertyIds = assignedProperties.map((p) => p.id);

      if (mongoose.connection.readyState === 1 || (PropertyMapping as any)._isMocked) {
        try {
          // Add user._id to newly assigned properties
          if (newPropObjectIds.length > 0) {
            await PropertyMapping.updateMany(
              { _id: { $in: newPropObjectIds } },
              { $addToSet: { agentIds: user._id } }
            );
          }

          // Remove user._id from properties that are no longer assigned
          const removedMappings = await PropertyMapping.find({
            agentIds: user._id,
            _id: { $nin: newPropObjectIds }
          });

          for (const rm of removedMappings) {
            rm.agentIds = rm.agentIds.filter((aId) => aId.toString() !== user._id.toString());
            if (rm.lastAssignedAgentId && rm.lastAssignedAgentId.toString() === user._id.toString()) {
              rm.lastAssignedAgentId = null;
            }
            if (rm.agentIds.length > 0) {
              if (rm.lastAssignedIndex >= rm.agentIds.length) {
                rm.lastAssignedIndex = rm.agentIds.length - 1;
              }
            } else {
              rm.lastAssignedIndex = -1;
            }
            await rm.save();
          }
        } catch {
          // Fallback
        }
      }
    } else if (user.role === 'SALES') {
      // Retain and populate current assigned properties
      if (mongoose.connection.readyState === 1 || (PropertyMapping as any)._isMocked) {
        try {
          const mappings = await PropertyMapping.find({
            $or: [
              { _id: { $in: user.assignedPropertyIds || [] } },
              { agentIds: user._id }
            ]
          }).select('_id propertyName').lean();
          assignedProperties = mappings.map((m) => ({ id: m._id.toString(), name: m.propertyName }));
          assignedPropertyIds = assignedProperties.map((p) => p.id);
        } catch {
          // Fallback
        }
      }
    }

    await user.save();

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone || null,
      role: user.role,
      isActive: user.isActive,
      mustChangePassword: Boolean(user.mustChangePassword),
      hasGoogleLinked: Boolean(user.googleSub),
      managerId: user.managerId ? user.managerId.toString() : null,
      managerName: managerNameStr,
      managerRole,
      assignedPropertyIds,
      assignedProperties,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  /**
   * Toggles an employee's active status (activate/deactivate).
   * Prevents an administrator from deactivating their own account.
   * When deactivating a MANAGER, safely transfers team members and active leads
   * to a selected active manager (Option A) or to Administrator handling (Option B).
   */
  async updateEmployeeStatus(
    targetUserId: string,
    isActive: boolean,
    actor: AuthUser,
    options?: UpdateEmployeeStatusOptions
  ): Promise<SafeEmployeeData> {
    if (actor.role !== 'ADMIN') {
      const err = new Error('Access denied. Only ADMIN users may update employee status.');
      (err as any).statusCode = 403;
      throw err;
    }

    if (actor.id === targetUserId && !isActive) {
      const err = new Error('Administrators cannot deactivate their own account.');
      (err as any).statusCode = 400;
      throw err;
    }

    const query: any = User.findById(targetUserId);
    if (typeof query?.populate === 'function') {
      query.populate('managerId', 'name role');
    }
    const user = await query;
    if (!user) {
      const err = new Error('Employee account not found.');
      (err as any).statusCode = 404;
      throw err;
    }

    if (user.role === 'MANAGER' && !isActive) {
      // Deactivating a MANAGER
      if (options?.transferOption === 'TRANSFER_TO_MANAGER') {
        const targetManagerId = options.targetManagerId;
        if (!targetManagerId || !Types.ObjectId.isValid(targetManagerId)) {
          const err = new Error('A valid target manager must be selected to transfer the team and leads.');
          (err as any).statusCode = 400;
          throw err;
        }
        if (targetManagerId === targetUserId) {
          const err = new Error('Cannot transfer team to the manager being deactivated.');
          (err as any).statusCode = 400;
          throw err;
        }
        const targetManager = await User.findById(targetManagerId);
        if (!targetManager || targetManager.role !== 'MANAGER' || !targetManager.isActive) {
          const err = new Error('Selected target manager not found or is inactive.');
          (err as any).statusCode = 400;
          throw err;
        }

        await withOptionalTransaction(async (session) => {
          const sessionOpt = session ? { session } : undefined;
          user.isActive = false;
          await user.save(sessionOpt);

          // Transfer reporting sales agents
          await User.updateMany(
            { managerId: user._id },
            { $set: { managerId: targetManager._id } },
            sessionOpt
          );

          // Transfer active leads assigned to deactivated manager
          const activeLeads = await Enquiry.find({
            assignedTo: user._id,
            status: 'ACTIVE'
          });

          if (activeLeads.length > 0) {
            await Enquiry.updateMany(
              { assignedTo: user._id, status: 'ACTIVE' },
              { $set: { assignedTo: targetManager._id } },
              sessionOpt
            );

            for (const lead of activeLeads) {
              try {
                const activity = new EnquiryActivity({
                  enquiryId: lead._id,
                  performedBy: new Types.ObjectId(actor.id),
                  performedByName: actor.name,
                  type: 'ASSIGNMENT_CHANGED',
                  note: `Enquiry reassigned from ${user.name} (deactivated) to ${targetManager.name}`,
                  metadata: {
                    previousAssigneeId: user._id.toString(),
                    previousAssigneeName: user.name,
                    newAssigneeId: targetManager._id.toString(),
                    newAssigneeName: targetManager.name,
                    reason: 'MANAGER_DEACTIVATION_TRANSFER'
                  }
                });
                await activity.save(sessionOpt);
              } catch {
                // Ignore in mock if unhooked
              }
            }

            try {
              await notificationService.createNotification({
                recipient: targetManager._id.toString(),
                type: 'LEAD_ASSIGNED',
                title: 'Team and Leads Transferred',
                message: `You have been assigned ${activeLeads.length} lead(s) and reporting team members following the deactivation of ${user.name}.`,
              });
            } catch {
              // Best-effort notification
            }
          }
        });
      } else {
        // Option B: Admin Handles the Team and Leads directly (or default fallback)
        await withOptionalTransaction(async (session) => {
          const sessionOpt = session ? { session } : undefined;
          user.isActive = false;
          await user.save(sessionOpt);

          // Release reporting agents to unassigned pool under Admin control
          await User.updateMany(
            { managerId: user._id },
            { $set: { managerId: null } },
            sessionOpt
          );

          // Transfer active leads assigned to deactivated manager to Admin
          const activeLeads = await Enquiry.find({
            assignedTo: user._id,
            status: 'ACTIVE'
          });

          if (activeLeads.length > 0) {
            await Enquiry.updateMany(
              { assignedTo: user._id, status: 'ACTIVE' },
              { $set: { assignedTo: new Types.ObjectId(actor.id) } },
              sessionOpt
            );

            for (const lead of activeLeads) {
              try {
                const activity = new EnquiryActivity({
                  enquiryId: lead._id,
                  performedBy: new Types.ObjectId(actor.id),
                  performedByName: actor.name,
                  type: 'ASSIGNMENT_CHANGED',
                  note: `Enquiry transferred to Administrator ${actor.name} following manager deactivation`,
                  metadata: {
                    previousAssigneeId: user._id.toString(),
                    previousAssigneeName: user.name,
                    newAssigneeId: actor.id,
                    newAssigneeName: actor.name,
                    reason: 'MANAGER_DEACTIVATION_ADMIN_HANDLE'
                  }
                });
                await activity.save(sessionOpt);
              } catch {
                // Ignore in mock if unhooked
              }
            }
          }
        });
      }
    } else {
      user.isActive = isActive;
      await user.save();
    }

    let assignedProperties: { id: string; name: string }[] | undefined = undefined;
    let assignedPropertyIds: string[] | undefined = undefined;

    if (user.role === 'SALES' && (mongoose.connection.readyState === 1 || (PropertyMapping as any)._isMocked)) {
      try {
        const mappings = await PropertyMapping.find({
          $or: [
            { _id: { $in: user.assignedPropertyIds || [] } },
            { agentIds: user._id }
          ]
        }).select('_id propertyName').lean();
        assignedProperties = mappings.map((m) => ({ id: m._id.toString(), name: m.propertyName }));
        assignedPropertyIds = assignedProperties.map((p) => p.id);
      } catch {
        // Fallback
      }
    }

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone || null,
      role: user.role,
      isActive: user.isActive,
      mustChangePassword: Boolean(user.mustChangePassword),
      hasGoogleLinked: Boolean(user.googleSub),
      managerId: user.managerId ? (user.managerId as any)._id?.toString() || (user.managerId as any).toString() : null,
      managerName: (user.managerId as any)?.name || null,
      managerRole: (user.managerId as any)?.role || null,
      assignedPropertyIds,
      assignedProperties,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  /**
   * Deletes an employee account (MANAGER or SALES).
   * Restricted strictly to ADMIN role.
   * Prevents self-deletion or deletion of other ADMIN accounts.
   * Performs proper cleanup of team assignments, property mappings, and assigned leads.
   */
  async deleteEmployee(
    targetUserId: string,
    actor: AuthUser
  ): Promise<{ success: boolean; message: string }> {
    if (actor.role !== 'ADMIN') {
      const err = new Error('Access denied: Only Administrators can delete employee accounts.');
      (err as any).statusCode = 403;
      throw err;
    }

    if (!targetUserId || !Types.ObjectId.isValid(targetUserId)) {
      const err = new Error('Invalid employee ID provided.');
      (err as any).statusCode = 400;
      throw err;
    }

    if (targetUserId === actor.id.toString()) {
      const err = new Error('Administrators cannot delete their own account.');
      (err as any).statusCode = 400;
      throw err;
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      const err = new Error('Employee account not found.');
      (err as any).statusCode = 404;
      throw err;
    }

    if (targetUser.role === 'ADMIN') {
      const err = new Error('Administrator accounts cannot be deleted.');
      (err as any).statusCode = 400;
      throw err;
    }

    const targetObjId = targetUser._id as Types.ObjectId;

    // 1. If Manager: unassign reporting sales agents so they become unassigned
    if (targetUser.role === 'MANAGER') {
      await User.updateMany(
        { managerId: targetObjId },
        { $set: { managerId: null } }
      );
    }

    // 2. If Sales Agent: remove from property mappings
    if (targetUser.role === 'SALES') {
      if (mongoose.connection.readyState === 1 || (PropertyMapping as any)._isMocked) {
        try {
          await PropertyMapping.updateMany(
            { agentIds: targetObjId },
            { $pull: { agentIds: targetObjId } }
          );
        } catch (e) {
          console.warn('[UserService] PropertyMapping update warning:', sanitizeErrorMessage(e));
        }
      }
    }

    // 3. Unassign leads currently assigned to the deleted user to prevent orphaned references
    try {
      await Enquiry.updateMany(
        { assignedToId: targetObjId },
        { $set: { assignedToId: null } }
      );
    } catch (e) {
      console.warn('[UserService] Enquiry unassign warning:', sanitizeErrorMessage(e));
    }

    // 4. Delete the employee user record
    await User.findByIdAndDelete(targetObjId);

    return {
      success: true,
      message: `Employee ${targetUser.name} (${targetUser.role}) deleted successfully.`
    };
  }
}

export const userService = new UserService();
