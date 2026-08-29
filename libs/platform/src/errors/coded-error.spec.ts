import { CodedError, isCodedError, isRetryable } from './coded-error.js';
import { errorCode, errorMessage } from './error-context.js';

class SomethingBroke extends CodedError {
  readonly code = 'SOMETHING_BROKE' as const;
}

class ProviderDidNotAnswer extends CodedError {
  readonly code = 'PROVIDER_DID_NOT_ANSWER' as const;
  override readonly retryable = true;
}

describe('CodedError', () => {
  it('derives its name from the class instead of restating it', () => {
    expect(new SomethingBroke('boom').name).toBe('SomethingBroke');
  });

  it('is still an Error, so existing catch sites and stacks are unaffected', () => {
    const error = new SomethingBroke('boom');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
    expect(error.stack).toContain('SomethingBroke');
  });

  it('carries a cause through', () => {
    const cause = new Error('socket hang up');

    expect(new SomethingBroke('boom', { cause }).cause).toBe(cause);
  });

  describe('retryability', () => {
    /**
     * The default matters more than the exception: application and domain
     * failures are deterministic, so retrying one spends the whole backoff
     * budget re-deriving the same verdict.
     */
    it('treats our own failures as final unless they say otherwise', () => {
      expect(isRetryable(new SomethingBroke('boom'))).toBe(false);
      expect(isRetryable(new ProviderDidNotAnswer('unknown'))).toBe(true);
    });

    /**
     * The inverse, and the case the previous hand-maintained code set could not
     * express: anything that is not ours carries no verdict at all, and the
     * transient conditions redelivery exists for all arrive this way.
     */
    it('treats everything else as worth retrying', () => {
      expect(isRetryable(new Error('connection terminated'))).toBe(true);
      expect(isRetryable(Object.assign(new Error('pg'), { code: '57014' }))).toBe(
        true,
      );
      expect(isRetryable('a thrown string')).toBe(true);
      expect(isRetryable(undefined)).toBe(true);
    });
  });

  it('narrows with isCodedError', () => {
    expect(isCodedError(new SomethingBroke('boom'))).toBe(true);
    expect(isCodedError(new Error('boom'))).toBe(false);
    expect(isCodedError({ code: 'LOOKS_LIKE_ONE' })).toBe(false);
  });
});

describe('error context', () => {
  it('prefers a code over a class name', () => {
    expect(errorCode(new SomethingBroke('boom'))).toBe('SOMETHING_BROKE');
  });

  /**
   * The reason this helper exists: `pg` errors carry a driver code, and reading
   * `.name` alone yields the literal string "error" for every one of them.
   */
  it('reads the driver code off a pg error', () => {
    expect(errorCode(Object.assign(new Error('canceled'), { code: '57014' }))).toBe(
      '57014',
    );
  });

  it('falls back to the class name, then to a marker', () => {
    expect(errorCode(new TypeError('nope'))).toBe('TypeError');
    expect(errorCode('a thrown string')).toBe('UNKNOWN_ERROR');
    expect(errorCode(undefined)).toBe('UNKNOWN_ERROR');
  });

  it('stringifies a non-Error rather than losing it', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('a thrown string')).toBe('a thrown string');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
