import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

// Catches emails like "sklsd@sdf.com.com.com" — syntactically valid per @IsEmail()
// (it has an @ and a dotted domain), but the repeated trailing label is never a
// real domain. Only flags immediately-adjacent duplicate labels, so legitimate
// lookalikes (e.g. "mail.google.com") are untouched.
export function hasRepeatedDomainLabel(email: string): boolean {
  const at = email.indexOf('@');
  if (at === -1) return false;
  const labels = email
    .slice(at + 1)
    .toLowerCase()
    .split('.');
  return labels.some((label, i) => i > 0 && label !== '' && label === labels[i - 1]);
}

@ValidatorConstraint({ name: 'noRepeatedDomainLabel', async: false })
class NoRepeatedDomainLabelConstraint implements ValidatorConstraintInterface {
  validate(email: unknown): boolean {
    return typeof email !== 'string' || !hasRepeatedDomainLabel(email);
  }

  defaultMessage(): string {
    return 'email domain must not repeat a segment (e.g. .com.com)';
  }
}

export function IsNotRepeatedDomainLabel(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: NoRepeatedDomainLabelConstraint,
    });
  };
}
