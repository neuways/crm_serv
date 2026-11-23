import {
  IEnquiry,
  PreferredContactMethod,
  BudgetStatus,
  PurchaseTimeline,
  DecisionMaker,
  RequirementClarity,
  LeadPriority,
  ReadinessPercentage,
  ILeadQualification,
  RejectionReason,
  IRejectionDetails,
  PREDEFINED_REJECTION_REASONS,
  ClosureType,
  REJECTED_REASONS,
  RejectedReason,
  DEAL_LOST_REASONS,
  DealLostReason,
  ALL_CLOSURE_REASONS,
  IMeetingPlan,
  ISiteVisitPlan,
  ICancellationHistoryItem
} from '../models/enquiry.model.js';

export {
  ClosureType,
  REJECTED_REASONS,
  RejectedReason,
  DEAL_LOST_REASONS,
  DealLostReason,
  ALL_CLOSURE_REASONS,
  IMeetingPlan,
  ISiteVisitPlan,
  ICancellationHistoryItem
};
import { IEnquiryActivity } from '../models/enquiry-activity.model.js';
import { TaskStatus } from '../models/follow-up-task.model.js';
import { QualificationCriteriaInput } from '../utils/qualification-scoring.js';

export interface CreateEnquiryInput {
  name: string;
  mobile: string;
  email?: string;
  projectName?: string;
  preferredLocation?: string;
  requirement?: string;
  budgetMin?: number;
  budgetMax?: number;
  description?: string;
  source?: string;
  preferredContactMethod?: PreferredContactMethod;
  preferredContactTiming?: string;
  assignedToId?: string | null;
  assignmentMethod?: 'ROUND_ROBIN' | 'MANUAL';
  allowReEnquiry?: boolean;
  previousEnquiryId?: string;
  isBulkUpload?: boolean;
}

export interface PreviousEnquirySummary {
  id: string;
  customerName: string;
  mobile: string;
  email?: string;
  previousProject?: string;
  previousAssignedAgent?: string;
  previousManager?: string;
  previousStatus: 'Deal Done' | 'Rejected';
  previousBudget?: string;
  previousEnquiryDate?: Date | string;
  previousRemarks?: string;
}

export interface DuplicateRecordItem {
  id: string;
  createdAt: Date | string;
  matchReason: 'MOBILE' | 'EMAIL' | 'BOTH';
  performedByName: string;
  performedById?: string | null;
  reviewStatus?: 'PENDING_REVIEW' | 'REVIEWED' | 'REOPENED' | 'DISMISSED';
  duplicateReference?: string;
  importId?: string;
  importRowNumber?: number;
  attemptedLead: {
    name: string;
    mobile: string;
    email?: string;
    projectName?: string;
    source?: string;
  };
  previousEnquiry: {
    id: string;
    name: string;
    mobile: string;
    email?: string;
    projectName?: string;
    status: 'ACTIVE' | 'CLOSED';
    currentStage?: string;
    isDealDone: boolean;
    isRejected: boolean;
    rejectionReason?: string;
    assignedTo?: {
      id: string;
      name: string;
      role: string;
    } | null;
    createdAt: Date | string;
    remarks?: string;
  };
}

