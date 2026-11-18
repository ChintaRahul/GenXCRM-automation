import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FormsSection } from '../components/leadDetail/FormsSection';
import type { FormSubmissionDto } from '../types';

const sub: FormSubmissionDto = {
  id: 's1', formId: 'f1', leadId: 'l1', status: 'PROCESSED', submittedAt: '2026-09-24T10:00:00Z',
  answers: { 'Preferred course': 'MBA', City: 'Pune' }, form: { name: 'Intake' }, lead: { id: 'l1', name: 'Asha' },
};

describe('FormsSection', () => {
  it('shows each answer with its question', () => {
    render(<FormsSection submissions={[sub]} loading={false} />);
    expect(screen.getByText('Intake')).toBeInTheDocument();
    expect(screen.getByText('Preferred course')).toBeInTheDocument();
    expect(screen.getByText('MBA')).toBeInTheDocument();
    expect(screen.getByText('Pune')).toBeInTheDocument();
  });

  it('shows an empty state', () => {
    render(<FormsSection submissions={[]} loading={false} />);
    expect(screen.getByText(/no responses yet/i)).toBeInTheDocument();
  });

  it('flags failed submissions', () => {
    render(<FormsSection submissions={[{ ...sub, status: 'FAILED' }]} loading={false} />);
    expect(screen.getByText(/couldn.t be processed/i)).toBeInTheDocument();
  });
});

describe('FormsSection — earlier responses', () => {
  const older: FormSubmissionDto = { ...sub, id: 's0', submittedAt: '2026-09-01T10:00:00Z', answers: { City: 'Delhi' } };

  it('collapses older submissions behind a toggle', async () => {
    render(<FormsSection submissions={[sub, older]} loading={false} />);
    expect(screen.queryByText('Delhi')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 earlier response' }));
    expect(screen.getByText('Delhi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide earlier responses' }));
    expect(screen.queryByText('Delhi')).not.toBeInTheDocument();
  });
});
