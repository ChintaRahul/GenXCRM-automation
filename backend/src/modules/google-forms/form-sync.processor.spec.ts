import { FormSyncProcessor } from './form-sync.processor';

describe('FormSyncProcessor', () => {
  it('registers one repeatable tick job with a fixed id and the single-attempt options', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const sync = { syncAllActive: jest.fn() };
    const processor = new FormSyncProcessor(queue as never, sync as never);

    await processor.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      'tick',
      {},
      expect.objectContaining({
        repeat: { every: 120_000 },
        jobId: 'form-sync-tick',
        attempts: 1,
        removeOnComplete: true,
      }),
    );
    expect(queue.add.mock.calls[0][2]).not.toHaveProperty('backoff');
  });

  it('runs syncAllActive on each tick', async () => {
    const sync = { syncAllActive: jest.fn().mockResolvedValue(undefined) };
    const processor = new FormSyncProcessor({ add: jest.fn() } as never, sync as never);
    await processor.handleTick();
    expect(sync.syncAllActive).toHaveBeenCalledTimes(1);
  });
});
