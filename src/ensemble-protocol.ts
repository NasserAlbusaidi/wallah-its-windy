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

export type AnalysisWorkerRequest =
  | EnsembleWorkerRequest
  | SensitivityWorkerRequest;

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
      type: 'error';
      requestId: number;
      message: string;
    };