export interface GetDuplicateRecordsResult {
  duplicateRecords: DuplicateRecordItem[];
  totalCount: number;
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export type DuplicateType =
  | 'MOBILE_MATCH'
  | 'EMAIL_MATCH'
  | 'BOTH_FIELDS_MATCH'
  | 'CROSS_FIELD_MATCH'
  | 'CONCURRENT_COLLISION';

export interface DuplicateMatches {
  mobileMatch?: IEnquiry | MatchedEnquirySummary;
  emailMatch?: IEnquiry | MatchedEnquirySummary;
}

export interface MatchedEnquirySummary {
  id: string;
  name: string;
  status: 'ACTIVE' | 'CLOSED';
  assignedTo?: {
    id: string;
    name: string;
    role: string;
  } | null;
  createdAt: Date;
  matchReason: 'MOBILE' | 'EMAIL' | 'BOTH';
}

export interface DuplicateEnquiryResult {
  success: false;
  isDuplicate: true;
  duplicateType: DuplicateType;
  message: string;
  matches: DuplicateMatches;
  matchedEnquiries: Array<IEnquiry | MatchedEnquirySummary>;
  isRedFlag?: boolean;
  hasActiveLead?: boolean;
  previousEnquiry?: PreviousEnquirySummary;
}

export interface SuccessEnquiryResult {
  success: true;
  isDuplicate: false;
  enquiry: IEnquiry;
  isReEnquiry?: boolean;
}

export type CreateEnquiryResult = SuccessEnquiryResult | DuplicateEnquiryResult;

export interface AssignEnquiryInput {
  enquiryId: string;
  assignedToId: string;
}

export interface AssignEnquirySuccessResult {
  success: true;
  enquiry: IEnquiry;
}

export interface AssignEnquiryErrorResult {
  success: false;
  statusCode: 400 | 403 | 404 | 500;
  message: string;
}

export type AssignEnquiryResult = AssignEnquirySuccessResult | AssignEnquiryErrorResult;

export interface AddRemarkInput {
  remark: string;
  confirmContactDetails?: boolean;
}

export interface AddRemarkSuccessResult {
  success: true;
  activity: IEnquiryActivity;
}

export interface AddRemarkWarningResult {
  success: false;
  requiresConfirmation: true;
  statusCode: 400;
  message: string;
  detectedTypes: ('MOBILE' | 'EMAIL')[];
}

export interface AddRemarkErrorResult {
  success: false;
  requiresConfirmation?: false;
  statusCode: 400 | 403 | 404 | 500;
  message: string;
}

export type AddRemarkResult =
  | AddRemarkSuccessResult
  | AddRemarkWarningResult
  | AddRemarkErrorResult;

export interface ChangeStatusInput {
  status: 'ACTIVE' | 'CLOSED';
  reason?: string;
}

export interface RejectEnquiryInput {
  reason: RejectionReason | string;
  remarks?: string;
  closureType?: 'REJECTED';
}

export interface RejectEnquirySuccessResult {
  success: true;
  enquiry: IEnquiry;
  activity: IEnquiryActivity;
}

export interface RejectEnquiryErrorResult {
  success: false;
  statusCode: 400 | 403 | 404 | 500;
  message: string;
}

export type RejectEnquiryResult = RejectEnquirySuccessResult | RejectEnquiryErrorResult;

export interface DealLostInput {
  reason: DealLostReason | string;
  remarks: string;
  closureType?: 'DEAL_LOST';
}

export interface DealLostSuccessResult {
  success: true;
  enquiry: IEnquiry;
  activity: IEnquiryActivity;
}

export interface DealLostErrorResult {
  success: false;
  statusCode: 400 | 403 | 404 | 500;
  message: string;
}

export type DealLostResult = DealLostSuccessResult | DealLostErrorResult;

/**
 * REQ-38: Do Not Contact (DNC) Input and Result Types
 */
export interface EnableDoNotContactInput {
  reason: string;
  remarks: string;
}

export interface RevokeDoNotContactInput {
  reason: string;
  remarks: string;
}

export interface DoNotContactSuccessResult {
  success: true;
  statusCode?: number;
  message: string;
  enquiry?: IEnquiry;
  dncDetails?: any;
  dncRecord?: any;
  cancelledTasksCount?: number;
  affectedEnquiriesCount?: number;
}

export interface DoNotContactErrorResult {
  success: false;
  statusCode: 400 | 403 | 404 | 500;
  message: string;
}

export type DoNotContactResult = DoNotContactSuccessResult | DoNotContactErrorResult;

export interface GetDoNotContactResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  isDoNotContact: boolean;
  normalizedMobile?: string;
  dncDetails?: any;
  details?: any;
}

export interface ChangeStatusSuccessResult {
  success: true;
  enquiry: IEnquiry;
  statusChanged: boolean;
  activity?: IEnquiryActivity;
}

export interface ChangeStatusErrorResult {
  success: false;
  statusCode: 400 | 403 | 404 | 500;
  message: string;
}

export type ChangeStatusResult = ChangeStatusSuccessResult | ChangeStatusErrorResult;

