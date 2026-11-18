import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { TeamCard } from '../components/team/TeamCard';
import type { Team } from '../types';

const mockTeam: Team = {
  id: 't1',
  name: 'Growth Team',
  managerId: 'u1',
  manager: { id: 'u1', name: 'Alice Manager' },
  members: [
    { id: 'u2', name: 'Bob Rep', role: 'SALES_REP' },
    { id: 'u3', name: 'Carol Rep', role: 'SALES_REP' },
  ],
  orgId: 'org-1',
  type: 'MEMBER' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const defaultCallbacks = {
  canEdit: true,
  canManageMembers: true,
  onRename: vi.fn(),
  onChangeManager: vi.fn(),
  onManageMembers: vi.fn(),
  onDelete: vi.fn(),
};

describe('TeamCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders team name', () => {
    render(<TeamCard team={mockTeam} {...defaultCallbacks} />);
    expect(screen.getByText('Growth Team')).toBeInTheDocument();
  });

  it('renders manager name', () => {
    render(<TeamCard team={mockTeam} {...defaultCallbacks} />);
    expect(screen.getByText('Alice Manager')).toBeInTheDocument();
  });

  it('renders member avatars', () => {
    render(<TeamCard team={mockTeam} {...defaultCallbacks} />);
    expect(screen.getByText('BR')).toBeInTheDocument();
    expect(screen.getByText('CR')).toBeInTheDocument();
  });

  it('shows overflow count when members exceed 5', () => {
    const manyMembers: Team = {
      ...mockTeam,
      members: [
        { id: 'u1', name: 'A B', role: 'SALES_REP' },
        { id: 'u2', name: 'C D', role: 'SALES_REP' },
        { id: 'u3', name: 'E F', role: 'SALES_REP' },
        { id: 'u4', name: 'G H', role: 'SALES_REP' },
        { id: 'u5', name: 'I J', role: 'SALES_REP' },
        { id: 'u6', name: 'K L', role: 'SALES_REP' },
        { id: 'u7', name: 'M N', role: 'SALES_REP' },
      ],
    };
    render(<TeamCard team={manyMembers} {...defaultCallbacks} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows fallback when no manager assigned', () => {
    const noManager: Team = { ...mockTeam, manager: null, managerId: null };
    render(<TeamCard team={noManager} {...defaultCallbacks} />);
    expect(screen.getByText('No manager assigned')).toBeInTheDocument();
  });

  it('shows kebab menu button', () => {
    render(<TeamCard team={mockTeam} {...defaultCallbacks} />);
    expect(screen.getByRole('button', { name: /team actions/i })).toBeInTheDocument();
  });

  it('kebab menu items are disabled when canEdit is false', () => {
    render(<TeamCard team={mockTeam} {...defaultCallbacks} canEdit={false} />);
    fireEvent.click(screen.getByRole('button', { name: /team actions/i }));
    expect(screen.getByText('Edit')).toBeDisabled();
    expect(screen.getByText('Delete')).toBeDisabled();
  });

  it('Manage members is disabled when canManageMembers is false', () => {
    render(<TeamCard team={mockTeam} {...defaultCallbacks} canManageMembers={false} />);
    fireEvent.click(screen.getByRole('button', { name: /team actions/i }));
    expect(screen.getByText('Manage members')).toBeDisabled();
  });

  it('Manage members is enabled for a Manager with canManageMembers true', () => {
    render(<TeamCard team={mockTeam} {...defaultCallbacks} canEdit={false} canManageMembers={true} />);
    fireEvent.click(screen.getByRole('button', { name: /team actions/i }));
    expect(screen.getByText('Manage members')).not.toBeDisabled();
    // Director-only actions still disabled
    expect(screen.getByText('Edit')).toBeDisabled();
  });

  it('calls onRename when Rename is clicked', () => {
    const onRename = vi.fn();
    render(<TeamCard team={mockTeam} {...defaultCallbacks} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: /team actions/i }));
    fireEvent.click(screen.getByText('Edit'));
    expect(onRename).toHaveBeenCalledOnce();
  });

  it('calls onChangeManager when Change manager is clicked', () => {
    const onChangeManager = vi.fn();
    render(<TeamCard team={mockTeam} {...defaultCallbacks} onChangeManager={onChangeManager} />);
    fireEvent.click(screen.getByRole('button', { name: /team actions/i }));
    fireEvent.click(screen.getByText('Change manager'));
    expect(onChangeManager).toHaveBeenCalledOnce();
  });

  it('calls onManageMembers when Manage members is clicked', () => {
    const onManageMembers = vi.fn();
    render(<TeamCard team={mockTeam} {...defaultCallbacks} onManageMembers={onManageMembers} />);
    fireEvent.click(screen.getByRole('button', { name: /team actions/i }));
    fireEvent.click(screen.getByText('Manage members'));
    expect(onManageMembers).toHaveBeenCalledOnce();
  });

  it('calls onDelete when Delete is clicked', () => {
    const onDelete = vi.fn();
    render(<TeamCard team={mockTeam} {...defaultCallbacks} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /team actions/i }));
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('renders stats placeholder row', () => {
    render(<TeamCard team={mockTeam} {...defaultCallbacks} />);
    expect(screen.getByText('Leads:')).toBeInTheDocument();
    expect(screen.getByText('Enrolled:')).toBeInTheDocument();
    expect(screen.getByText('Revenue:')).toBeInTheDocument();
  });
});
