import mongoose, { Types } from 'mongoose';
import * as xlsx from 'xlsx';
import { BulkImport, IBulkImport, IImportRowError, BulkImportStatus } from '../models/bulk-import.model.js';
import { Enquiry, IEnquiry, PreferredContactMethod } from '../models/enquiry.model.js';
import { FollowUpTask } from '../models/follow-up-task.model.js';
import { EnquiryActivity } from '../models/enquiry-activity.model.js';
import { User, IUser } from '../models/user.model.js';
import { propertyMappingService } from './property-mapping.service.js';
import { notificationService } from './notification.service.js';
import { enquiryService, isInitialTaskDuplicateKeyError, buildLeadAssignmentMetadata } from './enquiry.service.js';
import { normalizeMobile, normalizeEmail } from '../utils/normalization.js';
import { AuthUser } from '../types/auth.types.js';

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_DATA_ROWS = 500;
export const BATCH_SIZE = 250;

export interface ParseFileResult {
  importId: string;
  originalFilename: string;
  fileSize: number;
  totalRows: number;
  detectedHeaders: string[];
  suggestedMapping: Record<string, string>;
  previewRows: Array<Record<string, any>>;
}

export interface PreviewImportResult {
  importId: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  missingPropertyRows: number;
  assignmentSummary: {
    assignedTarget: string;
    willAssignCount: number;
    willBeUnassignedCount: number;
  };
  sampleValidatedRows: Array<{
    rowNumber: number;
    name: string;
    mobile: string;
    projectName?: string;
    status: 'VALID' | 'DUPLICATE' | 'INVALID';
    reason?: string;
  }>;
}

// Field aliases for automatic mapping heuristic
const FIELD_ALIASES: Record<string, string[]> = {
  name: [
    'name', 'customer', 'customer name', 'customer_name', 'client', 'client name',
    'client_name', 'lead name', 'lead_name', 'prospect', 'prospect name',
    'prospect_name', 'full name', 'fullname', 'contact person', 'buyer name'
  ],
  mobile: [
    'mobile', 'mobile no', 'mobile number', 'mobile_no', 'mobile_number',
    'contact', 'contact no', 'contact number', 'contactno', 'contact_no',
    'phone', 'phone no', 'phone number', 'phoneno', 'phone_no',
    'cell', 'cell phone', 'cell_phone', 'cellphone', 'telephone'
  ],
  email: [
    'email', 'email id', 'email_id', 'emailid', 'email address',
    'email_address', 'mail', 'mail id', 'mail_id'
  ],
  projectName: [
    'project', 'project name', 'project_name', 'projectname',
    'property', 'property name', 'property_name', 'propertyname',
    'development', 'building', 'scheme', 'venture'
  ],
  preferredLocation: [
    'preferred location', 'preferred_location', 'location',
    'micro market', 'micromarket', 'micro_market', 'area', 'locality',
    'preferred area', 'preferred locality'
  ],
  requirement: [
    'requirement', 'requirements', 'configuration', 'type', 'unit type',
    'unit_type', 'unittype', 'bhk', 'property type', 'property_type',
    'interest', 'looking for'
  ],
  budgetMin: [
    'budget min', 'min budget', 'min_budget', 'budget from', 'price min',
    'minimum budget', 'budgetmin', 'budget_min'
  ],
  budgetMax: [
    'budget max', 'max budget', 'max_budget', 'budget to', 'price max',
    'maximum budget', 'budgetmax', 'budget_max', 'budget', 'investment',
    'price', 'deal size', 'approx budget'
  ],
  description: [
    'description', 'notes', 'remarks', 'comment', 'comments', 'details',
    'additional info', 'lead note'
  ],
  source: [
    'source', 'lead source', 'lead_source', 'enquiry source',
    'enquiry_source', 'campaign', 'channel', 'media'
  ],
  preferredContactMethod: [
    'contact method', 'preferred contact method', 'mode', 'contact mode',
    'preferred_contact_method', 'contact_method'
  ],
  preferredContactTiming: [
    'timing', 'preferred timing', 'preferred contact timing', 'call time',
    'preferred time', 'preferred_contact_timing', 'contact_timing'
  ]
};

export class BulkImportService {
  /**
   * Safe CSV cell escaping to prevent Formula Injection (CSV Injection).
   */
  escapeCsvCell(val: any): string {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str; // Neutralize formula execution in Excel/Calc
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Automatically maps incoming file headers to CRM enquiry fields.
   */
  suggestMapping(headers: string[]): Record<string, string> {
    const mapping: Record<string, string> = {};
    const usedCrmFields = new Set<string>();

    for (const rawHeader of headers) {
      const cleanHeader = rawHeader.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleanHeader) continue;

      for (const [crmField, aliases] of Object.entries(FIELD_ALIASES)) {
        if (usedCrmFields.has(crmField)) continue;

        const exactMatch = aliases.includes(cleanHeader);
        if (exactMatch) {
          mapping[rawHeader] = crmField;
          usedCrmFields.add(crmField);
          break;
        }

        // Substring match heuristic if no exact match
        const partialMatch = aliases.some((a) => cleanHeader === a || cleanHeader.includes(a));
        if (partialMatch) {
          mapping[rawHeader] = crmField;
          usedCrmFields.add(crmField);
          break;
        }
      }
    }

    return mapping;
  }

