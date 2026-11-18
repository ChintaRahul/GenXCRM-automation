import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export async function validateBody<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
): Promise<T> {
  const instance = plainToInstance(cls, body);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new BadRequestException(messages.length > 0 ? messages : 'Validation failed.');
  }
  return instance;
}
