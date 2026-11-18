import { Test } from '@nestjs/testing';
import { StorageService } from './storage.service';

const mockGetSignedUrlPromise = jest.fn().mockResolvedValue('https://signed.example.com/object');
jest.mock('aws-sdk', () => ({
  S3: jest.fn().mockImplementation(() => ({ getSignedUrlPromise: mockGetSignedUrlPromise })),
}));

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.S3_BUCKET = 'genxcrm-recordings';
    delete process.env.S3_ENDPOINT;
    const module = await Test.createTestingModule({ providers: [StorageService] }).compile();
    service = module.get(StorageService);
  });

  describe('buildRecordingKey', () => {
    it('builds an org/lead-scoped key path', () => {
      expect(service.buildRecordingKey('lead-1', 'rec-1', 'aac')).toBe('leads/lead-1/recordings/rec-1.aac');
    });
  });

  describe('getPresignedUploadUrl', () => {
    it('requests a putObject presigned URL with a 5-minute expiry', async () => {
      const url = await service.getPresignedUploadUrl('leads/lead-1/recordings/rec-1.aac', 'audio/aac');

      expect(mockGetSignedUrlPromise).toHaveBeenCalledWith('putObject', {
        Bucket: 'genxcrm-recordings',
        Key: 'leads/lead-1/recordings/rec-1.aac',
        ContentType: 'audio/aac',
        Expires: 300,
      });
      expect(url).toBe('https://signed.example.com/object');
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('requests a getObject presigned URL with a 15-minute expiry', async () => {
      await service.getPresignedDownloadUrl('leads/lead-1/recordings/rec-1.aac');

      expect(mockGetSignedUrlPromise).toHaveBeenCalledWith('getObject', {
        Bucket: 'genxcrm-recordings',
        Key: 'leads/lead-1/recordings/rec-1.aac',
        Expires: 900,
      });
    });
  });
});