  /**
   * Validates file format, enforces limits, extracts headers, and stages parsed rows.
   */
  async parseAndStageFile(
    buffer: Buffer,
    originalFilename: string,
    fileSize: number,
    actor: AuthUser
  ): Promise<ParseFileResult> {
    // 1. File size check
    if (fileSize > MAX_FILE_SIZE_BYTES || buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File size (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds the maximum allowed 5 MB limit.`);
    }

    // 2. Extension validation
    const lowerFilename = (originalFilename || '').toLowerCase();
    const isXlsx = lowerFilename.endsWith('.xlsx');
    const isCsv = lowerFilename.endsWith('.csv');

    if (!isXlsx && !isCsv) {
      throw new Error('Unsupported file format. Only Excel (.xlsx) and CSV (.csv) files are supported.');
    }

    // 3. Content-level validation & parsing
    let workbook: xlsx.WorkBook;
    try {
      if (isXlsx) {
        // XLSX must be a valid ZIP archive starting with PK\x03\x04
        if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
          throw new Error('File content does not match a valid Excel (.xlsx) workbook.');
        }
      }
      workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
    } catch (err: any) {
      throw new Error(`Failed to parse file: ${err.message || 'Invalid or corrupted file content.'}`);
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Uploaded workbook contains no visible sheets.');
    }

    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
      throw new Error('First worksheet is empty or unreadable.');
    }

    // Convert sheet to 2D array
    const rawMatrix: any[][] = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false
    });

    if (!rawMatrix || rawMatrix.length === 0) {
      throw new Error('Uploaded file is completely empty.');
    }

    // 4. Header validation
    const headerRow = rawMatrix[0];
    if (!headerRow || headerRow.length === 0) {
      throw new Error('Header row is missing or empty.');
    }

    const detectedHeaders: string[] = [];
    for (let c = 0; c < headerRow.length; c++) {
      const hStr = String(headerRow[c] ?? '').trim();
      if (hStr) {
        detectedHeaders.push(hStr);
      }
    }

    if (detectedHeaders.length === 0) {
      throw new Error('File contains no valid header columns.');
    }

    // 5. Data rows extraction & limits
    const rawDataRows = rawMatrix.slice(1);
    const validDataRows: Array<Record<string, any>> = [];

    for (let r = 0; r < rawDataRows.length; r++) {
      const row = rawDataRows[r];
      // Check if row has at least one non-empty value
      const hasContent = row && row.some((val: any) => String(val ?? '').trim().length > 0);
      if (!hasContent) continue;

      const rowObj: Record<string, any> = { _originalRowNumber: r + 2 };
      for (let c = 0; c < detectedHeaders.length; c++) {
        const headerName = detectedHeaders[c];
        rowObj[headerName] = row[c] !== undefined ? String(row[c]).trim() : '';
      }
      validDataRows.push(rowObj);
    }

    if (validDataRows.length === 0) {
      throw new Error('File contains a header row but no data records.');
    }

    if (validDataRows.length > MAX_DATA_ROWS) {
      throw new Error(`File exceeds maximum limit of 500 data records (found ${validDataRows.length} data rows). Please split into smaller files.`);
    }

    // 6. Check single active import lock per user
    const existingActive = await BulkImport.findOne({
      uploadedBy: new Types.ObjectId(actor.id),
      status: { $in: ['QUEUED', 'PROCESSING'] }
    });
    if (existingActive) {
      throw new Error('You already have an active import job in progress. Please wait for it to complete before starting a new import.');
    }

    // 7. Auto-suggest column mapping
    const suggestedMapping = this.suggestMapping(detectedHeaders);

    // 8. Generate unique Import ID and stage in database
    const importId = `IMP-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // Default assignment config based on actor role
    const initialAssignmentConfig = {
      method: actor.role === 'SALES' ? ('SELF' as const) : ('ROUND_ROBIN' as const),
      assignedToId: actor.role === 'SALES' ? new Types.ObjectId(actor.id) : null,
      assignedToName: actor.role === 'SALES' ? actor.name : undefined
    };

    const importDoc = new BulkImport({
      importId,
      uploadedBy: new Types.ObjectId(actor.id),
      uploadedByName: actor.name,
      userRole: actor.role,
      originalFilename,
      fileSize,
      source: 'BULK_UPLOAD',
      totalRows: validDataRows.length,
      detectedHeaders,
      columnMapping: suggestedMapping,
      assignmentConfig: initialAssignmentConfig,
      stagedRows: validDataRows,
      status: 'PENDING_CONFIRMATION'
    });

    await importDoc.save();

    const previewRows = validDataRows.slice(0, 5).map((r) => {
      const copy = { ...r };
      delete copy._originalRowNumber;
      return copy;
    });

    return {
      importId,
      originalFilename,
      fileSize,
      totalRows: validDataRows.length,
      detectedHeaders,
      suggestedMapping,
      previewRows
    };
  }

  /**
   * Previews validation and duplicate summary for staged rows using user-specified mapping.
   */
  async previewStagedImport(
    importId: string,
    columnMapping: Record<string, string>,
    assignmentMethod?: 'ROUND_ROBIN' | 'MANUAL' | 'SELF',
    assignedToId?: string,
    actor?: AuthUser
  ): Promise<PreviewImportResult> {
    const importDoc = await BulkImport.findOne({ importId });
    if (!importDoc) {
      throw new Error(`Import session "${importId}" not found.`);
    }

    const uploaderIdStr = (importDoc.uploadedBy?._id || importDoc.uploadedBy)?.toString();
    if (actor && uploaderIdStr && uploaderIdStr !== actor.id && actor.role !== 'ADMIN') {
      throw new Error('Access denied: You cannot preview an import initiated by another user.');
    }

    const stagedRows = importDoc.stagedRows || [];
    if (stagedRows.length === 0) {
      throw new Error('No staged data rows found for this import.');
    }

    // Validate required mapping
    const mappedValues = Object.values(columnMapping);
    if (!mappedValues.includes('name')) {
      throw new Error("Column mapping must include the required 'Name' field.");
    }
    if (!mappedValues.includes('mobile')) {
      throw new Error("Column mapping must include the required 'Mobile' field.");
    }

    // Detect field header keys
    const nameHeader = Object.keys(columnMapping).find((k) => columnMapping[k] === 'name')!;
    const mobileHeader = Object.keys(columnMapping).find((k) => columnMapping[k] === 'mobile')!;
    const emailHeader = Object.keys(columnMapping).find((k) => columnMapping[k] === 'email');
    const projectHeader = Object.keys(columnMapping).find((k) => columnMapping[k] === 'projectName');

    // Collect mobiles and emails for batch duplicate checking
    const mobileCandidates: string[] = [];
    const emailCandidates: string[] = [];

    for (const row of stagedRows) {
      const rawMobile = String(row[mobileHeader] || '').trim();
      const rawEmail = emailHeader ? String(row[emailHeader] || '').trim() : '';

      try {
        if (rawMobile) mobileCandidates.push(normalizeMobile(rawMobile));
      } catch {}

      if (rawEmail) {
        const normEmail = normalizeEmail(rawEmail);
        if (normEmail) emailCandidates.push(normEmail);
      }
    }

    // Bulk lookup existing leads
    const orQueries: Array<Record<string, any>> = [];
    if (mobileCandidates.length > 0) {
      orQueries.push({ normalizedMobile: { $in: mobileCandidates } });
    }
    if (emailCandidates.length > 0) {
      orQueries.push({ normalizedEmail: { $in: emailCandidates } });
    }

    const existingDocs = orQueries.length > 0 ? await Enquiry.find({ $or: orQueries }).select('normalizedMobile normalizedEmail') : [];
    const existingMobiles = new Set(existingDocs.map((d) => d.normalizedMobile));
    const existingEmails = new Set(existingDocs.map((d) => d.normalizedEmail).filter(Boolean));

    let validRows = 0;
    let duplicateRows = 0;
    let invalidRows = 0;
    let missingPropertyRows = 0;

    const seenMobilesInFile = new Set<string>();
    const seenEmailsInFile = new Set<string>();
    const sampleValidatedRows: PreviewImportResult['sampleValidatedRows'] = [];

    for (let i = 0; i < stagedRows.length; i++) {
      const row = stagedRows[i];
      const rowNumber = row._originalRowNumber || i + 2;
      const rawName = String(row[nameHeader] || '').trim();
      const rawMobile = String(row[mobileHeader] || '').trim();
      const rawProject = projectHeader ? String(row[projectHeader] || '').trim() : '';

      if (!rawProject) {
        missingPropertyRows++;
      }

      if (!rawName) {
        invalidRows++;
        if (sampleValidatedRows.length < 10) {
          sampleValidatedRows.push({
            rowNumber,
            name: '(Empty Name)',
            mobile: rawMobile,
            projectName: rawProject || undefined,
            status: 'INVALID',
            reason: 'Missing customer name'
          });
        }
        continue;
      }

      let normMobile = '';
      try {
        normMobile = normalizeMobile(rawMobile);
      } catch (err: any) {
        invalidRows++;
        if (sampleValidatedRows.length < 10) {
          sampleValidatedRows.push({
            rowNumber,
            name: rawName,
            mobile: rawMobile,
            projectName: rawProject || undefined,
            status: 'INVALID',
            reason: err.message || 'Invalid mobile number'
          });
        }
        continue;
      }

      const rawEmail = emailHeader ? String(row[emailHeader] || '').trim() : '';
      const normEmail = rawEmail ? normalizeEmail(rawEmail) : undefined;

      const isMobileDup = existingMobiles.has(normMobile) || seenMobilesInFile.has(normMobile);
      const isEmailDup = Boolean(normEmail && (existingEmails.has(normEmail) || seenEmailsInFile.has(normEmail)));

      if (isMobileDup || isEmailDup) {
        duplicateRows++;
        const reason = isMobileDup && isEmailDup ? 'Mobile & Email duplicate' : isMobileDup ? 'Mobile duplicate' : 'Email duplicate';
        if (sampleValidatedRows.length < 10) {
          sampleValidatedRows.push({
            rowNumber,
            name: rawName,
            mobile: rawMobile,
            projectName: rawProject || undefined,
            status: 'DUPLICATE',
            reason
          });
        }
        continue;
      }

      seenMobilesInFile.add(normMobile);
      if (normEmail) seenEmailsInFile.add(normEmail);
      validRows++;

      if (sampleValidatedRows.length < 10) {
        sampleValidatedRows.push({
          rowNumber,
          name: rawName,
          mobile: rawMobile,
          projectName: rawProject || undefined,
          status: 'VALID'
        });
      }
    }

    // Determine assignment summary
    let assignedTarget = 'Uploader';
    let willAssignCount = validRows;
    let willBeUnassignedCount = 0;

    const role = actor ? actor.role : importDoc.userRole;

    if (role === 'SALES') {
      assignedTarget = 'Self (Sales Agent)';
      willAssignCount = validRows;
      willBeUnassignedCount = 0;
    } else {
      // ADMIN or MANAGER
      // Confirmed rule: rows missing property go to Unassigned Queue!
      willBeUnassignedCount = Math.min(missingPropertyRows, validRows);
      willAssignCount = Math.max(0, validRows - willBeUnassignedCount);

      if (assignmentMethod === 'ROUND_ROBIN' || (!assignmentMethod && role === 'ADMIN')) {
        assignedTarget = 'Property-wise Round Robin (Leads with property) / Unassigned Queue (Leads without property)';
      } else {
        assignedTarget = 'Manual Assignment (Leads with property) / Unassigned Queue (Leads without property)';
      }
    }

    return {
      importId,
      totalRows: stagedRows.length,
      validRows,
      duplicateRows,
      invalidRows,
      missingPropertyRows,
      assignmentSummary: {
        assignedTarget,
        willAssignCount,
        willBeUnassignedCount
      },
      sampleValidatedRows
    };
  }

  /**
   * Confirms mapping and starts background sequential processing.
   */
  async confirmAndStartImport(
    importId: string,
    columnMapping: Record<string, string>,
    assignmentConfig: {
      method: 'ROUND_ROBIN' | 'MANUAL' | 'SELF';
      assignedToId?: string | null;
    },
    actor: AuthUser
  ): Promise<IBulkImport> {
    const importDoc = await BulkImport.findOne({ importId });
    if (!importDoc) {
      throw new Error(`Import session "${importId}" not found.`);
    }

    const uploaderIdStr = (importDoc.uploadedBy?._id || importDoc.uploadedBy)?.toString();
    if (uploaderIdStr && uploaderIdStr !== actor.id && actor.role !== 'ADMIN') {
      throw new Error('Access denied: You cannot confirm an import initiated by another user.');
    }

    if (importDoc.status !== 'PENDING_CONFIRMATION') {
      throw new Error(`Import is already in "${importDoc.status}" state.`);
    }

    // Check active import lock
    const activeRunning = await BulkImport.findOne({
      uploadedBy: new Types.ObjectId(actor.id),
      status: { $in: ['QUEUED', 'PROCESSING'] }
    });
    if (activeRunning) {
      throw new Error('You already have an active import job in progress. Please wait for it to complete.');
    }

    // Validate required mapping
    const values = Object.values(columnMapping);
    if (!values.includes('name') || !values.includes('mobile')) {
      throw new Error("Both 'Name' and 'Mobile' must be mapped before importing.");
    }

    // Prevent duplicate destination fields (e.g. mapping two columns to name)
    const counts: Record<string, number> = {};
    for (const f of values) {
      counts[f] = (counts[f] || 0) + 1;
      if (counts[f] > 1 && f !== 'description') {
        throw new Error(`CRM field "${f}" is mapped multiple times. Each CRM field may only be mapped once.`);
      }
    }

    // Role-specific assignment rules validation
    let resolvedMethod: 'ROUND_ROBIN' | 'MANUAL' | 'SELF' = 'SELF';
    let resolvedAssignedToId: Types.ObjectId | null = null;
    let resolvedAssignedToName: string | undefined = undefined;

    if (actor.role === 'SALES') {
      // Sales Agent leads must remain assigned to uploader
      resolvedMethod = 'SELF';
      resolvedAssignedToId = new Types.ObjectId(actor.id);
      resolvedAssignedToName = actor.name;
    } else if (actor.role === 'MANAGER') {
      // Manager can assign imported leads only to eligible active Sales Agents from their own team
      if (!assignmentConfig.assignedToId) {
        throw new Error('Managers must select an eligible Sales Agent from their team.');
      }

      const isAllowed = await enquiryService.isUserInManagerTeam(actor, assignmentConfig.assignedToId);
      if (!isAllowed) {
        throw new Error('Access denied: Managers may only assign enquiries to active members of their own team.');
      }

      const assignedUser = await User.findById(assignmentConfig.assignedToId).select('name isActive role');
      if (!assignedUser || !assignedUser.isActive || assignedUser.role !== 'SALES') {
        throw new Error('Selected team agent is inactive or invalid.');
      }

      resolvedMethod = 'MANUAL';
      resolvedAssignedToId = new Types.ObjectId(assignmentConfig.assignedToId);
      resolvedAssignedToName = assignedUser.name;
    } else if (actor.role === 'ADMIN') {
      if (assignmentConfig.method === 'MANUAL') {
        if (!assignmentConfig.assignedToId) {
          throw new Error("Manual assignment requires selecting an active Sales Agent.");
        }
        const assignedUser = await User.findById(assignmentConfig.assignedToId).select('name isActive role');
        if (!assignedUser || !assignedUser.isActive) {
          throw new Error('Selected agent is inactive or not found.');
        }
        resolvedMethod = 'MANUAL';
        resolvedAssignedToId = new Types.ObjectId(assignmentConfig.assignedToId);
        resolvedAssignedToName = assignedUser.name;
      } else {
        resolvedMethod = 'ROUND_ROBIN';
        resolvedAssignedToId = null;
      }
    }

    importDoc.status = 'QUEUED';
    importDoc.columnMapping = columnMapping;
    importDoc.assignmentConfig = {
      method: resolvedMethod,
      assignedToId: resolvedAssignedToId,
      assignedToName: resolvedAssignedToName
    };
    importDoc.startedAt = new Date();
    importDoc.totalBatches = Math.ceil(importDoc.totalRows / BATCH_SIZE);
    await importDoc.save();

    // Trigger sequential background processing asynchronously
    setImmediate(() => {
      this.processImportSequentially(importDoc._id.toString()).catch((err) => {
        console.error(`[BulkImportService] Unhandled failure on import ${importId}:`, err);
      });
    });

    return importDoc;
  }

  /**
   * Sequential background batch processor.
   * Processes maximum 250 records per batch sequentially.
   */
  async processImportSequentially(docId: string): Promise<void> {
    const importDoc = await BulkImport.findById(docId);
    if (!importDoc) return;

    importDoc.status = 'PROCESSING';
    await importDoc.save();

    const stagedRows = importDoc.stagedRows || [];
    const totalRows = stagedRows.length;
    const totalBatches = Math.ceil(totalRows / BATCH_SIZE);

    const mapping = importDoc.columnMapping instanceof Map ? Object.fromEntries(importDoc.columnMapping) : (importDoc.columnMapping || {});
    const nameHeader = Object.keys(mapping).find((k) => mapping[k] === 'name')!;
    const mobileHeader = Object.keys(mapping).find((k) => mapping[k] === 'mobile')!;
    const emailHeader = Object.keys(mapping).find((k) => mapping[k] === 'email');
    const projectHeader = Object.keys(mapping).find((k) => mapping[k] === 'projectName');
    const locationHeader = Object.keys(mapping).find((k) => mapping[k] === 'preferredLocation');
    const reqHeader = Object.keys(mapping).find((k) => mapping[k] === 'requirement');
    const budgetMinHeader = Object.keys(mapping).find((k) => mapping[k] === 'budgetMin');
    const budgetMaxHeader = Object.keys(mapping).find((k) => mapping[k] === 'budgetMax');
    const descHeader = Object.keys(mapping).find((k) => mapping[k] === 'description');
    const sourceHeader = Object.keys(mapping).find((k) => mapping[k] === 'source');
    const methodHeader = Object.keys(mapping).find((k) => mapping[k] === 'preferredContactMethod');
    const timingHeader = Object.keys(mapping).find((k) => mapping[k] === 'preferredContactTiming');

    const uploader = await User.findById(importDoc.uploadedBy).select('name email role');
    const actor: AuthUser = {
      id: importDoc.uploadedBy.toString(),
      name: importDoc.uploadedByName,
      email: uploader?.email || 'bulk-uploader@neuways.local',
      role: importDoc.userRole
    };

    let processedCount = importDoc.processedRows || 0;
    let importedCount = importDoc.importedCount || 0;
    let duplicateCount = importDoc.duplicateCount || 0;
    let invalidCount = importDoc.invalidCount || 0;
    let failedCount = importDoc.failedCount || 0;
    let assignedCount = importDoc.assignedCount || 0;
    let unassignedCount = importDoc.unassignedCount || 0;
    const rowErrors: IImportRowError[] = importDoc.rowErrors ? [...importDoc.rowErrors] : [];

    // In-memory file deduplication tracker
    const fileSeenMobiles = new Set<string>();
    const fileSeenEmails = new Set<string>();
    const fileSeenEnquiryMap = new Map<string, any>();

    // Seed fileSeen trackers from already processed rows
    for (const r of stagedRows) {
      if (r._processed && r._status === 'IMPORTED') {
        const rawM = String(r[mobileHeader] || '').trim();
        const rawE = emailHeader ? String(r[emailHeader] || '').trim() : '';
        try {
          if (rawM) {
            const nm = normalizeMobile(rawM);
            fileSeenMobiles.add(nm);
            if (r._enquiryId) fileSeenEnquiryMap.set(nm, { _id: r._enquiryId, normalizedMobile: nm });
          }
        } catch {}
        if (rawE) {
          const normE = normalizeEmail(rawE);
          if (normE) {
            fileSeenEmails.add(normE);
            if (r._enquiryId) fileSeenEnquiryMap.set(normE, { _id: r._enquiryId, normalizedEmail: normE });
          }
        }
      }
    }

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      // Check cancellation request before starting next batch
      const currentDoc = await BulkImport.findById(docId);
      if (currentDoc?.cancelRequested) {
        await BulkImport.findByIdAndUpdate(docId, {
          status: 'CANCELLED',
          completedAt: new Date()
        });
        return;
      }

      await BulkImport.findByIdAndUpdate(docId, {
        currentBatch: batchIndex + 1,
        totalBatches
      });

      const startIdx = batchIndex * BATCH_SIZE;
      const endIdx = Math.min(startIdx + BATCH_SIZE, totalRows);
      const batchRows = stagedRows.slice(startIdx, endIdx);

      // Pre-fetch normalized mobile/email for this batch
      const batchMobiles: string[] = [];
      const batchEmails: string[] = [];

      for (const row of batchRows) {
        if (row._processed) continue;
        const rawM = String(row[mobileHeader] || '').trim();
        const rawE = emailHeader ? String(row[emailHeader] || '').trim() : '';
        try {
          if (rawM) batchMobiles.push(normalizeMobile(rawM));
        } catch {}
        if (rawE) {
          const normE = normalizeEmail(rawE);
          if (normE) batchEmails.push(normE);
        }
      }

      // 1 single bulk duplicate lookup query for up to 250 records
      const orQueries: Array<Record<string, any>> = [];
      if (batchMobiles.length > 0) orQueries.push({ normalizedMobile: { $in: batchMobiles } });
      if (batchEmails.length > 0) orQueries.push({ normalizedEmail: { $in: batchEmails } });

      const existingDocs = orQueries.length > 0
        ? await Enquiry.find({ $or: orQueries }).select('_id normalizedMobile normalizedEmail status isActive currentStage rejection importId importRowNumber')
        : [];

      // Process each row sequentially within the batch
      for (let rIdx = 0; rIdx < batchRows.length; rIdx++) {
        const row = batchRows[rIdx];
        const overallIndex = startIdx + rIdx;
        const rowNumber = row._originalRowNumber || overallIndex + 2;
        const rawName = String(row[nameHeader] || '').trim();
        const rawMobile = String(row[mobileHeader] || '').trim();

        // Safe recovery check: Was this row already processed prior to server restart or batch retry?
        if (row._processed === true) {
          continue;
        }

        // 1. Validate required Name
        if (!rawName) {
          invalidCount++;
          processedCount++;
          row._processed = true;
          row._status = 'INVALID';
          rowErrors.push({
            rowNumber,
            customerIdentifier: 'N/A',
            field: 'name',
            category: 'INVALID',
            reason: 'Customer Name is required and cannot be empty.'
          });
          continue;
        }

        // 2. Validate required Mobile
        let normMobile = '';
        try {
          normMobile = normalizeMobile(rawMobile);
        } catch (mErr: any) {
          invalidCount++;
          processedCount++;
          row._processed = true;
          row._status = 'INVALID';
          rowErrors.push({
            rowNumber,
            customerIdentifier: rawName,
            field: 'mobile',
            category: 'INVALID',
            reason: `Invalid mobile number: "${rawMobile}" (${mErr.message || 'invalid format'}).`
          });
          continue;
        }

        // Normalize email if provided
        const rawEmail = emailHeader ? String(row[emailHeader] || '').trim() : '';
        let normEmail: string | undefined = undefined;
        if (rawEmail) {
          normEmail = normalizeEmail(rawEmail);
        }

        // Safe recovery check: Did this exact import session already insert an Enquiry for this row before restart?
        const alreadyPersisted = existingDocs.find(
          (d: any) => d.importId === importDoc.importId && d.importRowNumber === rowNumber
        );

        if (alreadyPersisted) {
          row._processed = true;
          row._status = 'IMPORTED';
          row._enquiryId = alreadyPersisted._id;
          fileSeenMobiles.add(normMobile);
          if (normEmail) fileSeenEmails.add(normEmail);
          processedCount++;
          continue;
        }

        // 3. Duplicate check against Database and previous rows in this file
        // Exclude docs belonging to this exact importId
        const foreignDbDocs = existingDocs.filter((d: any) => !d.importId || d.importId !== importDoc.importId);
        const matchesDbMobile = foreignDbDocs.some((d) => d.normalizedMobile === normMobile);
        const matchesFileMobile = fileSeenMobiles.has(normMobile);
        const matchesMobile = matchesDbMobile || matchesFileMobile;

        const matchesDbEmail = Boolean(normEmail && foreignDbDocs.some((d) => d.normalizedEmail === normEmail));
        const matchesFileEmail = Boolean(normEmail && fileSeenEmails.has(normEmail));
        const matchesEmail = matchesDbEmail || matchesFileEmail;

        if (matchesMobile || matchesEmail) {
          duplicateCount++;
          processedCount++;
          row._processed = true;
          row._status = 'DUPLICATE';

          let reason = '';
          const isIntraFile = matchesFileMobile || matchesFileEmail;
          const isDbMatch = matchesDbMobile || matchesDbEmail;

          if (isIntraFile && !isDbMatch) {
            if (matchesFileMobile && matchesFileEmail) {
              reason = 'Duplicate: Both mobile number and email appear multiple times within the uploaded file.';
            } else if (matchesFileMobile) {
              reason = `Duplicate: Mobile number "${normMobile}" appears multiple times within the uploaded file.`;
            } else {
              reason = `Duplicate: Email address "${normEmail}" appears multiple times within the uploaded file.`;
            }
          } else {
            if (matchesMobile && matchesEmail) {
              reason = 'Duplicate: Both mobile number and email already exist in CRM.';
            } else if (matchesEmail) {
              reason = `Duplicate: Email address "${normEmail}" already exists in CRM.`;
            } else {
              reason = `Duplicate: Mobile number "${normMobile}" already exists in CRM.`;
            }
          }

          rowErrors.push({
            rowNumber,
            customerIdentifier: `${rawName} (${rawMobile})`,
            field: matchesMobile ? 'mobile' : 'email',
            category: 'DUPLICATE',
            reason
          });

          // Log audit activity event with metadata.isBulkUpload = true
          // Excludes duplicate bell notifications while maintaining full visibility in Duplicate Data section
          let matchedDoc = foreignDbDocs.find(
            (d) => d.normalizedMobile === normMobile || (normEmail && d.normalizedEmail === normEmail)
          ) || fileSeenEnquiryMap.get(normMobile) || (normEmail ? fileSeenEnquiryMap.get(normEmail) : undefined);

          if (matchedDoc && (mongoose.connection.readyState === 1 || (EnquiryActivity as any)._isMocked)) {
            try {
              const dupActivity = new EnquiryActivity({
                enquiryId: matchedDoc._id,
                performedBy: new Types.ObjectId(actor.id),
                performedByName: actor.name,
                type: 'DUPLICATE_MATCH_DETECTED',
                note: `Bulk upload detected duplicate row: ${reason}`,
                metadata: {
                  matchReason: matchesMobile && matchesEmail ? 'BOTH' : matchesEmail ? 'EMAIL' : 'MOBILE',
                  attemptedName: rawName,
                  attemptedMobile: rawMobile,
                  attemptedEmail: rawEmail || undefined,
                  attemptedProjectName: projectHeader ? String(row[projectHeader] || '').trim() || undefined : undefined,
                  attemptedSource: 'Bulk Upload',
                  importId: importDoc.importId,
                  importRowNumber: rowNumber,
                  isBulkUpload: true,
                  reviewStatus: 'PENDING_REVIEW'
                }
              });
              await dupActivity.save();
            } catch (actErr) {
              // Ignore activity save errors during duplicate logging
            }
          }

          // Skip this duplicate row!
          continue;
        }

        // Add to file-seen trackers for subsequent rows (same batch and future batches)
        fileSeenMobiles.add(normMobile);
        if (normEmail) fileSeenEmails.add(normEmail);

        // 4. Extract other optional fields
        const rawProject = projectHeader ? String(row[projectHeader] || '').trim() : '';
        const rawLocation = locationHeader ? String(row[locationHeader] || '').trim() : '';
        const rawReq = reqHeader ? String(row[reqHeader] || '').trim() : '';
        const rawDesc = descHeader ? String(row[descHeader] || '').trim() : '';
        const rawSource = sourceHeader ? String(row[sourceHeader] || '').trim() : '';
        const rawMethod = methodHeader ? String(row[methodHeader] || '').trim().toUpperCase() : '';
        const rawTiming = timingHeader ? String(row[timingHeader] || '').trim() : '';

        let validMethod: PreferredContactMethod | undefined = undefined;
        if (['CALL', 'WHATSAPP', 'EMAIL'].includes(rawMethod)) {
          validMethod = rawMethod as PreferredContactMethod;
        }

        let budgetMin: number | undefined = undefined;
        let budgetMax: number | undefined = undefined;

        if (budgetMinHeader && row[budgetMinHeader]) {
          const num = Number(String(row[budgetMinHeader]).replace(/[^0-9.]/g, ''));
          if (!isNaN(num) && num >= 0) budgetMin = num;
        }

        if (budgetMaxHeader && row[budgetMaxHeader]) {
          const num = Number(String(row[budgetMaxHeader]).replace(/[^0-9.]/g, ''));
          if (!isNaN(num) && num >= 0) budgetMax = num;
        }

        if (budgetMin !== undefined && budgetMax !== undefined && budgetMin > budgetMax) {
          // Swap if min > max
          const temp = budgetMin;
          budgetMin = budgetMax;
          budgetMax = temp;
        }

        // 5. Role-Based Lead Assignment Resolution
        let assignedToId: string | null = null;
        let isAssigned = false;
        let isRoundRobinAssignment = false;
        let unassignedReason: string | undefined = undefined;

        try {
          if (actor.role === 'SALES') {
            // Sales agent leads always assigned to uploader
            assignedToId = actor.id;
            isAssigned = true;
          } else {
            // ADMIN or MANAGER
            if (rawProject) {
              if (importDoc.assignmentConfig.method === 'ROUND_ROBIN' && actor.role === 'ADMIN') {
                const rrResult = await propertyMappingService.getNextRoundRobinAgent(rawProject);
                if (rrResult.success && rrResult.assignedAgent) {
                  assignedToId = rrResult.assignedAgent.id;
                  isAssigned = true;
                  isRoundRobinAssignment = true;
                } else {
                  // Property mapped without active agent or unmapped: route to Unassigned Queue
                  assignedToId = null;
                  isAssigned = false;
                  if (rrResult.reason === 'NO_ACTIVE_AGENTS' || rrResult.reason === 'NO_MAPPED_AGENTS') {
                    unassignedReason = 'No eligible active Sales Agent';
                  } else if (rrResult.reason === 'NO_PROPERTY_MAPPING' || !rrResult.success) {
                    unassignedReason = 'Property mapping unavailable';
                  } else {
                    unassignedReason = 'No eligible active Sales Agent';
                  }
                }
              } else if (importDoc.assignmentConfig.assignedToId) {
                // Manual assignment
                if (actor.role === 'MANAGER') {
                  const isTeamMember = await enquiryService.isUserInManagerTeam(actor, importDoc.assignmentConfig.assignedToId.toString());
                  if (isTeamMember) {
                    assignedToId = importDoc.assignmentConfig.assignedToId.toString();
                    isAssigned = true;
                  } else {
                    assignedToId = null;
                    isAssigned = false;
                    unassignedReason = 'No eligible active Sales Agent';
                  }
                } else {
                  assignedToId = importDoc.assignmentConfig.assignedToId.toString();
                  isAssigned = true;
                }
              } else {
                assignedToId = null;
                isAssigned = false;
                unassignedReason = 'Assignment pending manual review';
              }
            } else {
              // Confirmed rule: Missing property rows for Admin/Manager route to Unassigned Queue
              assignedToId = null;
              isAssigned = false;
              unassignedReason = 'Property/project not selected';
            }
          }

          // 6. Persist Enquiry Record
          // REQ-38: Inherit Do Not Contact status for customer mobile
          const isDncRestricted = await enquiryService.isMobileDncRestricted(normMobile);

          const enquiry = new Enquiry({
            name: rawName,
            mobile: rawMobile,
            normalizedMobile: normMobile,
            email: normEmail ? rawEmail : undefined,
            normalizedEmail: normEmail,
            projectName: rawProject || undefined,
            preferredLocation: rawLocation || undefined,
            requirement: rawReq || undefined,
            budgetMin,
            budgetMax,
            description: rawDesc || undefined,
            source: rawSource || 'Bulk Upload',
            preferredContactMethod: validMethod,
            preferredContactTiming: rawTiming || undefined,
            status: 'ACTIVE',
            isActive: true,
            isDoNotContact: isDncRestricted,
            currentStage: 'FOLLOW_UP',
            assignedTo: assignedToId ? new Types.ObjectId(assignedToId) : null,
            unassignedReason: isAssigned ? undefined : (unassignedReason || 'Assignment pending manual review'),
            managerId: actor.role === 'MANAGER' ? new Types.ObjectId(actor.id) : undefined,
            createdById: new Types.ObjectId(actor.id),
            createdByName: actor.name,
            importId: importDoc.importId,
            importRowNumber: rowNumber
          });

          await enquiry.save();
          importedCount++;
          processedCount++;
          row._processed = true;
          row._status = 'IMPORTED';
          row._enquiryId = enquiry._id;
          fileSeenEnquiryMap.set(normMobile, enquiry);
          if (normEmail) fileSeenEnquiryMap.set(normEmail, enquiry);

          if (isAssigned && assignedToId) {
            assignedCount++;

            // Initial follow-up task generation on write-path (suppressed if DNC active)
            if (!isDncRestricted) {
              try {
                const initialTask = new FollowUpTask({
                  enquiryId: enquiry._id,
                  assignedTo: new Types.ObjectId(assignedToId),
                  purpose: validMethod === 'EMAIL' ? 'EMAIL' : validMethod === 'WHATSAPP' ? 'WHATSAPP' : 'CALL',
                  followUpDate: new Date(),
                  followUpTime: rawTiming || '10:00 AM',
                  notes: 'System initialized pending follow-up task (Bulk Upload)',
                  status: 'PENDING',
                  isInitialTask: true
                });
                await initialTask.save().catch((tErr: any) => {
                  if (!isInitialTaskDuplicateKeyError(tErr)) {
                    console.warn('[BulkImportService] Initial task creation notice:', tErr?.message);
                  }
                });
              } catch (tErr: any) {
                if (!isInitialTaskDuplicateKeyError(tErr)) {
                  console.warn('[BulkImportService] Initial task catch:', tErr?.message);
                }
              }
            }

            // Lead Assignment In-App Notification (strictly to Sales Agent)
            try {
              const assignedUser = await User.findById(assignedToId).select('name role isActive');
              if (assignedUser && assignedUser.role === 'SALES' && assignedUser.isActive) {
                const notifMetadata = buildLeadAssignmentMetadata({
                  enquiry,
                  input: {
                    name: rawName,
                    mobile: rawMobile,
                    email: rawEmail,
                    projectName: rawProject,
                    requirement: rawReq,
                    budgetMin,
                    budgetMax,
                    source: rawSource || 'Bulk Upload',
                    preferredContactMethod: validMethod,
                    preferredContactTiming: rawTiming
                  },
                  assignedBy: { id: actor.id, name: actor.name, role: actor.role },
                  assignedTo: { id: assignedUser._id.toString(), name: assignedUser.name, role: assignedUser.role },
                  assignmentType: isRoundRobinAssignment ? 'ROUND_ROBIN' : 'INITIAL_ASSIGNMENT',
                  previousAssigneeName: null
                });

                await notificationService.createNotification({
                  recipient: assignedToId,
                  sender: actor.id,
                  senderName: actor.name,
                  type: 'NEW_LEAD_ASSIGNED',
                  title: `New Lead Assigned: ${rawName}`,
                  message: `A new enquiry for "${rawName}" has been assigned to you.`,
                  relatedEnquiryId: enquiry._id,
                  relatedCustomerName: rawName,
                  relatedStage: 'FOLLOW_UP',
                  link: `/sales/leads/${enquiry._id}/workflow`,
                  idempotencyKey: `lead_assigned_${enquiry._id}_${assignedToId}_bulk`,
                  metadata: notifMetadata
                });
              }
            } catch (nErr) {
              // Notification errors do not fail the import
            }

            // Audit activity for assignment
            try {
              const assignedUser = await User.findById(assignedToId).select('name');
              const act = new EnquiryActivity({
                enquiryId: enquiry._id,
                performedBy: new Types.ObjectId(actor.id),
                performedByName: actor.name,
                type: 'ASSIGNMENT_CHANGED',
                note: `Enquiry assigned to ${assignedUser?.name || 'Sales Agent'} via ${isRoundRobinAssignment ? 'Round Robin' : 'Bulk Upload Assignment'}`,
                metadata: {
                  newAssigneeId: assignedToId,
                  newAssigneeName: assignedUser?.name || 'Sales Agent',
                  assignmentMethod: isRoundRobinAssignment ? 'ROUND_ROBIN' : 'MANUAL'
                }
              });
              await act.save();
            } catch (actErr) {}
          } else {
            unassignedCount++;
          }
        } catch (rowErr: any) {
          processedCount++;
          const isDuplicateKey =
            rowErr.code === 11000 ||
            rowErr.codeName === 'DuplicateKey' ||
            (rowErr.name === 'MongoServerError' && rowErr.code === 11000);

          if (isDuplicateKey) {
            duplicateCount++;
            row._processed = true;
            row._status = 'DUPLICATE';
            const isEmail = rowErr.message?.includes('normalizedEmail') || rowErr.keyPattern?.normalizedEmail;
            rowErrors.push({
              rowNumber,
              customerIdentifier: `${rawName} (${rawMobile})`,
              field: isEmail ? 'email' : 'mobile',
              category: 'DUPLICATE',
              reason: isEmail
                ? `Duplicate: Email "${normEmail || rawEmail}" concurrently exists in CRM (unique constraint).`
                : `Duplicate: Mobile "${normMobile}" concurrently exists in CRM (unique constraint).`
            });
          } else {
            failedCount++;
            row._processed = true;
            row._status = 'FAILED';
            rowErrors.push({
              rowNumber,
              customerIdentifier: `${rawName} (${rawMobile})`,
              category: 'FAILED',
              reason: `System write failure: ${rowErr.message || 'Unknown database error'}`
            });
          }
        }
      }

      // Persist progress and updated stagedRows after each batch completes
      await BulkImport.findByIdAndUpdate(docId, {
        processedRows: processedCount,
        importedCount,
        duplicateCount,
        invalidCount,
        failedCount,
        assignedCount,
        unassignedCount,
        rowErrors,
        stagedRows
      });
    }

    // Mark import completed
    const completedDate = new Date();
    await BulkImport.findByIdAndUpdate(docId, {
      status: 'COMPLETED',
      completedAt: completedDate,
      processedRows: processedCount,
      importedCount,
      duplicateCount,
      invalidCount,
      failedCount,
      assignedCount,
      unassignedCount,
      rowErrors,
      stagedRows: undefined // Clear staged rows to conserve database storage
    });

    // Dispatch role-based summary notifications to eligible Admins/Managers
    importDoc.status = 'COMPLETED';
    importDoc.completedAt = completedDate;
    await this.dispatchSummaryNotifications(importDoc, {
      processedCount,
      importedCount,
      duplicateCount,
      invalidCount,
      failedCount,
      assignedCount,
      unassignedCount
    });
  }

  /**
   * Dispatches role-based bulk upload summary notifications:
   * - SALES uploader: All active ADMINs + uploader's responsible active MANAGER.
   * - MANAGER uploader: All active ADMINs + uploading MANAGER.
   * - ADMIN uploader: Uploading ADMIN only.
   * Uses deterministic idempotency keys and error isolation.
   */
  async dispatchSummaryNotifications(
    importDoc: IBulkImport,
    counts: {
      processedCount: number;
      importedCount: number;
      duplicateCount: number;
      invalidCount: number;
      failedCount: number;
      assignedCount: number;
      unassignedCount: number;
    }
  ): Promise<void> {
    try {
      // Do not send success summary for completely failed or non-completed imports
      if ((importDoc.status as string) !== 'COMPLETED') {
        return;
      }

      const uploaderId = (importDoc.uploadedBy?._id || importDoc.uploadedBy)?.toString();
      if (!uploaderId) return;

      const uploader = await User.findById(uploaderId).select('_id name role managerId isActive');
      if (!uploader) return;

      const recipientIds: string[] = [];

      if (uploader.role === 'ADMIN') {
        // Case C: Admin performs bulk upload -> Exactly one summary notification only to the uploading Admin
        // Do NOT notify other Admins, Managers, or Sales Agents
        if (uploader.isActive !== false) {
          recipientIds.push(uploader._id.toString());
        }
      } else if (uploader.role === 'MANAGER') {
        // Case B: Manager performs bulk upload -> All active Admins + uploading Manager
        // Do NOT notify other Managers or Sales Agents
        const activeAdmins = await User.find({ role: 'ADMIN', isActive: true }).select('_id');
        for (const admin of activeAdmins) {
          if (admin?._id) {
            recipientIds.push(admin._id.toString());
          }
        }
        if (uploader.isActive !== false) {
          recipientIds.push(uploader._id.toString());
        }
      } else if (uploader.role === 'SALES') {
        // Case A: Sales Agent performs bulk upload -> All active Admins + active Manager responsible for team
        // Do NOT notify other Managers or other Sales Agents
        const activeAdmins = await User.find({ role: 'ADMIN', isActive: true }).select('_id');
        for (const admin of activeAdmins) {
          if (admin?._id) {
            recipientIds.push(admin._id.toString());
          }
        }

        if (uploader.managerId) {
          const managerIdStr = (uploader.managerId?._id || uploader.managerId).toString();
          const manager = await User.findById(managerIdStr).select('_id role isActive');
          if (manager && manager.role === 'MANAGER' && manager.isActive) {
            recipientIds.push(manager._id.toString());
          }
        }
      }

      // Deduplicate recipient IDs to guarantee strictly 1 notification per recipient
      const uniqueRecipients = Array.from(new Set(recipientIds.filter(Boolean)));
      if (uniqueRecipients.length === 0) return;

      const title = 'Bulk Upload Completed';
      const filenameOrId = importDoc.originalFilename || importDoc.importId;
      const uploaderName = uploader.name || importDoc.uploadedByName || 'Uploader';
      const uploaderRole = uploader.role || importDoc.userRole || 'USER';
      const message = `Bulk upload "${filenameOrId}" completed by ${uploaderName} (${uploaderRole}). Processed: ${counts.processedCount}, Imported: ${counts.importedCount}, Duplicates: ${counts.duplicateCount}, Failed: ${counts.invalidCount + counts.failedCount}.`;

      const completedAt = importDoc.completedAt ? new Date(importDoc.completedAt).toISOString() : new Date().toISOString();

      await Promise.allSettled(
        uniqueRecipients.map(async (recipientId) => {
          try {
            await notificationService.createNotification({
              recipient: recipientId,
              sender: uploader._id ? uploader._id.toString() : uploaderId,
              senderName: uploaderName,
              type: 'SYSTEM_ALERT',
              title,
              message,
              link: '/bulk-upload',
              idempotencyKey: `bulk_upload_summary_${importDoc.importId}_${recipientId}`,
              metadata: {
                importId: importDoc.importId,
                uploaderId: uploader._id ? uploader._id.toString() : uploaderId,
                uploaderName,
                uploaderRole,
                filename: filenameOrId,
                totalRows: importDoc.totalRows,
                processedRows: counts.processedCount,
                importedCount: counts.importedCount,
                duplicateCount: counts.duplicateCount,
                invalidCount: counts.invalidCount,
                failedCount: counts.failedCount,
                assignedCount: counts.assignedCount,
                unassignedCount: counts.unassignedCount,
                completedAt
              }
            });
          } catch (itemErr: any) {
            console.error(
              `[BulkImportService] Failed to dispatch summary notification for import ${importDoc.importId} to recipient ${recipientId}:`,
              itemErr?.message || itemErr
            );
          }
        })
      );
    } catch (err: any) {
      console.error(
        `[BulkImportService] Unexpected error dispatching summary notifications for import ${importDoc.importId}:`,
        err?.message || err
      );
    }
  }

  /**
   * Retrieves persistent import status and progress.
   */
  async getImportStatus(importId: string, actor: AuthUser): Promise<IBulkImport> {
    const importDoc = await BulkImport.findOne({ importId });
    if (!importDoc) {
      throw new Error(`Import session "${importId}" not found.`);
    }

    const uploaderIdStr = (importDoc.uploadedBy?._id || importDoc.uploadedBy)?.toString() || '';
    if (uploaderIdStr && uploaderIdStr !== actor.id && actor.role !== 'ADMIN') {
      throw new Error('Access denied: You cannot view an import initiated by another user.');
    }

    return importDoc;
  }

  /**
   * Generates safe CSV download report for failed, invalid, or duplicate rows.
   */
  async generateReportCsv(
    importId: string,
    category: 'DUPLICATE' | 'INVALID' | 'FAILED' | 'ALL',
    actor: AuthUser
  ): Promise<string> {
    const importDoc = await this.getImportStatus(importId, actor);
    let errors = importDoc.rowErrors || [];

    if (category !== 'ALL') {
      errors = errors.filter((e) => e.category === category);
    }

    const headers = ['Row Number', 'Customer / Identifier', 'Category', 'Reason', 'Field', 'Details'];
    const lines = [headers.join(',')];

    for (const err of errors) {
      const line = [
        this.escapeCsvCell(err.rowNumber),
        this.escapeCsvCell(err.customerIdentifier || 'N/A'),
        this.escapeCsvCell(err.category),
        this.escapeCsvCell(err.reason),
        this.escapeCsvCell(err.field || ''),
        this.escapeCsvCell(err.details || '')
      ];
      lines.push(line.join(','));
    }

    return lines.join('\r\n');
  }

  /**
   * Cancels a queued or in-progress import job.
   */
  async cancelImport(importId: string, actor: AuthUser): Promise<IBulkImport> {
    const importDoc = await this.getImportStatus(importId, actor);
    if (importDoc.status === 'COMPLETED' || importDoc.status === 'FAILED') {
      throw new Error(`Cannot cancel import in "${importDoc.status}" state.`);
    }

    importDoc.cancelRequested = true;
    if (importDoc.status === 'QUEUED' || importDoc.status === 'PENDING_CONFIRMATION') {
      importDoc.status = 'CANCELLED';
      importDoc.completedAt = new Date();
    }
    await importDoc.save();
    return importDoc;
  }

  /**
   * Lists historical imports for the current user (or all imports for Admin).
   */
  async listImports(actor: AuthUser): Promise<IBulkImport[]> {
    const query: Record<string, any> = {};
    if (actor.role !== 'ADMIN') {
      query.uploadedBy = new Types.ObjectId(actor.id);
    }
    return BulkImport.find(query)
      .select('-stagedRows')
      .sort({ createdAt: -1 })
      .limit(50);
  }
  /**
   * Safe recovery after server restart.
   * Finds any bulk imports in PROCESSING or QUEUED state and resumes execution sequentially.
   */
  async recoverInterruptedImports(): Promise<number> {
    const interruptedDocs = await BulkImport.find({
      status: { $in: ['PROCESSING', 'QUEUED'] }
    }).sort({ createdAt: 1 });

    if (interruptedDocs.length === 0) return 0;

    console.log(`[BulkImportService] Found ${interruptedDocs.length} interrupted import(s) to recover.`);

    for (const doc of interruptedDocs) {
      try {
        console.log(`[BulkImportService] Resuming interrupted import: ${doc.importId} (${doc.status})`);
        setImmediate(() => {
          this.processImportSequentially(doc._id.toString()).catch((err) => {
            console.error(`[BulkImportService] Recovery failed for import ${doc.importId}:`, err);
          });
        });
      } catch (recErr) {
        console.error(`[BulkImportService] Failed to trigger recovery for ${doc.importId}:`, recErr);
      }
    }

    return interruptedDocs.length;
  }
}

export const bulkImportService = new BulkImportService();
