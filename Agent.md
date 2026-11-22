# AcelSpace — Charte Technique, Sécurité & Artistique / Agent.md

Ce fichier documente la direction artistique (DA), les spécifications fonctionnelles, l'architecture technique, les normes de sécurité et les règles de non-régression du site **AcelSpace**.
Toute modification, nouvelle section ou composant doit respecter ces règles pour garantir la cohérence visuelle, la robustesse technique et la sécurité des données. En cas de doute, reproduire l'existant.

Nom de marque officiel : **AcelSpace** (jamais "ACE SPACE"), dans tous les textes, titres, métadonnées et commentaires.

---

## 1. Stack Technique & Architecture

- **Bundler & Dev Server** : Vite 8+ (vanilla JS, pas de React/JSX).
- **CSS** : Tailwind CSS v4 (`@tailwindcss/vite`) + Google Fonts (Inter).
- **Logique UI & État réactif** : Alpine.js v3 (npm).
- **Backend** : Express 5 + SQLite (`better-sqlite3` en mode WAL), dans `backend/`, séparé du front. En dev, Vite proxifie `/api` et `/uploads` vers Express.
- **Structure des fichiers** :
  - `index.html` : structure HTML sémantique, modales (produit, panier, suivi, contact) et styles critiques anti-FOUC dans `<head>`.
  - `admin.html` : panel d'administration complet (gestion des commandes, produits, paliers, logo, exports).
  - `admin-print.html` : vue d'impression épurée A4 pour la remise des commandes.
  - `src/app.js` : état réactif Alpine `merchApp()` (catalogue, panier multi-articles, modales, précommande, suivi OTP, contact).
  - `src/admin.js` : état réactif Alpine du panel admin (authentification, filtres, statuts, upload XLSX/images, gestion boutique).
  - `src/style.css` : import Tailwind v4, `@theme`, classes utilitaires (`.card-border`, `.pill-border`, `.bg-blueprint-grid`) et animation fusée.
  - `backend/server.js` : serveur Express, middleware de sécurité, limitation de débit, gestionnaires d'API.
  - `backend/database.js` : instance SQLite, schémas, migrations et fonctions utilitaires.
  - `backend/products.js` : helpers de consultation du catalogue et de progression des paliers.
  - `backend/backup.js` : sauvegardes automatiques de la base de données.
- **Logo** : logo officiel vectoriel `public/logo.svg` ou logo personnalisé téléversé via l'admin (`/uploads/logo-custom.*`).

---

## 2. Palette de couleurs & Direction Artistique

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
- Tous les blocs, cartes et modales sont en beige/crème (`#f6f3eb`). Le bleu ciel est réservé au quadrillage de fond blueprint.
- Style **néo-brutaliste** : bordures franches sombres, contrastes nets, pas d'ombres portées diffuses ni de dégradés superflus.
- Pas de couleur vive pour les textes ou les liens. Les liens sont marine (`text-slate-900`), soulignés.
- Les badges de statut dans l'administration utilisent des teintes contrastées et lisibles (ambre pour en attente, ciel pour payé/en commande, émeraude pour remis, rouge pour annulé).

---

## 3. Typographie

- **Famille** : `Inter`, fallback `system-ui, -apple-system, sans-serif`. Aucune autre police.
- **Titres (H1, "CLUB", badges)** : `font-black` (900), majuscules, `tracking-tight`.
- **Noms de produits / navigation / labels** : `font-bold` à `font-black`, majuscules.
- **Descriptions courantes** : `font-medium`, casse normale.
- **Prix** : `font-black`, `text-slate-900`.

---

## 4. Composants UI & Micro-animations

### Bouton standard ("VOIR", "À propos", "Contact", icônes)
- Fond : `#f6f3eb` (`bg-card-bg`).
- Bordure : `2px solid #111827` (`.pill-border`), arrondi `border-radius: 6px`.
- Texte : `font-bold`, majuscules, `text-xs` / `text-sm`.
- **Survol (Hover)** : inversion complète (fond `#111827`, texte blanc).
- **Action principale** (AJOUTER AU PANIER, CONFIRMER) : fond marine plein (`bg-slate-900 text-white`).
- **Animation Fusée Tintin** : sur les boutons "VOIR" des cartes produits, le survol déclenche l'animation `@keyframes flyTintinRocket` qui fait défiler la fusée stylisée.

---

## 5. Catalogue & Fiche Produit