export interface ActivityPaginationMetadata {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

export interface ActivityHistorySuccessResult {
  success: true;
  activities: IEnquiryActivity[];
  pagination: ActivityPaginationMetadata;
}

export interface ActivityHistoryErrorResult {
  success: false;
  statusCode: 400 | 403 | 404 | 500;
  message: string;
}

export type ActivityHistoryResult = ActivityHistorySuccessResult | ActivityHistoryErrorResult;

export interface ListEnquiriesQuery {
  page?: number;
  limit?: number;
  status?: 'ACTIVE' | 'CLOSED';
  search?: string;
  completedDeals?: boolean | string;
  excludeCompletedDeals?: boolean | string;
  rejected?: boolean | string;
  dealLost?: boolean | string;
  closureType?: 'REJECTED' | 'DEAL_LOST' | 'UNKNOWN' | 'LEGACY' | string;
  unassigned?: boolean | string;
  unassignedReason?: string;
  assignedTo?: string;
}

export interface ListEnquiriesResult {
  success: boolean;
  enquiries: IEnquiry[];
  pagination: ActivityPaginationMetadata;
}

export interface ListCompletedDealsQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface ListCompletedDealsResult {
  success: boolean;
  deals: IEnquiry[];
  pagination: ActivityPaginationMetadata;
}

export interface CreateFollowUpInput {
  purpose: 'CALL' | 'WHATSAPP' | 'EMAIL' | 'MEETING' | 'SITE_VISIT' | 'OTHER';
  followUpDate: string;
  followUpTime: string;
  notes: string;
  status?: TaskStatus;
  outcome?: 'CONNECTED' | 'NO_ANSWER' | 'CALL_BACK_REQUESTED' | 'MEETING_SCHEDULED' | 'NOT_INTERESTED' | 'OTHER';
  nextFollowUpDate?: string;
  nextFollowUpTime?: string;
  leadStatus?: 'ACTIVE' | 'CLOSED';
  closingReason?: string;
}

export interface UpdateTaskStatusInput {
  status: TaskStatus;
  notes?: string;
  cancellationReason?: string;
  followUpDate?: string;
  followUpTime?: string;
  rescheduledDate?: string;
  rescheduledTime?: string;
}

export interface UpdateTaskStatusResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  task?: any;
  activity?: IEnquiryActivity;
}

export interface FollowUpStageSummary {
  stage: string;
  contacted: number | 'N/A';
  detailShared: number | 'N/A';
  meeting?: number | 'N/A';
  siteVisit?: number | 'N/A';
}

export interface ScoredLeadSummary {
  id: string;
  name: string;
  currentStage: string;
  priority: LeadPriority;
  readinessScore: number;
  scoreLabel: ReadinessPercentage;
  calculatedScore: number;
  budgetStatus?: BudgetStatus;
  timeline?: PurchaseTimeline;
  decisionMaker?: DecisionMaker;
  needClarity?: RequirementClarity;
  notes?: string;
}

export interface QualificationMatrixSummary {
  isPopulated: boolean;
  percentages: Array<'10%' | '20%' | '50%' | '70%' | '80%' | '100%'>;
  hotRow: { values: number[] };
  possRow: { values: number[] };
  totalActiveLeads?: number;
  scoredLeadsCount?: number;
  unscoredLeadsCount?: number;
  hotCount?: number;
  possCount?: number;
  scoredPercentage?: number;
  leads?: ScoredLeadSummary[];
}

export interface TaskStatusCounts {
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  rescheduled: number;
}

export interface DashboardSummaryData {
  dailyVelocity: number;
  pendingFollowUpsCount: number;
  futureFollowUpsCount: number;
  activePipelineCount: number;
  completedDealsCount?: number;
  rejectedCount?: number;
  dealLostCount?: number;
  legacyClosedCount?: number;
  activeAgentsCount?: number;
  teamMembersCount?: number;
  stageBreakdown?: {
    followUp: number;
    meetingPlan: number;
    siteVisitPlan: number;
    dealDone: number;
  };
  taskStatusCounts?: TaskStatusCounts;
  pendingStages: FollowUpStageSummary[];
  futureStages: FollowUpStageSummary[];
  qualificationMatrix: QualificationMatrixSummary;
}

