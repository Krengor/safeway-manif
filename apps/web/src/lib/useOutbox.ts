import type { PublicEvent } from '@safeway/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from './api';
import { flushOutbox, type NewOutboxItem, type OutboxItem, type SendResult } from './outbox';

const RETRY_INTERVAL_MS = 15_000;

async function send(item: OutboxItem): Promise<SendResult> {
  try {
    if (item.kind === 'report') return { ok: true, event: (await api.report(item.body)).event };
    const res = item.vote === 1 ? await api.confirm(item.eventId, item.presenceCell) : await api.invalidate(item.eventId, item.presenceCell);
    return { ok: true, event: res.event };
  } catch (err) {
    // Réseau absent ou serveur saturé : on réessaiera. Refus explicite (4xx) : abandon.
    const retry = !(err instanceof ApiRequestError) || err.status === 0 || err.status === 429 || err.status >= 500;
    return { ok: false, retry };
  }
}

/** Envois en attente, en mémoire uniquement. */
export function useOutbox(onSent: (event: PublicEvent | null, item: OutboxItem) => void) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;
  const flushing = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current || itemsRef.current.length === 0) return;
    flushing.current = true;
    try {
      const snapshot = itemsRef.current;
      const result = await flushOutbox(snapshot, send, Date.now());
      for (const { item, event } of result.sent) onSentRef.current(event, item);
      const done = new Set([...result.sent.map((s) => s.item.id), ...result.dropped.map((d) => d.id)]);
      // Les éléments ajoutés pendant l'envoi sont conservés.
      setItems((current) => current.filter((i) => !done.has(i.id)));
    } finally {
      flushing.current = false;
    }
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const timer = setInterval(() => void flush(), RETRY_INTERVAL_MS);
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [items.length, flush]);

  return {
    pending: items.length,
    add: useCallback((item: NewOutboxItem) => {
      setItems((current) => [...current, { ...item, id: crypto.randomUUID(), createdAt: Date.now() } as OutboxItem]);
    }, []),
    clear: useCallback(() => setItems([]), []),
  };
}

/** Le navigateur se croit-il en ligne ? (indicatif : un réseau saturé peut se dire « en ligne ») */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
