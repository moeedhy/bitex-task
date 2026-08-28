import type { Asset, IdGenerator, Money } from '@bitex/platform';
import type { WalletRepository } from './wallet.repository.js';

export class ReserveFunds {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly reservationIds: IdGenerator,
  ) {}

  async execute(input: {
    withdrawalId: string;
    userId: string;
    asset: Asset;
    amount: Money;
  }): Promise<{ reservationId: string }> {
    const wallet = await this.wallets.getForUpdate(input.userId, input.asset);
    const reservationId = this.reservationIds.next();
    wallet.reserve({
      reservationId,
      withdrawalId: input.withdrawalId,
      amount: input.amount,
    });
    await this.wallets.save(wallet);
    return { reservationId };
  }
}
