import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useInvoicesList, useInvoice, useNextInvoiceNumber } from '../hooks/useInvoices';
import * as client from '../api/client';
import { Messages } from '../lib/messages';
import type { Invoice } from '../types';

vi.mock('../api/client');

const mockInvoice: Invoice = {
  id: 'inv-1',
  leadId: 'lead-1',
  invoiceNumber: 'INV-2026-0001',
  status: 'DRAFT',
  invoiceDate: '2026-08-28T00:00:00.000Z',
  gstEnabled: true,
  gstType: 'CGST_SGST',
  gstRate: 18,
  discountType: 'FLAT',
  discountValue: 0,
  subtotal: 1000,
  discountAmount: 0,
  taxableAmount: 1000,
  taxAmount: 180,
  grandTotal: 1180,
  paymentLinkAttached: false,
  emiPaymentMode: "MANUAL",
  generatedFromRegistration: false,
  lineItems: [],
  emiInstallments: [],
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};

const mockPaginated = { data: [mockInvoice], total: 1, page: 1, limit: 20, pages: 1 };

describe('useInvoicesList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns invoices on successful fetch', async () => {
    vi.mocked(client.getInvoices).mockResolvedValue(mockPaginated);
    const { result } = renderHook(() => useInvoicesList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0].invoiceNumber).toBe('INV-2026-0001');
    expect(result.current.error).toBeNull();
  });

  it('sets error state on failed fetch', async () => {
    vi.mocked(client.getInvoices).mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useInvoicesList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.invoices);
    expect(result.current.data).toBeNull();
  });

  it('starts loading true and resolves to false', async () => {
    vi.mocked(client.getInvoices).mockResolvedValue(mockPaginated);
    const { result } = renderHook(() => useInvoicesList());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('refetch re-triggers the API call', async () => {
    vi.mocked(client.getInvoices).mockResolvedValue(mockPaginated);
    const { result } = renderHook(() => useInvoicesList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    result.current.refetch();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.getInvoices).toHaveBeenCalledTimes(2);
  });

  it('passes the query object through to the client call', async () => {
    vi.mocked(client.getInvoices).mockResolvedValue(mockPaginated);
    renderHook(() => useInvoicesList({ status: 'SENT' }));
    await waitFor(() => expect(client.getInvoices).toHaveBeenCalledWith({ status: 'SENT' }));
  });
});

describe('useInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the invoice on successful fetch', async () => {
    vi.mocked(client.getInvoice).mockResolvedValue(mockInvoice);
    const { result } = renderHook(() => useInvoice('inv-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.id).toBe('inv-1');
    expect(client.getInvoice).toHaveBeenCalledWith('inv-1');
  });

  it('sets error state on failed fetch', async () => {
    vi.mocked(client.getInvoice).mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useInvoice('inv-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.invoices);
  });

  it('refetches when the id changes', async () => {
    vi.mocked(client.getInvoice).mockResolvedValue(mockInvoice);
    const { rerender } = renderHook(({ id }) => useInvoice(id), {
      initialProps: { id: 'inv-1' },
    });
    await waitFor(() => expect(client.getInvoice).toHaveBeenCalledWith('inv-1'));
    rerender({ id: 'inv-2' });
    await waitFor(() => expect(client.getInvoice).toHaveBeenCalledWith('inv-2'));
  });
});

describe('useNextInvoiceNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the next invoice number on successful fetch', async () => {
    vi.mocked(client.getNextInvoiceNumber).mockResolvedValue({ invoiceNumber: 'INV-2026-0002' });
    const { result } = renderHook(() => useNextInvoiceNumber());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.invoiceNumber).toBe('INV-2026-0002');
  });

  it('sets error state on failed fetch', async () => {
    vi.mocked(client.getNextInvoiceNumber).mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useNextInvoiceNumber());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.invoices);
  });
});
