import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { CreateTeamDialog } from '../components/team/CreateTeamDialog';
import * as client from '../api/client';
import type { User, Team } from '../types';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockManagers: User[] = [
  { id: 'u1', name: 'Alice Manager', email: 'alice@co.com', role: 'MANAGER', teamId: 't1' },
];

const mockTeam: Team = {
  id: 't1',
  name: 'Growth Team',
  managerId: 'u1',
  manager: { id: 'u1', name: 'Alice Manager' },
  members: [],
  orgId: 'org-1',
  type: 'MEMBER' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('CreateTeamDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders team name and manager fields', () => {
    render(
      <CreateTeamDialog
        open={true}
        onOpenChange={vi.fn()}
        managers={mockManagers}
        callerRole="DIRECTOR"
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Create team' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Growth Team')).toBeInTheDocument();
    expect(screen.getByText('Select a manager')).toBeInTheDocument();
  });

  it('calls createTeam and onCreated on submit', async () => {
    vi.mocked(client.createTeam).mockResolvedValue(mockTeam);
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <CreateTeamDialog
        open={true}
        onOpenChange={onOpenChange}
        managers={mockManagers}
        callerRole="DIRECTOR"
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('e.g. Growth Team'), {
      target: { value: 'Growth Team' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(client.createTeam).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Growth Team' }),
    ));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('shows error toast on API failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(client.createTeam).mockRejectedValue(new Error('fail'));

    render(
      <CreateTeamDialog
        open={true}
        onOpenChange={vi.fn()}
        managers={mockManagers}
        callerRole="DIRECTOR"
        onCreated={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('e.g. Growth Team'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
