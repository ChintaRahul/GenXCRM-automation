import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { RenameTeamDialog } from '../components/team/RenameTeamDialog';
import * as client from '../api/client';
import type { Team } from '../types';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockTeam: Team = {
  id: 't1',
  name: 'Growth Team',
  managerId: null,
  manager: null,
  members: [],
  orgId: 'org-1',
  type: 'MEMBER' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('RenameTeamDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with team name pre-filled', () => {
    render(
      <RenameTeamDialog team={mockTeam} open={true} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { name: /edit team/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Growth Team')).toBeInTheDocument();
  });

  it('calls updateTeam and onSaved on submit', async () => {
    vi.mocked(client.updateTeam).mockResolvedValue({ ...mockTeam, name: 'Alpha Team' });
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <RenameTeamDialog team={mockTeam} open={true} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );

    const input = screen.getByDisplayValue('Growth Team');
    fireEvent.change(input, { target: { value: 'Alpha Team' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(client.updateTeam).toHaveBeenCalledWith('t1', { name: 'Alpha Team', monthlyTarget: 0 }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('pre-fills and submits the monthly target', async () => {
    vi.mocked(client.updateTeam).mockResolvedValue({ ...mockTeam, monthlyTarget: 200000 });
    render(
      <RenameTeamDialog
        team={{ ...mockTeam, monthlyTarget: 150000 }}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const targetInput = screen.getByDisplayValue('150000');
    fireEvent.change(targetInput, { target: { value: '200000' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(client.updateTeam).toHaveBeenCalledWith('t1', { name: 'Growth Team', monthlyTarget: 200000 }),
    );
  });

  it('submit button is disabled when name is empty', () => {
    render(
      <RenameTeamDialog team={mockTeam} open={true} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    fireEvent.change(screen.getByDisplayValue('Growth Team'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('shows error toast on API failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(client.updateTeam).mockRejectedValue(new Error('fail'));

    render(
      <RenameTeamDialog team={mockTeam} open={true} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
