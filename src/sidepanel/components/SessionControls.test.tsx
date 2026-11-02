import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { requestSession, requestAnalysis } from '../../messaging/client';
import { activeSession } from '../../test/session-fixture';
import { SessionControls } from './SessionControls';

vi.mock('../../messaging/client', () => ({
  requestSession: vi.fn(),
  requestEvents: vi.fn().mockResolvedValue({ count: 0, events: [] }),
  requestAnalysis: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(requestSession).mockReset();
  vi.mocked(requestAnalysis).mockResolvedValue({
    session: activeSession,
    eventCount: 0,
    incidents: [],
  });
});

it('requests record-and-reload explicitly and disables it during an active recording', async () => {
  vi.mocked(requestSession)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(activeSession);
  await act(async () => {
    render(<SessionControls />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Record and reload' }));
  });
  expect(requestSession).toHaveBeenLastCalledWith({
    type: 'scope/record-and-reload',
  });
  expect(
    screen.getByRole('button', { name: 'Record and reload' }),
  ).toBeDisabled();
});

it('starts, displays, and stops a session through application messaging', async () => {
  vi.mocked(requestSession)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(activeSession)
    .mockResolvedValueOnce({
      ...activeSession,
      status: 'stopped',
      endedAt: 6000,
      endReason: 'user',
    });
  await act(async () => {
    render(<SessionControls />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  });
  expect(
    screen.getByRole('status', { name: 'Session status' }),
  ).toHaveTextContent('Session active');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }));
  });
  expect(requestSession).toHaveBeenLastCalledWith({
    type: 'scope/stop-session',
    sessionId: activeSession.id,
  });
  expect(screen.getByLabelText('Session duration')).toHaveTextContent(
    '00:00:05',
  );
});

it('restores an existing session when the panel mounts', async () => {
  vi.mocked(requestSession).mockResolvedValue(activeSession);
  await act(async () => {
    render(<SessionControls />);
  });
  expect(screen.getByRole('button', { name: 'Stop session' })).toBeEnabled();
  expect(requestSession).toHaveBeenCalledWith({ type: 'scope/get-session' });
});

it('shows a persistence failure and offers refresh without pretending the session started', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(requestSession)
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('Storage unavailable'));
  await act(async () => {
    render(<SessionControls />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Storage unavailable');
  expect(
    screen.getByRole('status', { name: 'Session status' }),
  ).toHaveTextContent('No session started');
  expect(screen.getByRole('button', { name: 'Refresh session' })).toBeEnabled();
});
