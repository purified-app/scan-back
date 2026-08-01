export interface ScanResult {
  scanValue: string;
  format: string;
}

export type ScanPageStatus =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'permission-denied'
  | 'no-camera'
  | 'invalid-return-url'
  | 'result'
  | 'redirecting'
  | 'error';
