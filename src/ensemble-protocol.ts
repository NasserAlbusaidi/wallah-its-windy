import type {
  EnsembleResult,
  EnvironmentPerturbation,
  StormRun,
} from './ensemble';
import type {
  EnvSamplingMode,
  SpawnParams,
} from './types';

interface WorkerBaseRequest {
  requestId: number;
  envUrl: string;
  terrainUrl: string;
  steeringUrl?: string;
  oceanUrl?: string;
  spawn: SpawnParams;
  samplingMode: EnvSamplingMode;
}

export interface EnsembleWorkerRequest extends WorkerBaseRequest {
  type: 'ensemble';
  count: number;
}

export interface SensitivityWorkerRequest extends WorkerBaseRequest {
  type: 'sensitivity';
  perturbation: EnvironmentPerturbation;
  organizationDelta: number;
}

/**
 * Cooperative cancellation: the worker checks the cancelled set between
 * members (it yields a macrotask so this message can deliver mid-run) and
 * abandons the remaining computation. Applies to ensemble runs only.
 */
export interface CancelWorkerRequest {
  type: 'cancel';
  requestId: number;
}

export type AnalysisWorkerRequest =
  | EnsembleWorkerRequest
  | SensitivityWorkerRequest
  | CancelWorkerRequest;

export interface SensitivityResult {
  baseline: StormRun;
  perturbed: StormRun;
}

export type AnalysisWorkerResponse =
  | {
      type: 'progress';
      requestId: number;
      completed: number;
      total: number;
    }
  | {
      type: 'ensemble-result';
      requestId: number;
      result: EnsembleResult;
    }
  | {
      type: 'sensitivity-result';
      requestId: number;
      result: SensitivityResult;
    }
  | {
      type: 'cancelled';
      requestId: number;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
    };