export interface TeamMemberPerformance {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isTeamActive?: boolean;
  activeLeadsCount: number;
  stageWorkload: {
    followUp: number;
    meetingPlan: number;
    siteVisitPlan: number;
  };
  pendingFollowUpsCount: number;
  futureFollowUpsCount: number;
  completedDealsCount: number;
  rejectedCount: number;
  dealLostCount?: number;
  legacyClosedCount?: number;
}

export interface GetTeamPerformanceResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  team?: TeamMemberPerformance[];
}

export interface GetDashboardSummaryResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  data?: DashboardSummaryData;
}

export interface CreateFollowUpResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  followUp?: any;
  activity?: IEnquiryActivity;
  enquiry?: IEnquiry;
}

export interface GetFollowUpsResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  followUps?: any[];
}

export type WorkflowStage = 'FOLLOW_UP' | 'MEETING_PLAN' | 'SITE_VISIT_PLAN' | 'DEAL_DONE';

export interface WorkflowStepInput {
  step: WorkflowStage;
  // Step 1: Follow-up
  purpose?: 'CALL' | 'WHATSAPP' | 'EMAIL' | 'MEETING' | 'SITE_VISIT' | 'OTHER';
  outcome?: 'CONNECTED' | 'NO_ANSWER' | 'CALL_BACK_REQUESTED' | 'MEETING_SCHEDULED' | 'NOT_INTERESTED' | 'OTHER';
  followUpDate?: string;
  followUpTime?: string;
  notes?: string;
  nextFollowUpDate?: string;
  nextFollowUpTime?: string;
  enquiryUpdate?: {
    projectName?: string;
    preferredLocation?: string;
    requirement?: string;
    budgetMin?: number;
    budgetMax?: number;
    description?: string;
  };
  // Step 2: Meeting Plan
  meetingPlace?: string;
  meetingDate?: string;
  meetingTime?: string;
  projectDetails?: string;
  managerId?: string | null;
  remarks?: string;
  meetingResult?: string;
  // Step 3: Site Visit Plan
  siteVisitAddress?: string;
  siteVisitDate?: string;
  siteVisitTime?: string;
  projectName?: string;
  visitOutcome?: string;
  // Step 4: Deal Done
  project?: string;
  propertyType?: string;
  price?: number;
  size?: string;
  isConfirmed?: boolean;
  // Common
  action?: 'SAVE' | 'CANCEL' | 'RESCHEDULE';
  isCancelled?: boolean;
  cancellationReason?: string;
  isCompleted?: boolean;
  advanceStage?: boolean;
  leadStatus?: 'ACTIVE' | 'CLOSED';
  closingReason?: string;
  qualification?: QualificationCriteriaInput;
}

export interface QualifyLeadInput extends QualificationCriteriaInput {}

export interface QualifyLeadResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  enquiry?: IEnquiry;
  activity?: IEnquiryActivity;
}

export interface WorkflowStepResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  enquiry?: IEnquiry;
  activity?: IEnquiryActivity;
  followUp?: any;
}

export interface GetSingleEnquiryResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  enquiry?: IEnquiry;
}

export interface ActiveManagerSummary {
  id: string;
  name: string;
  email: string;
}

export interface GetManagersResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  managers?: ActiveManagerSummary[];
}

export type TeamMembershipStatusLabel =
  | 'Available'
  | 'Assigned to your team'
  | 'Deactivated in your team'
  | 'Assigned to another team';

export interface EligibleAgentSummary {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isTeamActive: boolean;
  managerId: string | null;
  managerName: string | null;
  canAssign: boolean;
  isAssignedToCurrentManager: boolean;
  statusLabel: TeamMembershipStatusLabel;
}

export interface GetTeamRosterResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  agents?: EligibleAgentSummary[];
}

export interface AssignTeamAgentResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  agent?: EligibleAgentSummary;
}

export interface UpdateTeamMemberStatusResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  agent?: EligibleAgentSummary;
}

export interface DeleteEnquiryResult {
  success: boolean;
  statusCode?: number;
  message: string;
}