import { Logger } from '@nestjs/common';
import type { RecoverStuckWithdrawals } from '@bitex/withdrawal';

/**
 * Drives `RecoverStuckWithdrawals` on a timer. Kept out of the use case so the
 * workflow stays free of scheduling concerns and remains testable without
 * fake timers.
 */
export class StuckWithdrawalRecoveryWorker {
  private readonly logger = new Logger(StuckWithdrawalRecoveryWorker.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly recover: Pick<RecoverStuckWithdrawals, 'execute'>,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runOnce(): Promise<number> {
    try {
      const { rescheduled } = await this.recover.execute();
      for (const withdrawalId of rescheduled) {
        this.logger.warn({
          withdrawalId,
          operation: 'recover-stuck-withdrawal',
          result: 'rescheduled',
        });
      }
      return rescheduled.length;
    } catch (error) {
      this.logger.error({
        operation: 'recover-stuck-withdrawal',
        result: 'failed',
        errorCode: (error as Error).name,
      });
      return 0;
    }
  }
}
