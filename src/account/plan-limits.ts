import { Plan } from '@prisma/client';

export interface PlanLimit {
  memories: number;
  apiCallsPerDay: number;
  agents: number;
  usersPerAgent: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimit> = {
  FREE: { memories: 1000, apiCallsPerDay: 100, agents: 1, usersPerAgent: 1 },
  STARTER: {
    memories: 10000,
    apiCallsPerDay: 1000,
    agents: 3,
    usersPerAgent: 10,
  },
  PRO: {
    memories: 100000,
    apiCallsPerDay: 10000,
    agents: 10,
    usersPerAgent: 100,
  },
  SCALE: {
    memories: 1000000,
    apiCallsPerDay: 100000,
    agents: -1,
    usersPerAgent: -1,
  },
};
