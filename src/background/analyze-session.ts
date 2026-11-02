import { eventsRepository } from '../storage/repositories/events';
import { correlateIncidents } from '../core/correlation/incidents';
import { sessionAnalysisSchema, type SessionAnalysis } from '../types/incident';

export async function analyzeSession(
  sessionId: string,
): Promise<SessionAnalysis> {
  const { session, events } = await eventsRepository.analysisInput(sessionId);
  return sessionAnalysisSchema.parse({
    session,
    eventCount: events.length,
    incidents: correlateIncidents(events),
  });
}
