import { extractContact } from './form-contact.util';

describe('extractContact', () => {
  it('finds name, phone and email by question title', () => {
    expect(
      extractContact({ 'Full Name': ' Asha Rao ', 'Mobile Number': '+91 98765-43210', 'Email Address': ' ASHA@Example.com ' }),
    ).toEqual({ name: 'Asha Rao', phone: '919876543210', email: 'asha@example.com' });
  });

  it('does not treat parent/guardian names as the student name', () => {
    expect(extractContact({ "Father's Name": 'Ravi', 'Student Name': 'Asha' }).name).toBe('Asha');
  });

  it('accepts WhatsApp / contact titles for phone', () => {
    expect(extractContact({ 'WhatsApp number': '9876543210' }).phone).toBe('9876543210');
  });

  it('ignores empty answers and returns an empty object when nothing matches', () => {
    expect(extractContact({ Course: 'MBA', Name: '   ' })).toEqual({});
  });

  it('matches fields independently: "Contact Name" is a name, not a phone', () => {
    expect(extractContact({ 'Contact Name': 'Asha Rao' })).toEqual({ name: 'Asha Rao' });
  });

  it('"Contact Number" fills phone only', () => {
    expect(extractContact({ 'Contact Number': '9876543210' })).toEqual({ phone: '9876543210' });
  });
});