- Chaque produit en base possède :
  - `id`, `name`, `price` (prix de référence unitaire), `description`, `sizes` (tableau JSON).
  - `image` (chemin d'image principal), `image_url_2` (seconde vue optionnelle).
  - `detail_table_image` (image optionnelle du guide des tailles/formats).
  - `featured` (produit vedette mis en avant, exclusif aux produits actifs).
  - `actif` (1: visible, 0: archivé).
  - `ordre` (entier d'ordonnancement).
  - `requires_customization` (0 ou 1: personnalisation obligatoire requise).
  - `customization_fields` (libellé des instructions de personnalisation).
  - `allow_no_customization` (0 ou 1: autorise l'acheteur à cocher "Sans personnalisation").
- Les accessoires sans taille vestimentaire utilisent toujours `sizes: ['Taille unique']`.
- La fiche produit permet de consulter le visuel, basculer vers la seconde vue, ouvrir le guide des tailles en lightbox, sélectionner une taille, et cliquer sur **AJOUTER AU PANIER**.

---

## 6. Panier d'achat & Déroulement de Précommande

- Le site utilise un **panier d'achat multi-articles** côté client :
  - Stocké dans `localStorage` sous la clé `acelspaces_cart`.
  - Capacité maximale : jusqu'à 20 articles distincts, de 1 à 10 unités par ligne.
  - Validation automatique du panier au chargement contre le catalogue réel du serveur.
- **Modale de panier en 3 étapes** :
  1. **Récapitulatif** : tableau des articles avec image, taille, quantité modifiable, suppression, rappel du palier de prix et calcul dynamique du total estimé.
  2. **Informations client** :
     - **Parent** : prénom et nom obligatoires (2 à 100 caractères), email valide obligatoire, téléphone obligatoire (8 à 15 chiffres).
     - **Enfant** : prénom et nom obligatoires, email et téléphone secondaires facultatifs.
     - **Personnalisations spécifiques** : détection automatique des articles USB (prénom + nom pour gravure) et T-shirts (prénom + nom + taille de marquage).
     - **Personnalisation libre** : champ obligatoire si le panier contient un article personnalisé non exempté.
     - **Remarques** : champ libre pour précisions supplémentaires.
     - **Notification de baisse de prix** : case à cocher pour être alerté par email en cas d'atteinte d'un palier tarifaire inférieur.
     - **Consentement RGPD** : case à cocher obligatoire avec date enregistrée côté serveur.
  3. **Confirmation** : référence de commande générée (`CMD-YYYYMMDD-XXXX`), récapitulatif, rappel du paiement hors ligne auprès du club, et vidage du panier.

---

## 7. Paliers de Prix Dégressifs (Price Tiers)

- Le système supporte des grilles de prix dégressifs basées sur la quantité totale précommandée pour un produit (tous clients confondus) :
  - Tables : `price_tiers`, `price_tier_history`, `tier_notifications_sent`.
  - Calcul dynamique : `getCurrentPrice(product_id, additional_qty)` calcule le prix unitaire du palier atteint.
  - Les commandes annulées sont systématiquement exclues du calcul de quantité.
  - Gestion dans l'admin : téléchargement d'un template XLSX et téléversement de nouvelles grilles.
  - **Validation de continuité** : les paliers doivent être strictement continus, acceptant aussi bien les bornes partagées (`qty_max === next.qty_min`) que les intervalles entiers discrets (`qty_max + 1 === next.qty_min`).
  - **Notifications automatiques** : si une nouvelle commande fait franchir un palier tarifaire inférieur, un email automatique informe tous les clients ayant commandé ce produit et accepté les alertes.

---

## 8. Espace Suivi des Précommandes (Portail OTP)

- Les visiteurs peuvent suivre l'état de leurs précommandes sans compte avec mot de passe :
  - L'utilisateur renseigne son adresse email.
  - Le serveur envoie un code de vérification à 6 chiffres à usage unique (valable 10 minutes).
  - La saisie du code permet d'afficher les commandes associées, leur statut détaillé et le prix actualisé.
  - **Sécurité anti-énumération et DoS** : la réponse serveur ne révèle jamais si l'email existe, et le serveur ne génère aucun challenge en mémoire si aucune commande n'est associée à l'adresse.

---

## 9. Panel d'Administration & Gestion des Commandes

- Accès restreint par mot de passe (haché en bcrypt dans `.env`) et session sécurisée (cookie signé `admin_session`).
- **6 statuts opérationnels de commande** :
  1. `EN_ATTENTE_PAIEMENT` (legacy: `en_attente`)
  2. `PAYE` (legacy: `confirmee`)
  3. `EN_COMMANDE` (legacy: `confirmee`)
  4. `PRET_AU_LOCAL` (legacy: `confirmee`)
  5. `REMIS` (legacy: `livree`)
  6. `ANNULE` (legacy: `annulee`)
- Modification du statut possible article par article ou pour toute la commande (`status-all`).
- Ouverture/fermeture globale des précommandes stockée en base (table `settings`).
- Gestion complète du catalogue : création, modification, réordonnancement, archivage/restauration, suppression (uniquement si aucune commande liée).
- Téléversement d'images produits (JPEG, PNG, WebP avec vérification des magic bytes) et logo du club. Les routes d'administration acceptent à la fois les fichiers directs (`multipart/form-data`) et les chemins pré-téléversés (`/uploads/...`).
- Tolérance aux visuels manquants : les balises `<img :src="...">` du catalogue et du panier intègrent un fallback automatique et une gestion d'erreur `@error` vers des images de remplacement neutres.
- Droit à l'effacement RGPD : suppression d'un client et de toutes ses commandes associées.
- Exports CSV conformes : encodage UTF-8 avec BOM, séparateur point-virgule `;`, et neutralisation stricte des formules (`escapeCSV`).

---

## 10. Export Impression "Liste de Remise"

- Fichier : `admin-print.html` (accessible sous `/admin-print`).
- Vue optimisée pour l'impression papier (A4, noir et blanc, mise en page sans fioritures).
- Regroupement des articles par client (identifiant `C-001`, nom du parent en majuscules).
- Affiche le nom des enfants rattachés et les personnalisations précises de chaque article.
- Colonne "PAYÉ" avec case à cocher manuelle.
- Pied de page obligatoire : "Document interne : à détruire après la remise".

---

## 11. Déploiement, Proxy & Environnement

- **URLs relatives** : tout appel `fetch` et tout lien d'actif doit être relatif (`/api/...`, `/uploads/...`), jamais d'hôte en dur.
- **Reverse Proxy / Tunnel** :
  - `app.set('trust proxy', 1)` pour récupérer l'IP réelle du visiteur et respecter les rate limits.
  - En production, Express sert les fichiers compilés (`dist/`) et l'API sur le même port.
  - Déclaration de `allowedHosts` dans Vite pour autoriser les requêtes via tunnel.
- **Multi-pages Vite** : toutes les pages (`index.html`, `admin.html`, `admin-print.html`, `mentions-legales.html`, `politique-confidentialite.html`) sont explicitement inscrites dans `rollupOptions.input`.

---

## 12. Sécurité Obligatoire & Protection des Données (RGPD)

> [!CAUTION]
> Ces règles de sécurité sont impératives. Aucun contournement n'est toléré.

1. **Confidentialité absolue des données personnelles (PII)** :
   - Il est formellement interdit d'envoyer des données personnelles (noms, prénoms, emails, téléphones, montants) vers des services de notification ou des canaux tiers publics ou non authentifiés. L'ancienne intégration ntfy.sh a été totalement supprimée pour cette raison.
   - Les données personnelles restent strictement confinées à la base de données interne et aux emails transactionnels officiels (`nodemailer`).
2. **Échappement HTML systématique (Anti-Injection / Anti-XSS)** :
   - Toute donnée fournie par un utilisateur qui est injectée dans un gabarit HTML (notamment dans les emails transactionnels `sendConfirmationEmail` et `sendTierChangeEmail`) **doit obligatoirement être assainie via `escapeHtml()`**.
3. **Gestion des cookies de session** :
   - Le cookie de session `admin_session` ne doit activer le flag `secure: true` que si la requête est effectivement transmise en HTTPS (`req.secure || req.headers['x-forwarded-proto'] === 'https'`) ou en production explicite. Ne jamais forcer `secure: true` sur la simple présence d'une variable de domaine public, sous peine de rendre le login admin impossible en local sur HTTP.
4. **Protection contre le DoS OTP** :
   - Ne jamais allouer ni stocker de challenge OTP en mémoire pour des adresses emails qui ne possèdent aucune commande en base.
5. **Neutralisation de l'injection de formules CSV** :
   - Tous les exports CSV doivent neutraliser les caractères d'exécution de formule (`=`, `+`, `-`, `@`, `\t`, `\r`) en début de cellule en les préfixant d'une apostrophe via la fonction unifiée `escapeCSV()`.
6. **Secrets & Dépôt public** :
   - Aucun secret, mot de passe, hash ni clé d'API ne doit figurer dans le dépôt. Seul `.env.example` avec des clés vides ou factices est versionné.
   - Ne jamais coder d'adresse email personnelle en dur dans les fichiers applicatifs (utiliser `process.env.CONTACT_EMAIL || process.env.GMAIL_USER`).
7. **Protection anti-bot Cloudflare Turnstile** :
   - Widget intégré dans l'étape 2 (informations client) de la modale panier (`index.html`), juste avant le bouton de soumission.
   - Variables d'environnement : `TURNSTILE_SITE_KEY` (frontend, dans le HTML) et `TURNSTILE_SECRET_KEY` (backend, jamais exposé côté client).
   - Fonction `verifyTurnstileToken(token, remoteIp)` dans `backend/server.js` : POST vers `https://challenges.cloudflare.com/turnstile/v0/siteverify`. Retourne `true` si `data.success === true`, ou si `TURNSTILE_SECRET_KEY` est absent (dégradation gracieuse pour dev).
   - Route protégée : `POST /api/precommande` — vérification en toute première étape, avant toute validation des champs ou traitement email. Réponse `400` si jeton manquant ou invalide.
   - Frontend (`src/app.js`) : état `turnstileToken` dans `merchApp()`. Callbacks globaux `window.onTurnstileResolved` / `window.onTurnstileExpired` connectent le widget à l'état Alpine. Bouton de soumission désactivé tant que `turnstileToken` est vide. Jeton réinitialisé après soumission réussie (`window.turnstile.reset()`).
   - En production : remplacer les clés de test Cloudflare par de vraies clés obtenues sur `dash.cloudflare.com`.

---

## 13. Règle d'Or : Non-Régression & Hygiène du Code Mort

> [!IMPORTANT]
> **Vérification d'impact transversal obligatoire** : L'agent doit impérativement s'assurer qu'en modifiant une partie du code, il ne casse aucune autre fonctionnalité existante.

- **Contrats d'interface & Schémas** :
  - Tout champ utilisé côté client (Alpine.js, templates HTML) doit obligatoirement exister et être alimenté par le backend (requêtes SQL, objets de réponse API).
  - Lors de la modification d'un composant, vérifier la cohérence de bout en bout (Base de données → API Express → État Alpine → Rendu HTML).
- **Stabilité Stricte de la Base de Données (Zéro modification de schéma)** :
  - **Tout changement applicatif doit être 100 % compatible avec la structure de base de données existante.**
  - **Aucune altération de schéma, renommage ou suppression de table/colonne SQLite n'est autorisée.** Le projet doit pouvoir être mis à jour en production sans casser la base existante, sans migration complexe et sans devoir réinitialiser les données.
- **Suppression du code mort** :
  - Tout getter, fonction, variable ou branche conditionnelle qui n'est plus reliée ou qui se base sur des propriétés inexistantes doit être soit correctement connectée, soit supprimée pour éviter d'induire en erreur les futures interventions.
- **Validation avant livraison** :
  - Exécuter les tests unitaires et d'intégrité logicielle (`node scratch/test-suite.mjs`).
  - Vérifier systématiquement que la commande `npm run build` s'exécute avec succès (0 erreur, 0 avertissement bloquant).

---

## 14. Checklist avant toute modification

- [ ] Nom écrit rigoureusement **AcelSpace** partout.
- [ ] Fond `#f6f3eb` (`bg-card-bg`) pour les blocs, bordures nettes `2px` ou `2.5px solid #111827`.
- [ ] Typographie `Inter` exclusive, majuscules pour les titres et labels.
- [ ] Aucune donnée personnelle envoyée sur un canal public tiers.
- [ ] Tout texte utilisateur inséré dans un email est échappé avec `escapeHtml()`.
- [ ] Validation stricte des données côté serveur ET côté client.
- [ ] Les paliers XLSX acceptent les grilles continues et discrètes.
- [ ] Détection propre des personnalisations d'articles sans propriété fantôme.
- [ ] Zéro altération de la BDD : 100 % de compatibilité avec la base existante préservée.
- [ ] Requêtes SQL 100% paramétrées, aucune concaténation directe de chaîne.
- [ ] Aucun secret ni fichier `.env` ajouté à Git.
- [ ] `npm run build` exécuté avec succès.
