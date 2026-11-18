export interface FormContact {
  name?: string;
  phone?: string;
  email?: string;
}

const NAME = /name/i;
const NOT_STUDENT_NAME = /(father|mother|parent|guardian|school|college|company|course)/i;
const PHONE = /(phone|mobile|whatsapp|contact)/i;
const PHONE_LIKE = /^[\d\s+\-()]+$/;
const EMAIL = /e-?mail/i;

export const extractContact = (answers: Record<string, string>): FormContact => {
  const contact: FormContact = {};
  for (const [title, raw] of Object.entries(answers)) {
    const value = raw.trim();
    if (!value) continue;
    if (!contact.email && EMAIL.test(title)) contact.email = value.toLowerCase();
    if (!contact.phone && PHONE.test(title)) {
      const digits = value.replace(/\D/g, '');
      if (digits) contact.phone = digits;
    }
    if (!contact.name && NAME.test(title) && !NOT_STUDENT_NAME.test(title) && !PHONE_LIKE.test(value)) {
      contact.name = value;
    }
  }
  return contact;
};
