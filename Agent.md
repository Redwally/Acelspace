# AcelSpace — Charte Technique & Artistique / Agent.md

Ce fichier documente la direction artistique (DA), les spécifications techniques et les bonnes pratiques du site **AcelSpace**.
Toute modification, nouvelle section ou composant doit respecter ces règles pour garantir la cohérence visuelle et technique. En cas de doute, reproduire l'existant.

Nom de marque : **AcelSpace** (jamais "ACE SPACE"), dans les textes, titres, métadonnées et commentaires.

---

## 1. Stack Technique & Architecture

- **Bundler & Dev Server** : Vite 8+ (vanilla, pas de React/JSX)
- **CSS** : Tailwind CSS v4 (`@tailwindcss/vite`) + Google Fonts (Inter)
- **Logique UI & État réactif** : Alpine.js v3 (npm)
- **Backend** : Express + SQLite (`better-sqlite3`), dans `backend/`, séparé du front. En dev, Vite proxifie `/api` vers Express.
- **Structure des fichiers** :
  - `index.html` : structure HTML sémantique, modales et critical CSS anti-FOUC dans `<head>`.
  - `src/app.js` : données produits et composant Alpine `merchApp()` (recherche, modales, navigation, précommande).
  - `src/style.css` : import Tailwind v4, `@theme`, classes utilitaires (`.card-border`, `.pill-border`, `.bg-blueprint-grid`) et animation fusée.
  - `src/main.js` : point d'entrée Vite (imports).
  - `public/images/products/` : images produits, référencées par chemin local (`/images/products/xxx.jpg`), jamais par lien externe.
  - `backend/` : serveur, base de données et routes API.
- **Logo** : utiliser `logo-agrandi.svg` (viewBox resserré, fond transparent), pas l'ancien fichier au cadrage A4.
- Les pages d'administration et d'impression suivent la même DA (voir §10 et §11).

---

## 2. Palette de couleurs

| Usage | Rôle / Classe Tailwind | Hex / Valeur |
|---|---|---|
| Fond de page (grille blueprint) | `bg-grid-bg` / `.bg-blueprint-grid` | `#bce0ec` |
| Lignes du quadrillage | Fond dégradé CSS (cases 24×24px) | `rgba(135, 195, 215, 0.65)` |
| Fond des cartes/blocs/modales | `bg-card-bg` | `#f6f3eb` |
| Bordures (toutes) | `border-dark-border` / `border-slate-900` | `#111827` |
| Texte principal, prix, liens | `text-slate-900` | `#111827` |
| Texte secondaire / descriptif | `text-slate-700` | `#334155` |
| Logo (accents bleus) | `logo-blue` / `logo-light` | `#5e8297` / `#87b8cb` |

**Règles strictes** :
- Tous les blocs, cartes et modales sont en beige/crème (`#f6f3eb`). Le bleu est réservé au quadrillage de fond et aux détails du logo SVG.
- Pas de couleur vive pour le texte, les prix ou les liens (pas de bleu vif). Les liens sont en marine, simplement soulignés.
- Pas de rouge/vert vif pour les états : utiliser des variantes de la palette (fond marine + texte blanc, ou fond beige + bordure marine).

---

## 3. Typographie

- **Famille** : `Inter`, fallback `system-ui, -apple-system, sans-serif`. Aucune autre police.
- **Titres (H1, "CLUB", badges)** : `font-black` (900), majuscules, `tracking-tight`
- **Noms de produits / navigation / labels** : `font-bold` à `font-black`, majuscules
- **Descriptions courantes** : `font-bold` / `font-medium`, casse normale
- **Prix** : `font-black`, `text-slate-900`

---

## 4. Style des blocs & Cartes produits

- **Fond** : `#f6f3eb` (`bg-card-bg`)
- **Bordures** : `2.5px solid #111827`, coins arrondis `border-radius: 8px` (classe `.card-border`)
- **Style néo-brutaliste** : pas d'ombres portées diffuses ni de dégradés sur les blocs.
- **Cartes produits** :
  - **Zone image** : hauteur fixe définie (`h-60 sm:h-64`), avec bordure inférieure `border-b-2 border-slate-900`.
  - **Image** : `max-h-full max-w-full object-contain` avec léger drop-shadow pour préserver les proportions exactes du produit sans distorsion ni découpe.
  - **Zone d'information** : titre + prix à gauche, bouton "VOIR" à droite.

---

## 5. Boutons & Micro-animations

