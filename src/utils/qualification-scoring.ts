/**
 * Lead Qualification Scoring System - Neuways CRM
 *
 * The qualification engine calculates prospective buyer readiness across four
 * foundational BANT-aligned dimensions totaling 100 points:
 *
 * 1. Budget Readiness (Weight: 30% / 30 pts):
 *    - VERIFIED_BUDGET: 30 pts (Cash ready / fully confirmed funds)
 *    - LOAN_PRE_APPROVED: 25 pts (Bank loan pre-sanctioned)
 *    - STRETCH_BUDGET: 15 pts (Requires financial assistance / loan processing)
 *    - UNCONFIRMED: 0 pts (Budget not verified)
 *
 * 2. Purchase Timeline (Weight: 30% / 30 pts):
 *    - IMMEDIATE: 30 pts (Within 30 days)
 *    - WITHIN_30_DAYS: 25 pts (30 - 60 days)
 *    - WITHIN_90_DAYS: 15 pts (1 - 3 months)
 *    - ABOVE_90_DAYS: 5 pts (> 3 months)
 *
 * 3. Authority / Decision Maker (Weight: 20% / 20 pts):
 *    - SOLE_DECISION_MAKER: 20 pts (Direct individual buyer)
 *    - JOINT_DECISION_MAKER: 15 pts (Consults spouse/family)
 *    - INFLUENCER_ONLY: 5 pts (Searching on behalf of someone else)
 *
 * 4. Requirement Clarity (Weight: 20% / 20 pts):
 *    - SPECIFIC_UNIT_TYPE: 20 pts (Exact floorplan, size, and project shortlisted)
 *    - GENERAL_REQUIREMENT: 10 pts (General category/size known, open to options)
 *    - EXPLORATORY: 5 pts (Browsing market / exploratory phase)
 *
 * Matrix Distribution Buckets:
 * Total Score (0 - 100) maps directly to the 6 matrix columns:
 * - 90 - 100 => 100%
 * - 75 - 89  => 80%
 * - 60 - 74  => 70%
 * - 40 - 59  => 50%
 * - 25 - 39  => 20%
 * - 0  - 24  => 10%
 *
 * Priority Determination:
 * - HOT: High intent and urgency (score >= 60, or timeline is IMMEDIATE/WITHIN_30_DAYS, or explicit agent selection)
 * - POSSIBLE: Moderate intent / exploring pipeline
 */

export type BudgetStatus =
  | 'VERIFIED_BUDGET'
  | 'LOAN_PRE_APPROVED'
  | 'STRETCH_BUDGET'
  | 'UNCONFIRMED';

export type PurchaseTimeline =
  | 'IMMEDIATE'
  | 'WITHIN_30_DAYS'
  | 'WITHIN_90_DAYS'
  | 'ABOVE_90_DAYS';

export type DecisionMaker =
  | 'SOLE_DECISION_MAKER'
  | 'JOINT_DECISION_MAKER'
  | 'INFLUENCER_ONLY';

export type RequirementClarity =
  | 'SPECIFIC_UNIT_TYPE'
  | 'GENERAL_REQUIREMENT'
  | 'EXPLORATORY';

export type LeadPriority = 'HOT' | 'POSSIBLE';

export type ReadinessPercentage = '10%' | '20%' | '50%' | '70%' | '80%' | '100%';

export interface QualificationCriteriaInput {
  budgetStatus?: BudgetStatus;
  timeline?: PurchaseTimeline;
  decisionMaker?: DecisionMaker;
  needClarity?: RequirementClarity;
  priority?: LeadPriority;
  readinessScore?: number;
  scoreLabel?: ReadinessPercentage;
  notes?: string;
}

export interface ComputedQualification {
  budgetStatus: BudgetStatus;
  timeline: PurchaseTimeline;
  decisionMaker: DecisionMaker;
  needClarity: RequirementClarity;
  priority: LeadPriority;
  readinessScore: number;
  scoreLabel: ReadinessPercentage;
  calculatedScore: number;
  dimensionBreakdown: {
    budgetPoints: number;
    timelinePoints: number;
    authorityPoints: number;
    needPoints: number;
  };
  notes?: string;
  isQualified: boolean;
}

