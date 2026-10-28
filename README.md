# AcelSpace

Site web et système de précommandes du club AcelSpace.

---

## 🚀 Prérequis

- **Node.js** 18 ou supérieur
- **npm**

---

## ⚙️ Installation & Configuration

1. **Installer les dépendances :**
   ```bash
   npm install
   ```

2. **Créer le fichier d'environnement :**
   ```bash
   cp .env.example .env
   ```
   *(ou sous Windows PowerShell : `Copy-Item .env.example .env`)*

3. **Variables dans `.env` :**
   - `PORT=3000` : Port du serveur API backend.
   - `COOKIE_SECRET` : Clé secrète pour les cookies de session admin.
   - `ADMIN_PASSWORD_HASH` : Hash bcrypt du mot de passe admin (par défaut : `admin123`).
   - `PUBLIC_ORIGIN=https://boutique.acelspace.fr` : Origine publique du site.
   - `ALLOWED_HOST=boutique.acelspace.fr,localhost,127.0.0.1` : Hôtes Vite autorisés pour le développement/prod.
   - `ALLOWED_ORIGIN=https://boutique.acelspace.fr` : Origine autorisée par le backend CORS.

---

## 💻 Démarrage en Développement

Lance simultanément le backend Express et le frontend Vite :

```bash
npm run dev
```

- **Boutique publique :** [http://localhost:5173](http://localhost:5173)
- **Panel d'administration :** [http://localhost:5173/admin.html](http://localhost:5173/admin.html)  
  *(Mot de passe par défaut : `admin123`)*
- **API Backend :** [http://localhost:3000](http://localhost:3000)

---

## 📦 Build Production

```bash
npm run build
```

Les fichiers statiques optimisés sont générés dans le dossier `dist/`.
Le serveur backend peut être démarré seul via `npm run start`.