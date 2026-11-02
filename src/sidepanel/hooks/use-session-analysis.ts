import { useEffect, useMemo, useState } from 'react';
import { requestAnalysis } from '../../messaging/client';
import { buildIncidentReport } from '../../core/reporting/incidents';
import type { SessionAnalysis } from '../../types/incident';
import { ScopeMessageError } from '../../messaging/request';

export function useSessionAnalysis(sessionId: string, endedAt: number | null) {
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<{
    sessionId: string;
    endedAt: number | null;
    version: number;
    analysis?: SessionAnalysis;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    void requestAnalysis(sessionId)
      .then((analysis) => {
        if (!disposed) setState({ sessionId, endedAt, version, analysis });
      })
      .catch((error: unknown) => {
        console.error('[Scope] Session analysis failed.', error);
        if (!disposed)
          setState({
            sessionId,
            endedAt,
            version,
            error:
              error instanceof ScopeMessageError
                ? error.message
                : 'Could not analyze this session. Try Analyze session again.',
          });
      });
    return () => {
      disposed = true;
    };
  }, [sessionId, endedAt, version]);
  const current =
    state?.sessionId === sessionId &&
    state.endedAt === endedAt &&
    state.version === version
      ? state
      : null;
  const analysis = current?.analysis ?? null;
  const selected =
    analysis?.incidents.find((incident) => incident.id === selectedId) ??
    analysis?.incidents.at(-1) ??
    null;
  const report = useMemo(
    () => (analysis && selected ? buildIncidentReport(analysis, selected) : ''),
    [analysis, selected],
  );
  return {
    analysis,
    selected,
    report,
    error: current?.error,
    pending: current === null,
    refresh: () => setVersion((value) => value + 1),
    select: setSelectedId,
  };
}
