import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { RegistrationTable } from '../components/invoices/RegistrationTable';
import type { FormSubmissionDto, Invoice } from '../types';

vi.mock('../components/invoices/RegistrationRowActions', () => ({ RegistrationRowActions: () => null }));

const inv = (id: string, leadId: string, name: string) =>
  ({ id, leadId, lead: { id: leadId, name }, invoiceNumber: id, status: 'PAID', lineItems: [], registeredAt: '2026-09-20T00:00:00Z' }) as unknown as Invoice;

const sub: FormSubmissionDto = {
  id: 's1', formId: 'f1', leadId: 'l1', status: 'PROCESSED', submittedAt: '2026-09-24T10:00:00Z',
  answers: { City: 'Pune' }, form: { name: 'Intake' }, lead: { id: 'l1', name: 'Asha' },
};

const renderTable = () =>
  render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegistrationTable invoices={[inv('i1', 'l1', 'Asha'), inv('i2', 'l2', 'Ravi')]} onChanged={vi.fn()} submissionsByLead={new Map([['l1', [sub]]])} />} />
        <Route path="/invoices/:id/edit" element={<p>invoice page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('RegistrationTable form column', () => {
  it('shows the pill only for leads with responses, and a dash otherwise', () => {
    renderTable();
    expect(screen.getAllByRole('button', { name: 'View responses' })).toHaveLength(2); // table + card list
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('opens the responses dialog without navigating to the invoice', () => {
    renderTable();
    fireEvent.click(screen.getAllByRole('button', { name: 'View responses' })[0]);
    expect(screen.getByText('Pune')).toBeInTheDocument();
    expect(screen.queryByText('invoice page')).not.toBeInTheDocument();
  });
});
