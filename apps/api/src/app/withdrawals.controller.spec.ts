import { WithdrawalsController } from './withdrawals.controller.js';

describe('WithdrawalsController', () => {
  const createController = (allow = true) => {
    const execute = jest.fn().mockResolvedValue({
      withdrawalId: 'withdrawal-1',
      status: 'PENDING',
      asset: 'USDT',
      amount: '100',
    });
    const getById = jest.fn().mockResolvedValue({ withdrawalId: 'withdrawal-1' });
    const controller = new WithdrawalsController(
      { execute } as never,
      { execute: getById } as never,
      { allow: async () => allow } as never,
    );
    return { controller, execute, getById };
  };

  const body = {
    userId: 'user-123',
    asset: 'USDT',
    amount: '100.000000',
    destinationAddress: 'TXYZ123456789',
  };

  it('parses the request into semantic values and forwards a command', async () => {
    const { controller, execute } = createController();

    const result = await controller.createWithdrawal('  key-123  ', body);

    expect(result.withdrawalId).toBe('withdrawal-1');
    const command = execute.mock.calls[0][0];
    expect(command.idempotencyKey).toBe('key-123');
    expect(command.userId).toBe('user-123');
    expect(command.amount.toDecimalString()).toBe('100');
    expect(command.amount.asset.code).toBe('USDT');
  });

  it('does not fingerprint the request itself', async () => {
    const { controller, execute } = createController();

    await controller.createWithdrawal('key-123', body);

    // Fingerprinting is workflow policy: a second driving adapter must not have
    // to reproduce it to stay compatible with HTTP.
    expect(execute.mock.calls[0][0]).not.toHaveProperty('fingerprint');
  });

  it('rejects an unknown asset before reaching the workflow', async () => {
    const { controller, execute } = createController();

    await expect(
      controller.createWithdrawal('key-123', { ...body, asset: 'DOGE' }),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a request without an Idempotency-Key before doing any work', async () => {
    const { controller, execute } = createController();

    await expect(
      controller.createWithdrawal(undefined, body),
    ).rejects.toThrow('Idempotency-Key header is required.');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a rate-limited caller before opening a transaction', async () => {
    const { controller, execute } = createController(false);

    await expect(controller.createWithdrawal('key-123', body)).rejects.toThrow(
      'Withdrawal rate limit exceeded.',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('delegates lookups to the query use case', async () => {
    const { controller, getById } = createController();

    await controller.getById('withdrawal-1');

    expect(getById).toHaveBeenCalledWith('withdrawal-1');
  });
});