export function computeLeadQualification(
  input?: QualificationCriteriaInput
): ComputedQualification {
  const safeInput = input || {};

  // 1. Budget Points (Max 30)
  let budgetPoints = 0;
  switch (safeInput.budgetStatus) {
    case 'VERIFIED_BUDGET':
      budgetPoints = 30;
      break;
    case 'LOAN_PRE_APPROVED':
      budgetPoints = 25;
      break;
    case 'STRETCH_BUDGET':
      budgetPoints = 15;
      break;
    case 'UNCONFIRMED':
    default:
      budgetPoints = 0;
      break;
  }

  // 2. Timeline Points (Max 30)
  let timelinePoints = 5;
  switch (safeInput.timeline) {
    case 'IMMEDIATE':
      timelinePoints = 30;
      break;
    case 'WITHIN_30_DAYS':
      timelinePoints = 25;
      break;
    case 'WITHIN_90_DAYS':
      timelinePoints = 15;
      break;
    case 'ABOVE_90_DAYS':
    default:
      timelinePoints = 5;
      break;
  }

  // 3. Decision Maker Points (Max 20)
  let authorityPoints = 5;
  switch (safeInput.decisionMaker) {
    case 'SOLE_DECISION_MAKER':
      authorityPoints = 20;
      break;
    case 'JOINT_DECISION_MAKER':
      authorityPoints = 15;
      break;
    case 'INFLUENCER_ONLY':
    default:
      authorityPoints = 5;
      break;
  }

  // 4. Need Clarity Points (Max 20)
  let needPoints = 5;
  switch (safeInput.needClarity) {
    case 'SPECIFIC_UNIT_TYPE':
      needPoints = 20;
      break;
    case 'GENERAL_REQUIREMENT':
      needPoints = 10;
      break;
    case 'EXPLORATORY':
    default:
      needPoints = 5;
      break;
  }

  const rawScore = budgetPoints + timelinePoints + authorityPoints + needPoints;

  // Map raw 0-100 score to 6 percentage buckets
  let mappedPercentage: ReadinessPercentage = '10%';
  let mappedScoreNum = 10;
  if (rawScore >= 90) {
    mappedPercentage = '100%';
    mappedScoreNum = 100;
  } else if (rawScore >= 75) {
    mappedPercentage = '80%';
    mappedScoreNum = 80;
  } else if (rawScore >= 60) {
    mappedPercentage = '70%';
    mappedScoreNum = 70;
  } else if (rawScore >= 40) {
    mappedPercentage = '50%';
    mappedScoreNum = 50;
  } else if (rawScore >= 25) {
    mappedPercentage = '20%';
    mappedScoreNum = 20;
  } else {
    mappedPercentage = '10%';
    mappedScoreNum = 10;
  }

  // Respect explicitly provided readiness percentage / score if valid, else use computed
  const validLabels: ReadinessPercentage[] = ['10%', '20%', '50%', '70%', '80%', '100%'];
  const finalScoreLabel =
    safeInput.scoreLabel && validLabels.includes(safeInput.scoreLabel)
      ? safeInput.scoreLabel
      : mappedPercentage;

  const validScoreNums = [10, 20, 50, 70, 80, 100];
  const finalReadinessScore =
    typeof safeInput.readinessScore === 'number' && validScoreNums.includes(safeInput.readinessScore)
      ? safeInput.readinessScore
      : mappedScoreNum;

  // Priority: if explicitly specified, respect it.
  // Otherwise, default to HOT if rawScore >= 60 or timeline is IMMEDIATE/WITHIN_30_DAYS; else POSSIBLE.
  let finalPriority: LeadPriority = 'POSSIBLE';
  if (safeInput.priority === 'HOT' || safeInput.priority === 'POSSIBLE') {
    finalPriority = safeInput.priority;
  } else if (rawScore >= 60 || safeInput.timeline === 'IMMEDIATE' || safeInput.timeline === 'WITHIN_30_DAYS') {
    finalPriority = 'HOT';
  }

  return {
    budgetStatus: safeInput.budgetStatus || 'UNCONFIRMED',
    timeline: safeInput.timeline || 'ABOVE_90_DAYS',
    decisionMaker: safeInput.decisionMaker || 'INFLUENCER_ONLY',
    needClarity: safeInput.needClarity || 'EXPLORATORY',
    priority: finalPriority,
    readinessScore: finalReadinessScore,
    scoreLabel: finalScoreLabel,
    calculatedScore: rawScore,
    dimensionBreakdown: {
      budgetPoints,
      timelinePoints,
      authorityPoints,
      needPoints
    },
    notes: safeInput.notes ? safeInput.notes.trim() : undefined,
    isQualified: true
  };
}
