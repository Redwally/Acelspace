# ACE SPACE — Charte Technique & Artistique / Agent.md

Ce fichier documente la direction artistique (DA), les spécifications techniques et les bonnes pratiques du site vitrine **ACE SPACE**.
Toute modification, nouvelle section ou composant doit respecter ces règles pour garantir la cohérence visuelle et technique.

---

## 1. Stack Technique & Architecture

- **Bundler & Dev Server** : Vite 8+
- **CSS** : Tailwind CSS v4 (`@tailwindcss/vite`) + Google Fonts (Inter)
- **Logique UI & État réactif** : Alpine.js v3
- **Structure des fichiers** :
  - [`index.html`](file:///c:/Users/lucas/Desktop/acelspaces/index.html) : Structure HTML sémantique, modals et critical CSS anti-FOUC dans `<head>`.
  - [`src/app.js`](file:///c:/Users/lucas/Desktop/acelspaces/src/app.js) : Données produits et composant Alpine `merchApp()` (recherche, modals, navigation).
  - [`src/style.css`](file:///c:/Users/lucas/Desktop/acelspaces/src/style.css) : Import Tailwind v4, `@theme`, classes utilitaires (`.card-border`, `.pill-border`, `.bg-blueprint-grid`) et animation fusée.
  - [`src/main.js`](file:///c:/Users/lucas/Desktop/acelspaces/src/main.js) : Point d'entrée Vite (imports).

---

## 2. Palette de couleurs

| Usage | Rôle / Classe Tailwind | Hex / Valeur |
|---|---|---|
| Fond de page (grille blueprint) | `bg-grid-bg` / `.bg-blueprint-grid` | `#bce0ec` |
| Lignes du quadrillage | Fond dégradé CSS (cases 24×24px) | `rgba(135, 195, 215, 0.65)` |
| Fond des cartes/blocs | `bg-card-bg` | `#f6f3eb` |
| Bordures (toutes) | `border-dark-border` / `border-slate-900` | `#111827` |
| Texte principal | `text-slate-900` | `#111827` |
| Texte secondaire / descriptif | `text-slate-700` | `#334155` |
| Logo (accents bleus) | `logo-blue` / `logo-light` | `#5e8297` / `#87b8cb` |

**Règle stricte** : Tous les blocs et cartes sont en beige/crème (`#f6f3eb`). Le bleu est strictement réservé au quadrillage de fond et aux détails du logo SVG.

---

## 3. Typographie

- **Famille** : `Inter`, fallback `system-ui, -apple-system, sans-serif`
- **Titres (H1, "CLUB", badges)** : `font-black` (900), majuscules, `tracking-tight`
- **Noms de produits / navigation** : `font-bold` à `font-black`, majuscules
- **Descriptions courantes** : `font-bold` / `font-medium`, casse normale
- **Prix** : `font-black`, `text-slate-900`

---

## 4. Style des blocs & Cartes produits

- **Fond** : `#f6f3eb` (`bg-card-bg`)
- **Bordures** : `2.5px solid #111827`, coins arrondis `border-radius: 8px` (classe `.card-border`)
- **Style néo-brutaliste** : Pas d'ombres portées diffuses ni de dégradés sur les blocs.
- **Cartes produits** :
  - **Zone image** : Hauteur fixe définie (`h-60 sm:h-64`), avec bordure inférieure `border-b-2 border-slate-900`.
  - **Image** : `max-h-full max-w-full object-contain` avec léger drop-shadow pour préserver les proportions exactes du produit sans distorsion ni découpe.
  - **Zone d'information** : Titre + Prix à gauche, bouton "VOIR" à droite.

---

## 5. Boutons & Micro-animations

### Bouton standard ("VOIR", "À propos", "Contact", icônes)
- Fond : `#f6f3eb`
- Bordure : `2px solid #111827`, arrondi `border-radius: 6px` (classe `.pill-border`)
- Texte : `font-bold`, majuscules, `text-xs` / `text-sm`
- **Au survol** : Inversion complète (fond `#111827`, texte blanc).
- **Animation Fusée Tintin** : Sur les boutons "VOIR" des cartes produits, le survol déclenche l'animation `@keyframes flyTintinRocket` qui fait défiler une petite fusée stylisée à travers le bouton.

```html
<button class="group/btn relative overflow-hidden px-4 py-2 bg-card-bg pill-border hover:bg-slate-900 hover:text-white font-bold text-xs uppercase transition-colors">
    <span class="relative z-10 transition-opacity group-hover/btn:opacity-20">VOIR</span>
    <div class="rocket-fly absolute inset-y-0 left-0 flex items-center pointer-events-none -translate-x-full">
        <!-- SVG Fusée -->
    </div>
</button>
```

---

## 6. Grille & Mise en page Responsive

- **Conteneur principal** : `max-w-[1680px]` centré avec espacement vertical fluide (`gap-6 sm:gap-8`). Pas de verrouillage de hauteur forcée (`lg:h-screen`) afin d'éviter tout écrasement ou chevauchement de cartes.
- **Header (Ligne 1)** : Logo club à gauche (`col-span-4`), navigation & recherche dépliable à droite (`col-span-8`).
- **Hero & Produit Vedette (Ligne 2)** :
  - Bloc texte "REP THE VIBE." (`col-span-8`)
  - Carte produit vedette (`col-span-4`, ex: GREY LOGO TEE)
- **Grille de produits (Ligne 3)** : `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (4 colonnes sur grand écran pour un alignement propre de tous les articles).
- **Footer (Ligne 4)** : Copyright à gauche, liens et réseaux sociaux sécurisés (`target="_blank" rel="noopener noreferrer"`) à droite.

---

## 7. Prévention du FOUC (Flash of Unstyled Content)

- `<link rel="stylesheet" href="/src/style.css">` inclus directement dans le `<head>`.
- `[x-cloak] { display: none !important; }` et styles critiques pour `.logo-container` et `svg` injectés en `<style>` inline dans le `<head>` pour garantir qu'aucun logo géant ou modale ne saute au chargement.

---

## 8. Données Produits & Modales

- Chaque produit possède : `id`, `name`, `price`, `image` (haute résolution sans fond blanc rigide), `description`, `sizes`.
- Pour les accessoires / objets sans taille vestimentaire (ex: clé USB, bonnet), toujours utiliser `sizes: ['Taille unique']` plutôt que des valeurs vides ou `"none"`.
- Site vitrine uniquement : pas de panier d'achat, le bouton de commande redirige vers la modale Contact du club.

---

## 9. Checklist avant d'ajouter ou modifier un élément

- [ ] Fond `#f6f3eb` (`bg-card-bg`) pour les blocs de contenu
- [ ] Bordure nette `2px` ou `2.5px solid #111827` (`.pill-border` ou `.card-border`)
- [ ] Typographie Inter, majuscules pour les titres et labels
- [ ] Hauteurs d'images explicites pour éviter tout écrasement Flexbox
- [ ] Accessoires configurés avec `sizes: ['Taille unique']`
- [ ] Zero FOUC / pas de dépendance synchrone cassée
- [ ] `npm run build` passe avec 0 erreur et 0 warning