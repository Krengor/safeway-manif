import { leadingZeroBits, powMessage } from '@safeway/shared';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { solvePow } from './pow';

describe('solvePow', () => {
  it('trouve un nonce que le serveur acceptera', async () => {
    const solution = await solvePow({ challenge: 'defi-de-test-123456', difficulty: 10 });
    const hash = createHash('sha256').update(powMessage(solution.challenge, solution.nonce)).digest();
    expect(leadingZeroBits(hash)).toBeGreaterThanOrEqual(10);
  });

  it('peut être annulé', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(solvePow({ challenge: 'x'.repeat(20), difficulty: 30 }, controller.signal)).rejects.toThrow();
  });
});
