import { mapEnquiry, unwrapEnquiries } from './hubs.util';

describe('hubs.util', () => {
  const indiamart = {
    UNIQUE_QUERY_ID: '9988',
    SENDER_NAME: 'Anil Rao',
    SENDER_MOBILE: '+91-98765 43210',
    SENDER_EMAIL: 'anil@steelco.in',
    SENDER_COMPANY: 'Steelco',
    SENDER_CITY: 'Pune',
    SENDER_STATE: 'Maharashtra',
    QUERY_PRODUCT_NAME: '60 Ton Weighbridge',
    QUERY_MESSAGE: 'Need quote for pit-less model',
  };

  it('unwraps the IndiaMART RESPONSE envelope, object or array', () => {
    expect(unwrapEnquiries({ CODE: 200, RESPONSE: indiamart })).toEqual([indiamart]);
    expect(unwrapEnquiries({ RESPONSE: [indiamart, indiamart] })).toHaveLength(2);
    expect(unwrapEnquiries(indiamart)).toEqual([indiamart]);
    expect(unwrapEnquiries(null)).toEqual([]);
  });

  it('maps an IndiaMART enquiry onto a lead, matching the catalogue product', () => {
    const lead = mapEnquiry('indiamart', indiamart);
    expect(lead).toMatchObject({
      external_id: 'indiamart:9988',
      name: 'Anil Rao',
      company: 'Steelco',
      phone: '+91-98765 43210',
      email: 'anil@steelco.in',
      city: 'Pune',
      product: 'Weighbridge',
      source: 'IndiaMART',
    });
    expect(lead.requirement).toContain('60 Ton Weighbridge');
  });

  it('keeps the hub wording when no catalogue product matches', () => {
    expect(mapEnquiry('tradeindia', { sender_name: 'A', mobile: '9876543210', product_name: 'Hopper' }).product).toBe('Hopper');
  });
});
