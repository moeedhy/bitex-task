import { Asset, Assets, Money } from '@bitex/platform';
import {
  InsufficientAvailableBalanceError,
  InsufficientReservedBalanceError,
  InvalidWalletAmountError,
  InvalidWalletStateError,
  WalletAssetMismatchError,
} from './wallet.errors.js';
import { WalletAccount } from './wallet-account.js';

describe('WalletAccount', () => {
  const amount = (value: string) => Money.parse(value, Assets.USDT);
  const createWallet = () =>
    WalletAccount.create({
      id: 'wallet-1',
      userId: 'user-123',
      asset: Assets.USDT,
      balance: amount('100'),
    });

  it('creates a valid account with derived available balance', () => {
    const wallet = createWallet();

    expect(wallet.balance.toDecimalString()).toBe('100');
    expect(wallet.reservedBalance.toDecimalString()).toBe('0');
    expect(wallet.availableBalance.toDecimalString()).toBe('100');
  });

  it('rejects a negative opening balance', () => {
    expect(() =>
      WalletAccount.create({
        id: 'wallet-1',
        userId: 'user-123',
        asset: Assets.USDT,
        balance: amount('-1'),
      }),
    ).toThrow(InvalidWalletStateError);
  });

  it('rejects persisted reserved balance above total balance', () => {
    expect(() =>
      WalletAccount.reconstitute({
        id: 'wallet-1',
        userId: 'user-123',
        asset: Assets.USDT,
        balance: amount('100'),
        reservedBalance: amount('101'),
      }),
    ).toThrow(InvalidWalletStateError);
  });

  it('rejects persisted negative reserved balance', () => {
    expect(() =>
      WalletAccount.reconstitute({
        id: 'wallet-1',
        userId: 'user-123',
        asset: Assets.USDT,
        balance: amount('100'),
        reservedBalance: amount('-1'),
      }),
    ).toThrow(InvalidWalletStateError);
  });

  it('rejects a blank identity', () => {
    expect(() =>
      WalletAccount.create({
        id: '   ',
        userId: 'user-123',
        asset: Assets.USDT,
        balance: amount('100'),
      }),
    ).toThrow(InvalidWalletStateError);
  });

  it('rejects a balance denominated in another asset', () => {
    expect(() =>
      WalletAccount.create({
        id: 'wallet-1',
        userId: 'user-123',
        asset: Assets.USDT,
        balance: Money.parse('1', Asset.create('BTC', 8)),
      }),
    ).toThrow(InvalidWalletStateError);
  });

  it.each(['0', '-1'])('rejects balance operation amount %s', (value) => {
    expect(() => createWallet().reserve(amount(value))).toThrow(
      InvalidWalletAmountError,
    );
  });

  it('rejects an amount in another asset', () => {
    const btc = Asset.create('BTC', 8);

    expect(() => createWallet().reserve(Money.parse('1', btc))).toThrow(
      WalletAssetMismatchError,
    );
  });

  it('reserves funds without owning a reservation collection', () => {
    const wallet = createWallet();

    wallet.reserve(amount('80'));

    expect(wallet.reservedBalance.toDecimalString()).toBe('80');
    expect(wallet.availableBalance.toDecimalString()).toBe('20');
    expect(wallet.toSnapshot()).not.toHaveProperty('reservations');
  });

  it('allows reserving the full available balance', () => {
    const wallet = createWallet();

    wallet.reserve(amount('100'));

    expect(wallet.availableBalance.toDecimalString()).toBe('0');
  });

  it('rejects a reservation larger than available balance', () => {
    expect(() => createWallet().reserve(amount('101'))).toThrow(
      InsufficientAvailableBalanceError,
    );
  });

  it('supports multiple valid balance reservations', () => {
    const wallet = createWallet();

    wallet.reserve(amount('40'));
    wallet.reserve(amount('30'));

    expect(wallet.reservedBalance.toDecimalString()).toBe('70');
    expect(wallet.availableBalance.toDecimalString()).toBe('30');
  });

  it('releases reserved funds without changing total balance', () => {
    const wallet = createWallet();
    wallet.reserve(amount('80'));

    wallet.releaseReserved(amount('80'));

    expect(wallet.balance.toDecimalString()).toBe('100');
    expect(wallet.reservedBalance.toDecimalString()).toBe('0');
  });

  it('rejects releasing more than the reserved balance', () => {
    const wallet = createWallet();
    wallet.reserve(amount('20'));

    expect(() => wallet.releaseReserved(amount('21'))).toThrow(
      InsufficientReservedBalanceError,
    );
  });

  it('captures reserved funds from total and reserved balances', () => {
    const wallet = createWallet();
    wallet.reserve(amount('80'));

    wallet.captureReserved(amount('80'));

    expect(wallet.balance.toDecimalString()).toBe('20');
    expect(wallet.reservedBalance.toDecimalString()).toBe('0');
    expect(wallet.availableBalance.toDecimalString()).toBe('20');
  });

  it('rejects capturing more than the reserved balance', () => {
    const wallet = createWallet();
    wallet.reserve(amount('20'));

    expect(() => wallet.captureReserved(amount('21'))).toThrow(
      InsufficientReservedBalanceError,
    );
  });

  it('leaves balances untouched when an operation is rejected', () => {
    const wallet = createWallet();
    wallet.reserve(amount('80'));

    expect(() => wallet.captureReserved(amount('81'))).toThrow(
      InsufficientReservedBalanceError,
    );

    expect(wallet.balance.toDecimalString()).toBe('100');
    expect(wallet.reservedBalance.toDecimalString()).toBe('80');
    expect(wallet.availableBalance.toDecimalString()).toBe('20');
  });

  it('reconstitutes valid persisted balance state', () => {
    const wallet = WalletAccount.reconstitute({
      id: 'wallet-1',
      userId: 'user-123',
      asset: Assets.USDT,
      balance: amount('100'),
      reservedBalance: amount('80'),
    });

    wallet.captureReserved(amount('80'));

    expect(wallet.balance.toDecimalString()).toBe('20');
  });
});
