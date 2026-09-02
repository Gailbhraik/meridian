# Rakazo Portable

Un bot de chat local, dans un seul dossier, lancé en un clic. Node.js est embarqué :
rien à installer, aucun Docker, aucun compte à créer — juste une clé OpenRouter.

## Lancer

Double‑clic sur **`Lancer Rakazo.bat`**. Une console s'ouvre, le navigateur s'ouvre sur
`http://localhost:7788`. Fermer la console arrête le bot.

Au premier démarrage, la fenêtre de réglages demande la clé API OpenRouter
(à créer sur <https://openrouter.ai/keys>). Le catalogue de modèles est chargé
directement depuis OpenRouter : n'importe quel modèle de la liste est utilisable.

## Ce que fait le bot

- **Chat en streaming** : la réponse s'écrit au fil de l'eau.
- **Conversations persistantes** : la barre latérale garde l'historique, une conversation
  se rouvre et se poursuit d'une session à l'autre.
- **Mémoire persistante** : le bot dispose de deux outils, `save_memory` et `forget_memory`.
  Il retient de lui‑même les faits durables, et ces souvenirs sont réinjectés dans le prompt
  système à chaque message, y compris dans une conversation neuve. L'onglet *Mémoire* permet
  d'en ajouter et d'en supprimer à la main.
- **Réglages** : modèle, température, personnalité (prompt système).

Le bot n'exécute rien d'autre : pas d'accès au disque, pas de shell, pas de web.

## Portabilité

Le dossier entier se copie sur une clé USB ou un autre PC Windows x64 et fonctionne tel quel :
la clé, les conversations et les souvenirs voyagent avec lui.

```
rakazo-portable/
  Lancer Rakazo.bat    lanceur un clic
  server.mjs           serveur local, zéro dépendance
  public/              interface (HTML/CSS/JS)
  runtime/node.exe     Node.js 24 embarqué (~86 Mo)
  data/                config.json, memories.json, conversations/  ← créé au 1er lancement
```

`runtime/` et `data/` sont exclus de Git (`.gitignore`) : le dépôt ne garde que le code.
Pour reconstituer le paquet portable ailleurs, remettre un `node.exe` (≥ 20) dans `runtime/`,
ou installer Node.js sur la machine — le lanceur retombe automatiquement sur celui du système.

## Notes

- **La clé API est stockée en clair** dans `data/config.json`. C'est le prix de la portabilité :
  ne pas laisser traîner le dossier sur une machine partagée.
- Le serveur n'écoute que sur `127.0.0.1` : rien n'est exposé sur le réseau.
- Si le port 7788 est pris, le serveur prend le suivant libre et ouvre la bonne URL.
