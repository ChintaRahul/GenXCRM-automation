import axios from 'axios';

// UNVERIFIED against TradeIndia: no public docs exist, so the date parameter names, date format and
// response shape below are best guesses. Check them against a real "My Inquiry API" response
// before setting TRADEINDIA_POLL_ENABLED=true.
const FROM_PARAM = 'from_date';
const TO_PARAM = 'to_date';
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

// The response is either a bare array or an object holding the array under some key.
const extractEnquiries = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return Object.values(data).find(Array.isArray) ?? [];
  return [];
};

export const fetchTradeIndiaEnquiries = async (apiLink: string, from: Date, to: Date): Promise<unknown[]> => {
  const { data } = await axios.get<unknown>(apiLink, {
    params: { [FROM_PARAM]: isoDay(from), [TO_PARAM]: isoDay(to) },
    timeout: 20_000,
  });
  return extractEnquiries(data);
};
