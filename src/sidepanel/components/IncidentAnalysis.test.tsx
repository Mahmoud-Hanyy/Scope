import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { requestAnalysis } from '../../messaging/client';
import { IncidentAnalysis } from './IncidentAnalysis';
import { activeSession } from '../../test/session-fixture';
import { incidentChain } from '../../test/incident-fixture';
import { correlateIncidents } from '../../core/correlation/incidents';
import { copyReport, downloadReport } from '../report-actions';
import { ScopeMessageError } from '../../messaging/request';

vi.mock('../../messaging/client', () => ({ requestAnalysis: vi.fn() }));
vi.mock('../report-actions', () => ({
  copyReport: vi.fn(),
  downloadReport: vi.fn(),
}));

it('shows communication recovery guidance without presenting a failed analysis as zero incidents', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(requestAnalysis).mockRejectedValueOnce(
    new ScopeMessageError('no-response', 'analyze the session'),
  );
  render(<IncidentAnalysis session={activeSession} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Reload Scope in chrome://extensions',
  );
  expect(
    screen.queryByText(/No supported failures detected/),
  ).not.toBeInTheDocument();
});

it('shows evidence and exports the selected sanitized incident', async () => {
  vi.mocked(requestAnalysis).mockResolvedValue({
    session: activeSession,
    eventCount: 4,
    incidents: correlateIncidents(incidentChain),
  });
  vi.mocked(copyReport).mockResolvedValue(undefined);
  render(<IncidentAnalysis session={activeSession} />);
  expect(await screen.findByLabelText('Analysis snapshot')).toHaveTextContent(
    '1 incident(s) from 4 events',
  );
  const selected = screen.getByRole('article', { name: 'Selected incident' });
  expect(
    within(selected).getByRole('list', { name: 'Incident sequence' }).children,
  ).toHaveLength(4);
  expect(selected).toHaveTextContent('Timing does not prove causation');
  fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
  expect(
    await screen.findByRole('status', { name: 'Report action' }),
  ).toHaveTextContent('Report copied');
  expect(copyReport).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
  fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }));
  expect(downloadReport).toHaveBeenCalledWith(
    expect.stringContaining('TypeError'),
    expect.any(String),
  );
});

it('retries a failed analysis and refreshes its snapshot when the session ends', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(requestAnalysis)
    .mockRejectedValueOnce(new Error('Storage unavailable'))
    .mockResolvedValue({
      session: activeSession,
      eventCount: 0,
      incidents: [],
    });
  const { rerender } = render(<IncidentAnalysis session={activeSession} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not analyze',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Analyze session' }));
  expect(
    await screen.findByText(/No supported failures detected/),
  ).toBeInTheDocument();
  rerender(
    <IncidentAnalysis
      session={{
        ...activeSession,
        status: 'stopped',
        endedAt: 2000,
        endReason: 'user',
      }}
    />,
  );
  await screen.findByText(/No supported failures detected/);
  expect(requestAnalysis).toHaveBeenCalledTimes(3);
});
