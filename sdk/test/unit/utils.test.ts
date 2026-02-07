/**
 * SDK Utilities Unit Tests
 *
 * Tests for USDC formatting, timestamp conversion, and elapsed time calculation.
 * These are critical financial utilities — correctness is essential.
 */

import { describe, it, expect } from 'vitest';
import { parseUSDC, formatUSDC, toUnixTimestamp, calculateElapsedTime } from '../../src/utils.js';

// =============================================================================
// parseUSDC Tests
// =============================================================================

describe('parseUSDC', () => {
  it('should parse whole USDC amounts', () => {
    expect(parseUSDC('100')).toBe(100_000_000n);
    expect(parseUSDC('1')).toBe(1_000_000n);
    expect(parseUSDC('0')).toBe(0n);
  });

  it('should parse fractional USDC amounts', () => {
    expect(parseUSDC('100.50')).toBe(100_500_000n);
    expect(parseUSDC('0.01')).toBe(10_000n);
    expect(parseUSDC('0.000001')).toBe(1n); // smallest unit
  });

  it('should parse large amounts', () => {
    expect(parseUSDC('1000000')).toBe(1_000_000_000_000n); // 1M USDC
    expect(parseUSDC('10000')).toBe(10_000_000_000n); // reference stake
  });

  it('should handle zero correctly', () => {
    expect(parseUSDC('0')).toBe(0n);
    expect(parseUSDC('0.00')).toBe(0n);
    expect(parseUSDC('0.000000')).toBe(0n);
  });
});

// =============================================================================
// formatUSDC Tests
// =============================================================================

describe('formatUSDC', () => {
  it('should format whole amounts', () => {
    expect(formatUSDC(100_000_000n)).toBe('100');
    expect(formatUSDC(1_000_000n)).toBe('1');
  });

  it('should format fractional amounts', () => {
    expect(formatUSDC(100_500_000n)).toBe('100.5');
    expect(formatUSDC(10_000n)).toBe('0.01');
    expect(formatUSDC(1n)).toBe('0.000001');
  });

  it('should format zero', () => {
    expect(formatUSDC(0n)).toBe('0');
  });

  it('should roundtrip with parseUSDC', () => {
    const amounts = ['100', '0.01', '10000', '0.000001', '999.999999'];
    for (const amount of amounts) {
      const parsed = parseUSDC(amount);
      const formatted = formatUSDC(parsed);
      // Parse again to normalize (e.g., "100" -> "100" not "100.000000")
      expect(parseUSDC(formatted)).toBe(parsed);
    }
  });
});

// =============================================================================
// toUnixTimestamp Tests
// =============================================================================

describe('toUnixTimestamp', () => {
  it('should convert Date object to Unix timestamp', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const expected = BigInt(Math.floor(date.getTime() / 1000));
    expect(toUnixTimestamp(date)).toBe(expected);
  });

  it('should convert milliseconds to seconds', () => {
    // Timestamp in milliseconds (> 1e12)
    const ms = 1735689600000; // 2025-01-01 00:00:00 UTC
    const expectedSeconds = BigInt(Math.floor(ms / 1000));
    expect(toUnixTimestamp(ms)).toBe(expectedSeconds);
  });

  it('should pass through seconds as-is', () => {
    // Timestamp in seconds (< 1e12)
    const seconds = 1735689600; // 2025-01-01 00:00:00 UTC
    expect(toUnixTimestamp(seconds)).toBe(BigInt(seconds));
  });

  it('should handle boundary between ms and seconds heuristic', () => {
    // Values around 1e12 threshold
    const justBelowMs = 999_999_999_999; // < 1e12, treated as seconds
    expect(toUnixTimestamp(justBelowMs)).toBe(BigInt(justBelowMs));

    const justAboveMs = 1_000_000_000_001; // > 1e12, treated as ms
    expect(toUnixTimestamp(justAboveMs)).toBe(BigInt(Math.floor(justAboveMs / 1000)));
  });

  it('should handle current time', () => {
    const now = Date.now();
    const result = toUnixTimestamp(now);
    const expected = BigInt(Math.floor(now / 1000));
    expect(result).toBe(expected);
  });
});

// =============================================================================
// calculateElapsedTime Tests
// =============================================================================

describe('calculateElapsedTime', () => {
  it('should return 0 before start time', () => {
    const startTime = 1000n;
    const endTime = 2000n;
    const now = 500n; // before start

    expect(calculateElapsedTime(startTime, endTime, now)).toBe(0n);
  });

  it('should return full duration after end time', () => {
    const startTime = 1000n;
    const endTime = 2000n;
    const now = 3000n; // after end

    expect(calculateElapsedTime(startTime, endTime, now)).toBe(1000n); // endTime - startTime
  });

  it('should return elapsed time during the window', () => {
    const startTime = 1000n;
    const endTime = 2000n;
    const now = 1500n; // midpoint

    expect(calculateElapsedTime(startTime, endTime, now)).toBe(500n);
  });

  it('should return 0 at exactly start time', () => {
    const startTime = 1000n;
    const endTime = 2000n;

    expect(calculateElapsedTime(startTime, endTime, startTime)).toBe(0n);
  });

  it('should return full duration at exactly end time', () => {
    const startTime = 1000n;
    const endTime = 2000n;

    // At exactly endTime, currentTime > endTime is false, so it returns endTime - startTime = elapsed
    // Actually, currentTime === endTime means currentTime is NOT > endTime, so: currentTime - startTime = 1000n
    expect(calculateElapsedTime(startTime, endTime, endTime)).toBe(1000n);
  });

  it('should handle zero-duration window', () => {
    const startTime = 1000n;
    const endTime = 1000n; // zero duration

    // Before: returns 0
    expect(calculateElapsedTime(startTime, endTime, 500n)).toBe(0n);
    // At/after: returns 0 (endTime - startTime = 0)
    expect(calculateElapsedTime(startTime, endTime, 1000n)).toBe(0n);
    expect(calculateElapsedTime(startTime, endTime, 2000n)).toBe(0n);
  });

  it('should use current time when now is not provided', () => {
    const startTime = 0n; // epoch start
    const endTime = BigInt(Math.floor(Date.now() / 1000)) + 3600n; // 1 hour from now

    const elapsed = calculateElapsedTime(startTime, endTime);
    const expectedApprox = BigInt(Math.floor(Date.now() / 1000));

    // Should be close to current time (within 2 seconds tolerance)
    expect(elapsed).toBeGreaterThan(expectedApprox - 2n);
    expect(elapsed).toBeLessThan(expectedApprox + 2n);
  });
});
