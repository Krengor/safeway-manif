interface Props {
  onClose(): void;
}

/** Écran « Confidentialité » (§37) : ce que l'app fait, ne fait pas, et ses limites. */
export function PrivacyScreen({ onClose }: Props) {
  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-full max-w-md flex-col gap-5 px-4">
      <button type="button" onClick={onClose} className="self-start py-2 font-semibold text-muted">
        ← Retour à la carte
      </button>
      <h1 className="text-2xl font-bold">Confidentialité</h1>

      <section>
        <h2 className="mb-1 text-lg font-bold">Votre position</h2>
        <p>
          SafeWay utilise votre position uniquement pendant le Mode Manif pour afficher votre environnement et vérifier
          les informations proches. Votre position GPS brute n'est pas conservée et votre déplacement n'est pas
          enregistré.
        </p>
        <p className="mt-2 text-muted">
          Concrètement, les coordonnées restent sur votre téléphone. Seule une zone d'environ 70 m est envoyée au moment
          où vous signalez ou confirmez, pour vérifier que vous êtes sur place, puis oubliée.
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">Ce que nous conservons</h2>
        <ul className="list-disc pl-5">
          <li>Votre pseudo et la clé publique de votre passkey.</li>
          <li>Les signalements, sans auteur, supprimés quelques minutes après expiration.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">Ce que nous ne conservons jamais</h2>
        <ul className="list-disc pl-5">
          <li>Nom, e-mail, téléphone, contacts.</li>
          <li>Historique GPS, trajets, liste de participants.</li>
          <li>Adresse IP dans les journaux, traqueurs publicitaires.</li>
        </ul>
      </section>

      <section className="rounded-xl border-2 border-warn p-3">
        <h2 className="mb-1 text-lg font-bold">Limites</h2>
        <p>
          Les informations sont fournies par la communauté et peuvent être incomplètes, anciennes ou incorrectes. Aucun
          itinéraire n'est garanti « sûr ».
        </p>
      </section>

      <p className="text-sm text-muted">
        Le code source est public et auditable. Vous pouvez supprimer votre compte à tout moment depuis l'écran Compte.
      </p>
    </main>
  );
}
