import { describe, expect, it } from 'vitest';
import { OUTBOX_MAX_AGE_MS, flushOutbox, type OutboxItem, type SendResult } from './outbox';

const NOW = 1_000_000_000;
const report = (id: string, ageMs = 0): OutboxItem => ({
  id,
  kind: 'report',
  body: { type: 'GAZ_FUMEE', cell: 'c', presenceCell: 'c' },
  createdAt: NOW - ageMs,
});

describe('flushOutbox', () => {
  it('envoie tout quand le réseau est revenu', async () => {
    const res = await flushOutbox([report('a'), report('b')], async () => ({ ok: true, event: null }), NOW);
    expect(res.sent.map((s) => s.item.id)).toEqual(['a', 'b']);
    expect(res.remaining).toEqual([]);
  });

  it("s'arrête au premier échec réseau et garde le reste dans l'ordre", async () => {
    const calls: string[] = [];
    const send = async (item: OutboxItem): Promise<SendResult> => {
      calls.push(item.id);
      return { ok: false, retry: true };
    };
    const res = await flushOutbox([report('a'), report('b'), report('c')], send, NOW);
    expect(calls).toEqual(['a']);
    expect(res.remaining.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('abandonne un élément refusé par le serveur sans bloquer les suivants', async () => {
    const send = async (item: OutboxItem): Promise<SendResult> =>
      item.id === 'a' ? { ok: false, retry: false } : { ok: true, event: null };
    const res = await flushOutbox([report('a'), report('b')], send, NOW);
    expect(res.dropped.map((i) => i.id)).toEqual(['a']);
    expect(res.sent.map((s) => s.item.id)).toEqual(['b']);
  });

  it('abandonne sans envoyer une information devenue trop ancienne', async () => {
    let calls = 0;
    const res = await flushOutbox(
      [report('old', OUTBOX_MAX_AGE_MS + 1)],
      async () => {
        calls++;
        return { ok: true, event: null };
      },
      NOW,
    );
    expect(calls).toBe(0);
    expect(res.dropped).toHaveLength(1);
  });
});
