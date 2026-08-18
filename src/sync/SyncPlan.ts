import { SyncPlan, SyncAction, SyncActionType } from '../types';

export function createSyncPlan(): SyncPlan {
  return {
    actions: [],
    hasConflicts: false,
  };
}

export function addAction(
  plan: SyncPlan,
  type: SyncActionType,
  localPath: string,
  localFile?: any,
  driveFile?: any
): void {
  const action: SyncAction = {
    type,
    localPath,
    localFile,
    driveFile,
    resolved: type !== 'conflict',
    resolution: undefined,
  };
  plan.actions.push(action);
  if (type === 'conflict') {
    plan.hasConflicts = true;
  }
}

export function resolveAction(
  action: SyncAction,
  resolution: 'local' | 'drive' | 'both'
): void {
  action.resolved = true;
  action.resolution = resolution;
}

export function getActionsByType(plan: SyncPlan, type: SyncActionType): SyncAction[] {
  return plan.actions.filter(a => a.type === type);
}

export function getUnresolvedActions(plan: SyncPlan): SyncAction[] {
  return plan.actions.filter(a => !a.resolved);
}