### Bouton standard ("VOIR", "À propos", "Contact", icônes)
- Fond : `#f6f3eb`
- Bordure : `2px solid #111827`, arrondi `border-radius: 6px` (classe `.pill-border`)
- Texte : `font-bold`, majuscules, `text-xs` / `text-sm`
- **Au survol** : inversion complète (fond `#111827`, texte blanc).
- **Action principale** (PRÉCOMMANDER, CONFIRMER) : même gabarit en variante pleine (fond marine, texte blanc).
- **État désactivé** : fond grisé, pas de hover, `cursor-not-allowed`.
- Ne jamais introduire une nouvelle couleur de bouton.
- **Animation Fusée Tintin** : sur les boutons "VOIR" des cartes produits, le survol déclenche l'animation `@keyframes flyTintinRocket` qui fait défiler une petite fusée stylisée à travers le bouton.

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
- **Header (Ligne 1)** : logo club à gauche (`col-span-4`), navigation & recherche dépliable à droite (`col-span-8`).
- **Hero & Produit Vedette (Ligne 2)** :
  - Bloc texte "REP THE VIBE." (`col-span-8`)
  - Carte produit vedette (`col-span-4`, ex : GREY LOGO TEE)
- **Grille de produits (Ligne 3)** : `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (4 colonnes sur grand écran pour un alignement propre de tous les articles).
- **Footer (Ligne 4)** : copyright à gauche, liens et réseaux sociaux sécurisés (`target="_blank" rel="noopener noreferrer"`) à droite.

---

## 7. Prévention du FOUC (Flash of Unstyled Content)

- `<link rel="stylesheet" href="/src/style.css">` inclus directement dans le `<head>`.
- `[x-cloak] { display: none !important; }` et styles critiques pour `.logo-container` et `svg` injectés en `<style>` inline dans le `<head>` pour garantir qu'aucun logo géant ou modale ne saute au chargement.

---

## 8. Données Produits & Modale produit

- Chaque produit possède : `id`, `name`, `price`, `image` (haute résolution sans fond blanc rigide), `description`, `sizes`. Le champ facultatif `detail_table_image` contient l’image du guide des tailles / formats affichée dans la fiche produit.
- Pour les accessoires / objets sans taille vestimentaire (ex : clé USB, bonnet), toujours utiliser `sizes: ['Taille unique']` plutôt que des valeurs vides ou `"none"`.
- Site vitrine : pas de panier ni de paiement en ligne. Le bouton PRÉCOMMANDER ouvre le formulaire dans la modale produit.

**Modale produit en 3 étapes** (state Alpine `step`, remis à 1 à chaque ouverture, transition `x-transition`) :
1. **Fiche produit** : image, nom, prix, description, tailles. Un seul bouton PRÉCOMMANDER.
2. **Formulaire** : mini-récap du produit (miniature + nom + prix), bouton RETOUR, champs, estimation du total, consentement, bouton de confirmation.
3. **Confirmation** : message de succès + bouton FERMER.

Ne pas remettre fiche produit et formulaire complet sur le même écran. Si précommandes fermées : le bouton PRÉCOMMANDER est remplacé par un bloc désactivé "PRÉCOMMANDES FERMÉES" avec le message de fermeture.

---

## 9. Précommande : règles fonctionnelles

- Champs collectés, et seulement ceux-là : nom et prénom, contact (email ou Instagram), taille, quantité, consentement. Ne rien ajouter (pas de téléphone, adresse, etc.).
- Nom : au moins deux mots, sans `@`. Quantité : 1 à 10. La taille doit exister dans `product.sizes`.
- Estimation du total affichée en direct côté client (quantité × prix), à titre indicatif.
- Le consentement est obligatoire, stocké avec sa date, et refusé côté serveur s'il est absent.
- **Ouverture/fermeture** : l'état est stocké en base (table `settings`), jamais en mémoire ni dans un fichier de config, et vérifié côté serveur à chaque commande. Masquer le bouton ne suffit pas. Si la lecture de l'état échoue côté front, considérer fermé.
- **ID client** : un identifiant unique par personne, déduit du contact normalisé (minuscules, sans `@` initial, sans espaces). Affichage : `C-001`. Jamais renvoyé au visiteur.
- **Règles techniques non négociables** :
  - Le prix est toujours recalculé côté serveur, jamais celui du client.
  - Validation côté client ET serveur (types, longueurs, produit, taille, quantité).
  - Requêtes SQL paramétrées uniquement.
  - Toute donnée saisie par un utilisateur est échappée à l'affichage (anti-XSS).
  - Limitation de débit sur la création de précommande et sur la connexion admin.

---

## 10. Panel d'administration

- Même DA que le site (blocs beiges, bordures marine, boutons pill).
- Contenu : résumé (totaux, détail par produit et par taille, nombre de clients), filtres (statut, produit, recherche par nom, contact ou ID client), tableau des précommandes, changement de statut, suppression, exports.
- Statuts : `en_attente`, `confirmee`, `livree`, `annulee`. Les commandes annulées sont exclues des récaps et du PDF.
- Bloc visible pour ouvrir/fermer les précommandes (badge d'état, confirmation avant changement) et modifier le message affiché aux visiteurs.
- Suppression d'un client = suppression de toutes ses précommandes (droit à l'effacement), avec confirmation.
- Routes protégées par session (cookie httpOnly, sameSite strict). Les routes publiques ne renvoient que le strict nécessaire.
- Exports CSV : UTF-8 avec BOM, séparateur `;`, neutralisation des cellules commençant par `=`, `+`, `-`, `@`.

---

## 11. Export PDF "Liste de remise"

Exception à la DA du site : cette vue est faite pour le papier.
- A4 portrait, noir et blanc, fond blanc, sans grille ni couleur, police Inter ou sans-serif.
- Colonnes : n° client, case PAYÉ (vide, à cocher à la main), nom et prénom, commande, total.
- Aucune autre donnée personnelle (pas de contact, email, Instagram, statut, date).
- Une ligne par client (regroupement par ID client), tri alphabétique, ligne de total, pied de page "Document interne : à détruire après la remise".
- En-tête de tableau répété à chaque page, aucune ligne coupée entre deux pages, lignes assez hautes (~10mm) pour écrire.
- Le reste de l'interface est masqué à l'impression. Le PDF reste disponible quand les précommandes sont fermées.

---

## 12. Déploiement derrière un tunnel

Le site tourne en local et est exposé via un tunnel. Pour le serveur, tout arrive depuis `localhost` ; pour le navigateur, l'origine est le domaine public en HTTPS.
- **URLs relatives partout** : liens et `fetch` en relatif (`/api/...`, pages du site), jamais `http://localhost:5173` en dur.
- **Une seule origine** : le front et `/api` passent par le même hôte. Pas de CORS ouvert. L'origine autorisée pour tout contrôle `Origin` vient d'une variable d'environnement, pas de `localhost` en dur.
- **Express derrière un proxy** : `app.set('trust proxy', 1)`. Sans ça, le cookie `secure` est ignoré et le rate limiting voit l'IP du tunnel (tous les visiteurs partagent le même quota, ce qui peut bloquer la connexion admin). Utiliser l'IP client réelle transmise par le tunnel.
- **Cookie de session** : `secure`, `httpOnly`, `sameSite: 'strict'` (le navigateur voit du HTTPS même si Express voit du HTTP).
- **Vite** : le domaine public est déclaré dans `server.allowedHosts` et `preview.allowedHosts` (lu depuis une variable d'environnement), sinon la requête est bloquée ("This host is not allowed").
- **Production** : ne pas exposer le serveur de dev. `npm run build`, puis Express sert `dist/` et l'API sur un seul port, et c'est ce port que le tunnel expose. Le serveur de dev (HMR) reste pour le travail en local.
- **Multi-pages** : chaque page HTML (site, admin, impression) doit être déclarée dans `build.rollupOptions.input` de `vite.config.js`, sinon elle est absente du build.
- **Admin** : protégé par le mot de passe applicatif. Une protection supplémentaire au niveau du tunnel (contrôle d'accès devant l'admin) est recommandée.

---

## 13. Sécurité & dépôt public

Le dépôt est public : rien de sensible ne doit y figurer.
- Aucun secret, mot de passe, fichier `.env` ni base de données dans Git. Le `.gitignore` couvre `.env` et `*.sqlite`. Seul `.env.example` (valeurs vides ou factices) est versionné.
- Dans la documentation et les commentaires : liens relatifs uniquement, jamais de chemin absolu local ni de nom d'utilisateur.
- Le fichier de base de données n'est jamais dans un dossier servi publiquement.
- Données personnelles minimisées à l'écran, à l'export et à l'impression.
- Aucun log ni message d'erreur qui expose des données personnelles.

---

## 14. Checklist avant d'ajouter ou modifier un élément

- [ ] Nom écrit "AcelSpace"
- [ ] Fond `#f6f3eb` (`bg-card-bg`) pour les blocs de contenu, aucun bleu vif ni couleur hors palette
- [ ] Bordure nette `2px` ou `2.5px solid #111827` (`.pill-border` ou `.card-border`)
- [ ] Typographie Inter, majuscules pour les titres et labels
- [ ] Hauteurs d'images explicites pour éviter tout écrasement Flexbox
- [ ] Accessoires configurés avec `sizes: ['Taille unique']`
- [ ] Aucune donnée collectée en plus de la liste du §9
- [ ] Contrôles critiques faits côté serveur (prix, consentement, état ouvert/fermé)
- [ ] Zero FOUC / pas de dépendance synchrone cassée
- [ ] Liens et `fetch` relatifs, aucun `localhost` en dur
- [ ] Rien de sensible ajouté à Git
- [ ] `npm run build` passe avec 0 erreur et 0 warning