import { Test } from '@nestjs/testing';
import * as AWS from 'aws-sdk';
import { MailService } from './mail.service';

jest.mock('aws-sdk');

const promiseMock = jest.fn();
const sendEmailMock = jest.fn().mockReturnValue({ promise: promiseMock });

describe('MailService', () => {
  let service: MailService;
  const originalFrom = process.env.SES_FROM_EMAIL;

  beforeEach(async () => {
    jest.clearAllMocks();
    promiseMock.mockResolvedValue({});
    (AWS.SES as unknown as jest.Mock).mockImplementation(
      () => ({ sendEmail: sendEmailMock }) as unknown as AWS.SES,
    );

    const module = await Test.createTestingModule({ providers: [MailService] }).compile();
    service = module.get(MailService);
  });

  afterEach(() => {
    if (originalFrom === undefined) delete process.env.SES_FROM_EMAIL;
    else process.env.SES_FROM_EMAIL = originalFrom;
  });

  it('skips sending when SES_FROM_EMAIL is unset', async () => {
    delete process.env.SES_FROM_EMAIL;
    const sent = await service.send('to@example.com', 'Subject', '<p>hi</p>');
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(sent).toBe(false);
  });

  it('calls SES with the correct payload when SES_FROM_EMAIL is set, and returns true', async () => {
    process.env.SES_FROM_EMAIL = 'no-reply@genxcrm.example';
    const sent = await service.send('to@example.com', 'Subject', '<p>hi</p>');
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        Source: 'GenXCRM <no-reply@genxcrm.example>',
        Destination: { ToAddresses: ['to@example.com'] },
      }),
    );
    expect(sent).toBe(true);
  });

  it('never throws when SES errors, and returns false', async () => {
    process.env.SES_FROM_EMAIL = 'no-reply@genxcrm.example';
    promiseMock.mockRejectedValue(new Error('SES down'));
    await expect(service.send('to@example.com', 'Subject', '<p>hi</p>')).resolves.toBe(false);
  });
});
