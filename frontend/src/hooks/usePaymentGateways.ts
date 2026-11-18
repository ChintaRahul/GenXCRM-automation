import { useState, useEffect, useCallback } from 'react';
import type { PaymentGatewayStatus } from '../types';
import * as client from '../api/client';
import { apiErrorMessage } from '../lib/apiError';
import { Messages } from '../lib/messages';

interface UsePaymentGatewaysReturn {
  gateways: PaymentGatewayStatus[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePaymentGateways(): UsePaymentGatewaysReturn {
  const [gateways, setGateways] = useState<PaymentGatewayStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchGateways = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getConnectedPaymentGateways();
      setGateways(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.paymentGateways));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchGateways(); }, [fetchGateways]);

  return { gateways, loading, error, refetch: fetchGateways };
}
