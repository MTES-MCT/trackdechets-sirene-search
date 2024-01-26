# trackdechets-search

In a nutshell : it's an indexation and search library (TS) for [INSEE's open data](https://www.insee.fr/fr/information/1896441)

Objectif : contruire un moteur de recherche d'établissements français et par la suite étrangers à l'usage du service [trackdechets](https://github.com/MTES-MCT/trackdechets/)

## Installation

- Clonez le dépôt : `git clone https://github.com/MTES-MCT/trackdechets-sirene-search`
- Installez les dépendances : `npm install && npm run build`
- Copiez et corrigez `.env/model` vers `.env` (voir ci-dessous la documentation des variables)
- 

## Déploiment

- Ce dépôt dispose d'un `Procfile` réutilisable sur les platformes "Paas" le supportant.
- Si vous déployez manuellement, votre serveur doit disposer de [node.js version 18](https://nodejs.org/en/download/), et pour le logging de l'agent [Datadog](https://docs.datadoghq.com/fr/getting_started/agent/)
- Installez le package en suivant les informations d'installation ci dessus.
- Pour accéder à ElasticSearch sur Scalingo, télécharger le certificat depuis le dashbord Scalingo
- Le placer sous le nom `es.cert` dans `./dist/common` pour que le client node elasticsearch le prenne en compte

## Tests

- En local, lancez les serveur Elastic avec `docker-compose up`
- En local, conifgurez la variable d'environnement `export ELASTICSEARCH_URL=http://localhost:9201`
- Lancez `npm run test`

## Usage

## Commandes pour créer ou mettre à jour votre propre index avec ElasticSearch

- En développement : 2 scripts à lancer l'un après l'autre, que ce soit pour créer la 1ère fois ou pour mettre à jour l'index.

```
npm i
```

- Si une archive zip locale des données existe, il est possible de passer outre le téléchargement en passant ces variables d'environnement:

```
export INSEE_SIRET_ZIP_PATH=~/Téléchargements/StockEtablissement_utf8.zip
export INSEE_SIRENE_ZIP_PATH=~/Téléchargements/StockUniteLegale_utf8.zip
```

```
npm run index:dev
```

Au final, vous disposez de l'index "stocketablissement-dev" où les données d'unité légale de l'index Siren (`http://localhost:9201/stockunitelegale-dev/_search`) ont été dupliquées:
`http://localhost:9201/stocketablissement-dev/_search`

Ces index sont des alias et les commandes se chargent de faire un roulement des index à la fin du processus pour ne pas couper le service de l'index en cours de mise à jour.

En cas d'erreur durant l'indexation l'index alias en place n'est pas ecrasé, ce qui permet de continuer en production avec l'index existant sans encombres si l'indexation plante.

Puis de relancer chaque script

- En production, nous avons choisi de fonctionner avec Scalingo pour le serveur ElasticSearch
- Nous conseillons de configurer ElasticSearch à minima avec 4Go de mémoire vive.

## Contenu de l'index `stocketablissement`


Voir le mapping configuré dans `search/src/indexation/indexInsee.helpers.ts`

### Mise à jour partielle via l'API de l'INSEE

- L'API Sirene de l'INSEE permet de télécharger un CSV des établissements mis à jour depuis une date donnée.
- La commande `index:siret:csv -- chemin_vers_le.csv` permet de réindexer les établissements présents dans ce fichier.
- Il existe des différences entre le stocketablissement de l'index original, et la réponse de l'API Sirene de l'INSEE :

 ```

- Champs absents de l'API Sirene mais présent dans l'index `stocketablissement-xxx` créé par la commande `index`
 [
  ('nombrePeriodesUniteLegale', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
 ('td_search_companies', {'type': 'text'})]


- Champs supplémentaires de l'API Sirene et absents du stocketablissement.

[
  ('activitePrincipaleEtablissementLibelle', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('activitePrincipaleUniteLegaleLibelle', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('changementActivitePrincipaleEtablissement', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('changementCaractereEmployeurEtablissement', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('changementDenominationUsuelleEtablissement', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('changementEnseigneEtablissement', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('changementEtatAdministratifEtablissement', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('dateFin', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}), 
('effectifsMaxEtablissement', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('effectifsMaxUniteLegale', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('effectifsMinEtablissement', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('effectifsMinUniteLegale', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('societeMissionUniteLegale', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}}),
('typeVoieEtablissementLibelle', {'type': 'text', 'fields': {'keyword': {'type': 'keyword', 'ignore_above': 256}}})
]
 ```

## Variables d'environnement

- `TD_SIRENE_INDEX_NB_REPLICAS`: à la fin de la création d'un index, le nombre de replicas ES de l'index créé
- `TD_SIRENE_INDEX_REFRESH_INTERVAL`: à la fin de la création d'un index, l'interval de temps entre deux cycles de rafraichissement (ex."1s")
- `INDEX_CHUNK_SIZE`: le nombre de lignes du CSV à indexer à la fois dans une requête `bulkIndex` ES
- `TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS`: le nombre de chunks à indexer à la fois dans de multiples requêtes `bulkIndex` ES en parallèle
- `TD_SIRENE_INDEX_MAX_HIGHWATERMARK`: mémoire allouée au stream reader du CSV
- `TD_SIRENE_INDEX_SLEEP_BETWEEN_CHUNKS`: ajouter un temps d'attente en milliseconds entre chaque bulkIndex si `TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS=1` (et seulement dans ce cas, sinon les requêtes se font en parallèle)
- `INSEE_DOWNLOAD_DIRECTORY`: remplace le répertoire temporaire par défaut pour télécharger le fichier de l'INSEE
- `NODE_ENV`: Nom de l'environnement, qu sera utilisé pour nommer l'index
- `DD_ENV`: Datadog tracer
- `ELASTICSEARCH_URL`: l'URL du serveur
- `FORCE_LOGGER_CONSOLE`: si 'true' alors emplace le log vers fichier pour forcer les logs vers stdout
- `MAX_ROWS`: pour tester une indexation partielle, s'arrête après ce nombre de lignes.
- `INSEE_SIRENE_URL`: utiliser une autre URL pour télécharger le ZIP de la base Sirene "stock unité légale"
- `INSEE_SIRET_URL`: utiliser une autre URL pour télécharger le ZIP de la base Sirene "stock établissements"
- `INSEE_SIRET_ZIP_PATH`: chemin direct au fichier ZIP de la base Sirene "stock établissements"
- `INSEE_SIRENE_ZIP_PATH`: chemin direct au fichier ZIP de la base Sirene "stock unité légale"
- `LOG_PATH`: remplace le chemin par défaut des logs ()"logs/trackdechets-search.log")
- `LOG_TO_HTTP`: si 'true', alors emplace le log vers fichier pour un envoi direct par requête HTTP au collecteur "http-intake.logs.datadoghq.com"
- `INDEX_ALIAS_NAME_SUFFIX`: ajouter un suffixe custom
 au nom de l'index créé
