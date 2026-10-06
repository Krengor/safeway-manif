/**
 * Mode Manif (cahier §4, §14).
 *
 * - Le GPS n'est demandé qu'à l'activation, jamais au chargement de l'app.
 * - Les coordonnées vivent uniquement en mémoire (pas de localStorage, pas d'IndexedDB).
 * - Seule la cellule H3 dérivée (≈ 66 m) est exposée au reste de l'application ;
 *   la position précise ne sert qu'à dessiner le point « vous êtes ici » localement.
 * - À la désactivation : arrêt du suivi et effacement des coordonnées.
 */
import { toEventCell } from '@safeway/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export type GeoState = 'off' | 'locating' | 'on' | 'denied' | 'unavailable';

export interface LocalPosition {
  lng: number;
  lat: number;
}

export function useManifMode() {
  const [state, setState] = useState<GeoState>('off');
  const [cell, setCell] = useState<string | null>(null);
  // Position précise : uniquement pour l'affichage local. Jamais envoyée.
  const [position, setPosition] = useState<LocalPosition | null>(null);
  const watchId = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setPosition(null);
    setCell(null);
    setState('off');
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState('unavailable');
      return;
    }
    setState('locating');
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setPosition({ lat: latitude, lng: longitude });
        setCell(toEventCell(latitude, longitude));
        setState('on');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stop();
          setState('denied');
        }
        // Timeout / position indisponible : on garde la dernière cellule connue.
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [stop]);

  useEffect(() => stop, [stop]);

  // Fermeture de l'onglet / mise en arrière-plan prolongée : rien n'est persisté de toute façon.
  return { state, active: state === 'on' || state === 'locating', cell, position, start, stop };
}
