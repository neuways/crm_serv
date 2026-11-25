import { UserRole } from '../models/user.model.js';

export interface CreateEmployeeInput {
  name: string;
  email: string;
  phone?: string | null;
  role: 'MANAGER' | 'SALES';
  temporaryPassword: string;
  managerId?: string | null;
  propertyIds?: string[];
}

export interface UpdateEmployeeInput {
  name?: string;
  phone?: string | null;
  role?: 'MANAGER' | 'SALES';
  managerId?: string | null;
  temporaryPassword?: string;
  propertyIds?: string[];
}

export interface SafeEmployeeData {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  isActive: boolean;
  isTeamActive?: boolean;
  mustChangePassword: boolean;
  hasGoogleLinked: boolean;
  managerId?: string | null;
  managerName?: string | null;
  managerRole?: UserRole | null;
  assignedPropertyIds?: string[];
  assignedProperties?: { id: string; name: string }[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

export interface UpdateEmployeeStatusOptions {
  transferOption?: 'TRANSFER_TO_MANAGER' | 'ADMIN_HANDLE';
  targetManagerId?: string | null;
}
