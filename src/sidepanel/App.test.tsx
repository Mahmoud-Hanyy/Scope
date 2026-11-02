import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { requestConnectionCheck, requestSession } from '../messaging/client';
import { App } from './App';

vi.mock('../messaging/client', () => ({
  requestConnectionCheck: vi.fn(),
  requestSession: vi.fn(),
  requestEvents: vi.fn().mockResolvedValue({ count: 0, events: [] }),
}));
beforeEach(() => vi.mocked(requestSession).mockResolvedValue(null));

it('shows the initial state and checks the page connection', async () => {
  vi.mocked(requestConnectionCheck).mockResolvedValue({ status: 'connected' });
  render(<App />);
  expect(
    screen.getByRole('status', { name: 'Connection status' }),
  ).toHaveTextContent('has not been checked');
  await userEvent.click(
    screen.getByRole('button', { name: 'Check connection' }),
  );
  expect(
    await screen.findByText('Connected to the current page.'),
  ).toBeInTheDocument();
});

it('explains how to recover from unavailable page access', async () => {
  vi.mocked(requestConnectionCheck).mockResolvedValue({
    status: 'unavailable',
    reason: 'page-unavailable',
  });
  render(<App />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Check connection' }),
  );
  expect(
    await screen.findByText(/click the Scope toolbar icon to grant access/),
  ).toBeInTheDocument();
});

it('restores the button after a transport failure and reports Scope’s own error', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(requestConnectionCheck).mockRejectedValue(
    new Error('Worker unavailable'),
  );
  render(<App />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Check connection' }),
  );
  expect(
    await screen.findByText(/Scope could not check the connection/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Check connection' }),
  ).toBeEnabled();
});

it('distinguishes a content-script failure from denied page access', async () => {
  vi.mocked(requestConnectionCheck).mockResolvedValue({
    status: 'unavailable',
    reason: 'handshake-failed',
  });
  render(<App />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Check connection' }),
  );
  expect(
    await screen.findByText(/Scope reached the page, but its content script/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('status', { name: 'Connection status' }),
  ).not.toHaveTextContent('Page unavailable');
});
