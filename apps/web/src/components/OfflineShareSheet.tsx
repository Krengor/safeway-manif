import type { PublicEvent } from '@safeway/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { buildSharePacket, shareUrl, type PendingShare } from '../lib/offlineShare';
import { Sheet } from './Sheet';

interface Props {
  events: PublicEvent[];
  pending: PendingShare[];
  now: number;
  onClose(): void;
}

/**
 * Mode partage hors réseau : un QR code à faire scanner par l'appareil photo d'un autre
 * téléphone, ou le partage du système (AirDrop, Quick Share, Bluetooth…) qui marche sans réseau.
 */
export function OfflineShareSheet({ events, pending, now, onClose }: Props) {
  const [share, setShare] = useState<{ url: string; qr: string; included: number; unverified: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const built = await buildSharePacket(events, pending, now);
        const url = shareUrl(built.packet);
        const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: 'L', margin: 2, width: 560 });
        if (!cancelled) setShare({ url, qr, included: built.included, unverified: built.unverified });
      } catch {
        if (!cancelled) setError('Impossible de préparer le partage sur ce téléphone.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Instantané au moment de l'ouverture : on ne régénère pas le QR pendant qu'il est scanné.
  }, []);

  const systemShare = async () => {
    if (!share) return;
    try {
      await navigator.share({ title: 'SafeWay — signalements', text: 'Signalements SafeWay récents (partage hors réseau)', url: share.url });
    } catch {
      /* partage annulé */
    }
  };

  return (
    <Sheet title="📡 Partage hors réseau" onClose={onClose}>
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}
      {!share && !error && <p>Préparation…</p>}
      {share && (
        <div className="flex flex-col gap-3">
          {share.included === 0 ? (
            <p className="font-semibold">Aucun signalement récent à partager pour l'instant.</p>
          ) : (
            <>
              <p className="text-sm">
                <strong>{share.included}</strong> signalement{share.included > 1 ? 's' : ''} récent{share.included > 1 ? 's' : ''}
                {share.unverified > 0 && ` dont ${share.unverified} fait${share.unverified > 1 ? 's' : ''} sans réseau (non vérifiés)`}.
              </p>
              <img
                src={share.qr}
                alt="QR code contenant les signalements récents, à scanner avec l'appareil photo d'un autre téléphone"
                className="mx-auto w-full max-w-72 rounded-xl bg-white p-2"
              />
              <p className="text-sm text-muted">
                L'autre personne scanne ce code avec <strong>l'appareil photo</strong> de son téléphone : SafeWay s'ouvre
                et ajoute les signalements, même sans réseau (il faut avoir déjà ouvert SafeWay une fois).
              </p>
              {'share' in navigator && (
                <button type="button" onClick={() => void systemShare()} className="min-h-12 rounded-xl bg-accent font-bold text-accent-fg">
                  Partager via AirDrop, Quick Share, Bluetooth…
                </button>
              )}
              <p className="text-xs text-muted">
                Contenu : signalements publics uniquement (type, zone ~70 m, heure). Les signalements non signés par le
                serveur s'afficheront « non vérifiés » chez la personne qui les reçoit.
              </p>
            </>
          )}
        </div>
      )}
      <div className="h-3" />
    </Sheet>
  );
}
