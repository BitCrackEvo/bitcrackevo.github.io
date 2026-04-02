# BitCrackEvo Online

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

**BitCrackEvo Online** est un outil web expérimental utilisant WebGPU pour la recherche de clés privées Bitcoin, la résolution de puzzles (Bitcoin Challenge) et le benchmark de performances cryptographiques.

## 🚀 Fonctionnalités

- **👁️ Visualiseur** : Outil d'analyse Secp256k1 étape par étape. Entrez une clé privée (hex) pour observer la génération de la clé publique (compressée/non-compressée), du Hash160, et de l'adresse finale Bitcoin Legacy (P2PKH).
- **⏱️ Benchmark** : Évaluez les performances de votre processeur (CPU) et de votre carte graphique (GPU via WebGPU) pour la génération de clés cryptographiques.
- **🔍 Rechercher** : Moteur de force brute manuel. Définissez une adresse cible et une plage hexadécimale personnalisée, paramétrez les threads/workgroups, puis lancez la recherche.
- **🧩 Puzzle (Bitcoin Challenge)** : Interface préconfigurée pour le célèbre "Bitcoin Puzzle Challenge". Sélectionnez un bit (de 1 à 160) pour lancer la recherche de la clé privée associée de manière automatisée.
- **💾 Sauvegardes** : Enregistrement automatique et local des clés privées que vous trouvez.
- **💻 Matériel** : Détection et affichage détaillé des spécificités matérielles utilisées pour les calculs (informations GPU via l'API WebGPU).

## 🛠️ Technologies & Algorithmes

- **Frontend** : HTML5, CSS3, Vanilla JavaScript (ES Modules).
- **Accélération Matérielle** : API WebGPU et shaders WGSL pour du calcul asynchrone intensif et parallélisé.
- **Cryptographie** : 
  - Hachage : SHA256, RIPEMD160.
  - Courbes Elliptiques : Secp256k1 avec implémentation de techniques mathématiques avancées comme l'inversion par lot de Montgomery (*Montgomery Batch Inversion*) et l'utilisation de tables de points précalculées.

## ⚠️ Avertissement Légal et Éducatif

Cet outil est fourni à des fins **strictement éducatives et de recherche technologique** (démonstration des capacités de calcul asynchrone de WebGPU dans un environnement navigateur). 
L'auteur décline toute responsabilité quant à l'utilisation qui pourrait en être faite. 

## 🏁 Démarrage Rapide en local

BitCrackEvo Online est une application web fonctionnant entièrement côté client.

1. Clonez ce dépôt sur votre machine locale.
2. Lancez un serveur web local à la racine du projet pour prendre en charge les modules JavaScript (ES6). Par exemple :
   ```bash
   python3 -m http.server 8000
   # ou
   npx http-server
   ```
3. Ouvrez votre navigateur et accédez à `http://localhost:8000`.

> **Note :** Un navigateur moderne compatible avec **WebGPU** (comme Google Chrome ou Microsoft Edge récents) est requis pour utiliser les fonctionnalités de calcul GPU.

## 📚 Ressources

Les données des puzzles proviennent du défi original de 2015 : Bitcoin Puzzle Challenge.
Les algorithmes WebGPU s'inspirent fortement des recherches de la communauté open-source dédiée aux "Bitcoin Puzzles" (tels que BitCrack, kangaroo, etc.).

## 🤝 Contribuer

Le projet est open-source ! Sentez-vous libre de consulter le code, d'ouvrir des *issues* pour signaler un bug, ou de proposer des *pull requests* sur GitHub.

## 👤 Auteur

**B. LAMACQ**

## 📄 Licence

Ce projet est distribué sous la licence **MIT**.
