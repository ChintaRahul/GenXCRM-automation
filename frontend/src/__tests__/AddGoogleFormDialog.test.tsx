import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddGoogleFormDialog } from '../components/integrations/AddGoogleFormDialog';
import * as pickerHook from '../hooks/useGooglePicker';

vi.mock('../hooks/useGooglePicker');

describe('AddGoogleFormDialog', () => {
  const pick = vi.fn();
  const onConnect = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pickerHook.useGooglePicker).mockReturnValue({ picking: false, pick });
    onConnect.mockResolvedValue(true);
  });

  const setup = () => render(<AddGoogleFormDialog open onOpenChange={onOpenChange} onConnect={onConnect} />);

  it('keeps Connect disabled until a form and a sheet choice are made', async () => {
    setup();
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
    pick.mockResolvedValueOnce({ id: 'g-form', name: 'Admissions' });
    await userEvent.click(screen.getByRole('button', { name: /choose form/i }));
    expect(await screen.findByText('Admissions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /create a sheet for me/i }));
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeEnabled();
  });

  it('connects with a created sheet', async () => {
    setup();
    pick.mockResolvedValueOnce({ id: 'g-form', name: 'Admissions' });
    await userEvent.click(screen.getByRole('button', { name: /choose form/i }));
    await screen.findByText('Admissions');
    await userEvent.click(screen.getByRole('button', { name: /create a sheet for me/i }));
    await userEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith({ googleFormId: 'g-form', createSheet: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('connects with a picked sheet', async () => {
    setup();
    pick.mockResolvedValueOnce({ id: 'g-form', name: 'Admissions' }).mockResolvedValueOnce({ id: 'g-sheet', name: 'Responses' });
    await userEvent.click(screen.getByRole('button', { name: /choose form/i }));
    await screen.findByText('Admissions');
    await userEvent.click(screen.getByRole('button', { name: /choose sheet/i }));
    await screen.findByText('Responses');
    await userEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith({ googleFormId: 'g-form', googleSheetId: 'g-sheet' }));
  });

  it('stays open when connecting fails', async () => {
    onConnect.mockResolvedValue(false);
    setup();
    pick.mockResolvedValueOnce({ id: 'g-form', name: 'Admissions' });
    await userEvent.click(screen.getByRole('button', { name: /choose form/i }));
    await screen.findByText('Admissions');
    await userEvent.click(screen.getByRole('button', { name: /create a sheet for me/i }));
    await userEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    await waitFor(() => expect(onConnect).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  const choose = async () => {
    pick.mockResolvedValueOnce({ id: 'g-form', name: 'Admissions' });
    await userEvent.click(screen.getByRole('button', { name: /choose form/i }));
    await screen.findByText('Admissions');
    await userEvent.click(screen.getByRole('button', { name: /create a sheet for me/i }));
  };

  it('clears the selection when closed (Cancel) and reopened', async () => {
    const { rerender } = setup();
    await choose();
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<AddGoogleFormDialog open={false} onOpenChange={onOpenChange} onConnect={onConnect} />);
    rerender(<AddGoogleFormDialog open onOpenChange={onOpenChange} onConnect={onConnect} />);
    expect(screen.queryByText('Admissions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
  });

  it('clears the selection when closed with Escape', async () => {
    const { rerender } = setup();
    await choose();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<AddGoogleFormDialog open={false} onOpenChange={onOpenChange} onConnect={onConnect} />);
    rerender(<AddGoogleFormDialog open onOpenChange={onOpenChange} onConnect={onConnect} />);
    expect(screen.queryByText('Admissions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
  });

  it('keeps the selection after a failed connect, then clears it on close', async () => {
    onConnect.mockResolvedValue(false);
    const { rerender } = setup();
    await choose();
    await userEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    await waitFor(() => expect(onConnect).toHaveBeenCalled());
    expect(screen.getByText('Admissions')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^connect$/i })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    rerender(<AddGoogleFormDialog open={false} onOpenChange={onOpenChange} onConnect={onConnect} />);
    rerender(<AddGoogleFormDialog open onOpenChange={onOpenChange} onConnect={onConnect} />);
    expect(screen.queryByText('Admissions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
  });

  it('is not left busy or re-populated when a pending connect resolves after close', async () => {
    let resolve: (ok: boolean) => void = () => {};
    onConnect.mockReturnValue(new Promise<boolean>((r) => { resolve = r; }));
    const { rerender } = setup();
    await choose();
    await userEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    resolve(false);
    rerender(<AddGoogleFormDialog open={false} onOpenChange={onOpenChange} onConnect={onConnect} />);
    rerender(<AddGoogleFormDialog open onOpenChange={onOpenChange} onConnect={onConnect} />);
    expect(screen.queryByText('Admissions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
  });

  it('a connect resolving true after close and reopen does not close the new session', async () => {
    let resolve: (ok: boolean) => void = () => {};
    onConnect.mockReturnValue(new Promise<boolean>((r) => { resolve = r; }));
    const { rerender } = setup();
    await choose();
    await userEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    rerender(<AddGoogleFormDialog open={false} onOpenChange={onOpenChange} onConnect={onConnect} />);
    rerender(<AddGoogleFormDialog open onOpenChange={onOpenChange} onConnect={onConnect} />);
    const callsBefore = onOpenChange.mock.calls.length;
    resolve(true);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onOpenChange.mock.calls.length).toBe(callsBefore);
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
  });

  it('a pick resolving after close does not populate the reopened dialog', async () => {
    let resolve: (f: { id: string; name: string }) => void = () => {};
    pick.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { rerender } = setup();
    await userEvent.click(screen.getByRole('button', { name: /choose form/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    rerender(<AddGoogleFormDialog open={false} onOpenChange={onOpenChange} onConnect={onConnect} />);
    rerender(<AddGoogleFormDialog open onOpenChange={onOpenChange} onConnect={onConnect} />);
    resolve({ id: 'g-form', name: 'Admissions' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText('Admissions')).not.toBeInTheDocument();
  });

  // While Google's Picker is open the dialog is hidden. Radix's modal dialog sets
  // `body { pointer-events: none }`, traps focus and locks scroll, which makes the Picker (rendered in
  // <body>, outside the dialog) unclickable; closing on outside interaction instead threw the pick away.
  describe('while the Google Picker is open', () => {
    const rerenderPicking = (rerender: (ui: React.ReactElement) => void, picking: boolean) => {
      vi.mocked(pickerHook.useGooglePicker).mockReturnValue({ picking, pick });
      rerender(<AddGoogleFormDialog open onOpenChange={onOpenChange} onConnect={onConnect} />);
    };

    it('hides the dialog and releases the page so the Picker is clickable', async () => {
      const { rerender } = setup();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(document.body.style.pointerEvents).toBe('none');
      rerenderPicking(rerender, true);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(document.body.style.pointerEvents).not.toBe('none');
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('brings the dialog back with the picked form once the Picker closes', async () => {
      let resolvePick: (f: { id: string; name: string }) => void = () => {};
      pick.mockReturnValueOnce(new Promise((r) => { resolvePick = r; }));
      const { rerender } = setup();
      await userEvent.click(screen.getByRole('button', { name: /choose form/i }));
      rerenderPicking(rerender, true);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      resolvePick({ id: 'g-form', name: 'Admissions' });
      rerenderPicking(rerender, false);
      expect(await screen.findByText('Admissions')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('still closes on an outside click when no picker is open', async () => {
      setup();
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      fireEvent.pointerDown(outside);
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      outside.remove();
    });
  });
});
