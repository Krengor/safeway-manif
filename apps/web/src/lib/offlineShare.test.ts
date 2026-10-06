import { eventSigningPayload, type PublicEvent } from '@safeway/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_PACKET_CHARS, buildSharePacket, readSharePacket } from './offlineShare';

const NOW = 1_800_000_000;
let keys: CryptoKeyPair;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
});

async function signed(partial: Partial<PublicEvent> = {}): Promise<PublicEvent> {
  const event: PublicEvent = {
    id: crypto.randomUUID(),
    type: 'PASSAGE_BLOQUE',
    cell: '8a1f82880b9ffff',
    conf: 2,
    inv: 0,
    supportW: 2,
    againstW: 0,
    createdAt: NOW - 60,
    lastConfAt: NOW - 30,
    expiresAt: NOW + 600,
    rev: 3,
    ...partial,
  };
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(eventSigningPayload(event)));
  return { ...event, sig: Buffer.from(sig).toString('base64url') };
}

describe('partage hors réseau', () => {
  it('transmet des signalements signés, vérifiés à la réception', async () => {
    const events = [await signed(), await signed({ type: 'GAZ_FUMEE' })];
    const { packet, included } = await buildSharePacket(events, [], NOW);
    expect(included).toBe(2);
    const received = await readSharePacket(packet, keys.publicKey, NOW);
    expect(received.verified.map((e) => e.id).sort()).toEqual(events.map((e) => e.id).sort());
    expect(received.rejected).toBe(0);
  });

  it('écarte un signalement falsifié ou signé par une autre clé', async () => {
    const forged = { ...(await signed()), conf: 99 };
    const { packet } = await buildSharePacket([forged], [], NOW);
    const received = await readSharePacket(packet, keys.publicKey, NOW);
    expect(received.verified).toEqual([]);
    expect(received.rejected).toBe(1);

    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const genuine = await buildSharePacket([await signed()], [], NOW);
    expect((await readSharePacket(genuine.packet, other.publicKey, NOW)).verified).toEqual([]);
  });

  it('marque « non vérifiés » les signalements faits hors réseau par l’émetteur', async () => {
    const { packet, unverified } = await buildSharePacket([], [{ type: 'FOULE_DENSE', cell: '8a1f82880b9ffff', createdAt: NOW - 30 }], NOW);
    expect(unverified).toBe(1);
    const received = await readSharePacket(packet, keys.publicKey, NOW);
    expect(received.unverified).toHaveLength(1);
    expect(received.unverified[0]).toMatchObject({ type: 'FOULE_DENSE', unverified: true });
  });

  it("n'envoie ni ne garde ce qui a expiré", async () => {
    const { included } = await buildSharePacket([await signed({ expiresAt: NOW - 1 })], [], NOW);
    expect(included).toBe(0);
  });

  it('tient dans un QR code même avec beaucoup de signalements (dangers en priorité)', async () => {
    const events: PublicEvent[] = [];
    for (let i = 0; i < 80; i++) events.push(await signed({ type: i % 2 ? 'PASSAGE_LIBRE' : 'INCENDIE' }));
    const { packet, included } = await buildSharePacket(events, [], NOW);
    expect(packet.length).toBeLessThanOrEqual(MAX_PACKET_CHARS);
    expect(included).toBeGreaterThan(5);
    const received = await readSharePacket(packet, keys.publicKey, NOW);
    expect(received.verified.every((e) => e.type === 'INCENDIE')).toBe(true);
  });
});
