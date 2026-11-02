import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { requestEvents } from '../../messaging/client';
import { normalizedClick } from '../../test/interaction-fixture';
import { RecentEvents } from './RecentEvents';

vi.mock('../../messaging/client', () => ({ requestEvents: vi.fn() }));

it('shows persisted counts and readable interaction metadata', async () => {
  vi.mocked(requestEvents).mockResolvedValue({
    count: 1,
    events: [normalizedClick],
  });
  render(
    <RecentEvents sessionId={normalizedClick.sessionId} startedAt={1000} />,
  );
  expect(
    await screen.findByLabelText('Captured event count'),
  ).toHaveTextContent('1 / 1000 captured');
  expect(screen.getByText('Click · button')).toBeInTheDocument();
  expect(screen.getByText('+0.500s')).toBeInTheDocument();
});

it('offers a retry when reading interactions fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(requestEvents)
    .mockRejectedValueOnce(new Error('Storage failed'))
    .mockResolvedValue({ count: 0, events: [] });
  render(
    <RecentEvents sessionId={normalizedClick.sessionId} startedAt={1000} />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not load events',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh events' }));
  expect(await screen.findByText(/No events captured yet/)).toBeInTheDocument();
});
