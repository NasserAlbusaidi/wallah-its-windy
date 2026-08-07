/** Main-thread client for the cached analysis worker. */

import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  SensitivityResult,
} from './ensemble-protocol';
import type { EnsembleResult } from './ensemble';

type Result = EnsembleResult | SensitivityResult;

interface PendingRequest {
  resolve(value: Result): void;
  reject(error: Error): void;
  onProgress?: (completed: number, total: number) => void;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function acquireWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./ensemble.worker.ts', import.meta.url), {
    type: 'module',
    name: 'cyclone-analysis',
  });
  worker.addEventListener(
    'message',
    (event: MessageEvent<AnalysisWorkerResponse>) => {
      const message = event.data;
      const request = pending.get(message.requestId);
      if (!request) return;
      if (message.type === 'progress') {
        request.onProgress?.(message.completed, message.total);
        return;
      }
      pending.delete(message.requestId);
      if (message.type === 'cancelled') {
        request.reject(new EnsembleCancelledError());
      } else if (message.type === 'error') {
        request.reject(new Error(message.message));
      } else {
        request.resolve(message.result);
      }
    },
  );
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'analysis worker failed');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

function requestWorker<T extends Result>(
  request: Omit<AnalysisWorkerRequest, 'requestId'>,
  onProgress?: (completed: number, total: number) => void,
): Promise<T> {
  const requestId = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      onProgress,
    });
    acquireWorker().postMessage({ ...request, requestId });
  });
}

/** Rejection marker for a run cancelled by the caller — treat as a no-op. */
export class EnsembleCancelledError extends Error {
  constructor() {
    super('ensemble run cancelled');
    this.name = 'EnsembleCancelled';
  }
}

export interface EnsembleRunHandle {
  result: Promise<EnsembleResult>;
  /**
   * Reject the pending promise immediately with EnsembleCancelledError and
   * tell the worker to abandon the remaining members. Safe to call after
   * completion (no-op).
   */
  cancel(): void;
}

export function requestEnsemble(
  request: Omit<
    Extract<AnalysisWorkerRequest, { type: 'ensemble' }>,
    'requestId'
  >,
  onProgress?: (completed: number, total: number) => void,
): EnsembleRunHandle {
  const requestId = nextRequestId++;
  const result = new Promise<EnsembleResult>((resolve, reject) => {
    pending.set(requestId, {
      resolve: (value) => resolve(value as EnsembleResult),
      reject,
      onProgress,
    });
    acquireWorker().postMessage({ ...request, requestId });
  });
  return {
    result,
    cancel: () => {
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      entry.reject(new EnsembleCancelledError());
      // The worker checks between members; a late 'cancelled' or result
      // message for this id finds no pending entry and is ignored.
      worker?.postMessage({ type: 'cancel', requestId });
    },
  };
}

export function requestSensitivity(
  request: Omit<
    Extract<AnalysisWorkerRequest, { type: 'sensitivity' }>,
    'requestId'
  >,
): Promise<SensitivityResult> {
  return requestWorker<SensitivityResult>(request);
}
