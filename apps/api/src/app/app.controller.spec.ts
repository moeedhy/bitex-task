import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('parses the request and forwards a canonical command', async () => {
    const execute = jest.fn().mockResolvedValue({
      withdrawalId: 'withdrawal-1',
      status: 'PENDING',
      asset: 'USDT',
      amount: '100',
    });
    const runtime = {
      rateLimiter: { allow: async () => true },
      requestWithdrawal: { execute },
      getWithdrawal: { execute: async () => undefined },
    };
    const controller = new AppController(runtime as never);

    const result = await controller.createWithdrawal('key-123', {
      userId: 'user-123',
      asset: 'USDT',
      amount: '100.000000',
      destinationAddress: 'TXYZ123456789',
    });

    expect(result.withdrawalId).toBe('withdrawal-1');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'key-123',
        userId: 'user-123',
        amount: expect.objectContaining({}),
      }),
    );
    expect(execute.mock.calls[0][0].amount.toDecimalString()).toBe('100');
    expect(execute.mock.calls[0][0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
