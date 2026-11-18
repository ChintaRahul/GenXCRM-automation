import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { SlaProcessor } from './sla.processor';
import { SlaEngineService } from './sla-engine.service';

const mockSlaEngine = {
  tick: jest.fn().mockResolvedValue(undefined),
  runDateTriggeredSweep: jest.fn().mockResolvedValue(undefined),
};

const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };

describe('SlaProcessor', () => {
  let processor: SlaProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SlaProcessor,
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: getQueueToken('sla'), useValue: mockQueue },
      ],
    }).compile();
    processor = module.get(SlaProcessor);
  });

  it('registers both the tick and date-sweep repeatable jobs on module init', async () => {
    await processor.onModuleInit();
    expect(mockQueue.add).toHaveBeenCalledWith('tick', {}, expect.objectContaining({ jobId: 'sla-tick' }));
    expect(mockQueue.add).toHaveBeenCalledWith('date-sweep', {}, expect.objectContaining({ jobId: 'sla-date-sweep' }));
  });

  it('handleTick delegates to SlaEngineService.tick', async () => {
    await processor.handleTick();
    expect(mockSlaEngine.tick).toHaveBeenCalled();
  });

  it('handleDateSweep delegates to SlaEngineService.runDateTriggeredSweep', async () => {
    await processor.handleDateSweep();
    expect(mockSlaEngine.runDateTriggeredSweep).toHaveBeenCalled();
  });
});
