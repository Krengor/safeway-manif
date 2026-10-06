import type { PublicEvent, ServerMessage } from '@safeway/shared';
import { describe, expect, it } from 'vitest';
import { CLOSE_TOO_SLOW, Hub, type HubClient } from '../src/hub.js';

function fakeClient(buffered = 0) {
  const sent: ServerMessage[] = [];
  const raw: string[] = [];
  const client: HubClient & { sent: ServerMessage[]; raw: string[]; closedWith: number | null } = {
    sent,
    raw,
    closedWith: null,
    bufferedAmount: buffered,
    send(data) {
      raw.push(data);
      sent.push(JSON.parse(data) as ServerMessage);
    },
    close(code) {
      this.closedWith = code;
    },
  };
  return client;
}

function fakeBus() {
  const active = new Set<string>();
  return {
    active,
    subscribe: (zone: string) => active.add(zone),
    unsubscribe: (zone: string) => active.delete(zone),
  };
}

const ev = (id: string, rev: number): PublicEvent => ({
  id,
  type: 'PASSAGE_BLOQUE',
  cell: '8a1f82880b9ffff',
  conf: rev,
  inv: 0,
  supportW: rev,
  againstW: 0,
  createdAt: 0,
  lastConfAt: 0,
  expiresAt: 9e9,
  rev,
});

const options = { batchMs: 250, maxBufferedBytes: 1000 };

describe('Hub', () => {
  it("ne s'abonne au bus que pour les zones suivies, et se désabonne quand plus personne ne suit", () => {
    const bus = fakeBus();
    const hub = new Hub(bus, options);
    const a = fakeClient();
    const b = fakeClient();
    hub.setZones(a, ['Z1', 'Z2']);
    hub.setZones(b, ['Z2']);
    expect([...bus.active].sort()).toEqual(['Z1', 'Z2']);
    hub.setZones(a, ['Z3']);
    expect([...bus.active].sort()).toEqual(['Z2', 'Z3']);
    hub.removeClient(b);
    expect([...bus.active]).toEqual(['Z3']);
  });

  it("n'envoie qu'aux abonnés de la zone", () => {
    const hub = new Hub(fakeBus(), options);
    const a = fakeClient();
    const b = fakeClient();
    hub.setZones(a, ['Z1']);
    hub.setZones(b, ['Z2']);
    hub.dispatch('Z1', { event: ev('e1', 1) });
    hub.flush();
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(0);
  });

  it('regroupe les changements et ne garde que la révision la plus haute', () => {
    const hub = new Hub(fakeBus(), options);
    const a = fakeClient();
    hub.setZones(a, ['Z1']);
    hub.dispatch('Z1', { event: ev('e1', 1) });
    hub.dispatch('Z1', { event: ev('e1', 3) });
    hub.dispatch('Z1', { event: ev('e1', 2) }); // arrivée désordonnée
    hub.dispatch('Z1', { event: ev('e2', 1) });
    hub.flush();
    expect(a.sent).toEqual([
      { t: 'upd', zone: 'Z1', events: [ev('e1', 3), ev('e2', 1)], removed: [] },
    ]);
  });

  it('un retrait annule une mise à jour en attente', () => {
    const hub = new Hub(fakeBus(), options);
    const a = fakeClient();
    hub.setZones(a, ['Z1']);
    hub.dispatch('Z1', { event: ev('e1', 1) });
    hub.dispatch('Z1', { removed: 'e1' });
    hub.flush();
    expect(a.sent).toEqual([{ t: 'upd', zone: 'Z1', events: [], removed: ['e1'] }]);
  });

  it('sérialise une seule fois par zone pour tous les abonnés', () => {
    const hub = new Hub(fakeBus(), options);
    const clients = Array.from({ length: 50 }, () => fakeClient());
    for (const c of clients) hub.setZones(c, ['Z1']);
    hub.dispatch('Z1', { event: ev('e1', 1) });
    hub.flush();
    const first = clients[0]!.raw[0];
    expect(clients.every((c) => c.raw[0] === first)).toBe(true);
  });

  it('déconnecte un client trop lent sans bloquer les autres', () => {
    const hub = new Hub(fakeBus(), options);
    const slow = fakeClient(5000);
    const fast = fakeClient();
    hub.setZones(slow, ['Z1']);
    hub.setZones(fast, ['Z1']);
    hub.dispatch('Z1', { event: ev('e1', 1) });
    hub.flush();
    expect(slow.closedWith).toBe(CLOSE_TOO_SLOW);
    expect(slow.sent).toHaveLength(0);
    expect(fast.sent).toHaveLength(1);
    expect(hub.stats.clients).toBe(1);
  });

  it('ignore les messages de zones sans abonnés', () => {
    const hub = new Hub(fakeBus(), options);
    hub.dispatch('Z9', { event: ev('e1', 1) });
    hub.flush();
    expect(hub.stats).toEqual({ clients: 0, zones: 0 });
  });
});
