# Meridian

Suivi de portefeuille multi-actifs — crypto, actions, ETF, liquidités — dans un seul fichier HTML,
sans dépendance à installer. Ouvrez `meridian.html` dans un navigateur : c'est tout.

## Ce que ça fait

Six pages, navigables par ancre (`#/positions`, `#/capital`…) :

| Page | Contenu |
|---|---|
| **Vue d'ensemble** | Valeur totale, capital investi, plus-value latente, performance annualisée, et une orbite 3D (Three.js) où chaque sphère est une ligne : rayon = poids, anneau = classe d'actif, hauteur = plus-value depuis le PRU |
| **Positions** | Saisie et édition des lignes : ticker, nom, quantité, PRU, date d'achat. Suggestions dès la première lettre, au ticker comme au nom |
| **Allocation** | Répartition par classe d'actif |
| **Capital** | Escalier du capital investi bâti sur les dates d'achat réelles, et écart avec la valeur de marché du jour |
| **Cerebras** | Fil d'actualité du compte X (voir les limites plus bas) |
| **Réglages** | Cours de marché, devise, mémoire |

## Cours de marché

- **Crypto** — [CoinGecko](https://www.coingecko.com/en/api), sans clé. Recherche d'actifs et cotation.
- **Actions et ETF** — [Finnhub](https://finnhub.io/), clé gratuite à coller dans Réglages, gardée
  sur l'appareil uniquement.
- **Change EUR/USD** — [Frankfurter](https://frankfurter.dev/), avec repli sur un stablecoin coté
  dans les deux devises.

Le cours se récupère tout seul dès qu'un actif est choisi ; le champ reste modifiable et une valeur
saisie à la main n'est jamais écrasée.

## Devise

Affichage en dollars par défaut, bascule EUR/USD à tout moment. Les montants sont stockés en euros
en interne et convertis à l'affichage : changer de devise ne modifie jamais les données.

## Mémoire

- **Locale** — `localStorage`, propre au navigateur.
- **Fichier** — export et import JSON, pour transporter le portefeuille d'une machine à l'autre.
- **Cloud** — synchronisation optionnelle via le stockage d'artifact, désactivée par défaut.

## Limites connues

- **Publié comme artifact sur claude.ai, aucun cours en direct n'est possible** : la politique de
  sécurité de la page bloque toute requête vers une API externe. Les suggestions locales, la saisie
  et tous les calculs fonctionnent ; les cours restent ceux que vous saisissez. Pour le live,
  ouvrez le fichier depuis votre disque.
- **Finnhub en offre gratuite cote mal les places hors États-Unis** (`.AS`, `.PA`, `.DE`, `.SW`).
- **Les tweets ne s'affichent pas** : X n'ouvre plus ses fils aux pages web que par son widget, qui
  ne renvoie rien sans authentification. La page accepte en remplacement n'importe quel flux RSS,
  Atom ou JSON servi avec CORS.
- Le catalogue de suggestions embarque une centaine de valeurs majeures ; au-delà, la recherche
  exhaustive des actions passe par Finnhub.

## Données

Aucune donnée personnelle dans le fichier. Le portefeuille d'exemple est fictif et sert de point de
départ ; vos positions vivent dans votre navigateur, pas dans le code.
