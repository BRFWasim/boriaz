# Maison Liora

Site vitrine d'un institut de beauté premium à Paris 7e. Accueil cinématographique, carte des soins, tarifs, présentation de la maison et demande de rendez-vous.

Le brief Word d'origine n'était pas lisible depuis l'environnement de développement : le site a été conçu comme une maison confidentielle (soins visage, corps, regard, manucure) avec une identité ivoire / espresso / champagne.

## Lancer en local

```bash
npm install
npm run dev
```

Le serveur écoute sur [http://127.0.0.1:4317](http://127.0.0.1:4317).

## Pages

- `/` — accueil, signatures, avis
- `/soins` — carte filtrable
- `/soins/[slug]` — détail d'un protocole
- `/carte` — tarifs
- `/institut` — esprit et équipe
- `/reserver` — demande de rendez-vous
- `/contact` — adresse, horaires, message

Les formulaires valident les champs côté client et simulent un envoi (aucune base de données, aucun secret requis).

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui.
