import type { CapturedNetworkEvent } from '../types/network';

export type RequestMetadata = Extract<
  CapturedNetworkEvent,
  { type: 'request' }
>['data'];
export interface NetworkTicket {
  data: RequestMetadata;
  started: number;
  finished: boolean;
  cancel?: () => void;
}
export interface NetworkObserver {
  begin(metadata: Omit<RequestMetadata, 'requestId'>): NetworkTicket | null;
  complete(
    ticket: NetworkTicket,
    outcome: 'response' | 'network-error' | 'aborted' | 'timeout',
    status: number | null,
  ): void;
}
