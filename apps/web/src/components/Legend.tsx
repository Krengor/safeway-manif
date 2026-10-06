const ITEMS = [
  { tone: 'bg-ok', icon: '✓', label: 'Passage confirmé' },
  { tone: 'bg-warn', icon: '?', label: 'Incertain' },
  { tone: 'bg-danger', icon: '!', label: 'Danger / blocage' },
  { tone: 'bg-unknown', icon: '·', label: 'Pas d’info récente' },
];

/** Légende : chaque couleur est doublée d'un symbole et d'un texte (§25). */
export function Legend() {
  return (
    <ul className="pointer-events-auto flex flex-wrap gap-x-3 gap-y-1 rounded-xl bg-panel/95 px-3 py-2 text-xs font-semibold shadow" aria-label="Légende">
      {ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white ${item.tone}`}>
            {item.icon}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
