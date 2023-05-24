# trackdechets-search

In a nutshell : it's an indexation and search library (TS) for [INSEE's open data](https://www.insee.fr/fr/information/1896441)

Objectif : contruire un moteur de recherche d'établissements français et par la suite étrangers à l'usage du service [trackdechets](https://github.com/MTES-MCT/trackdechets/)

## Installation

- Le serveur doit disposer de [node version 14](https://nodejs.org/en/download/), de l'agent [Datadog](https://docs.datadoghq.com/fr/getting_started/agent/)
- Exécutez `npm run build`
- Pour accéder à ElasticSearch sur Scalingo, télécharger le certificat depuis le dashbord Scalingo
- Le placer sous le nom `es.cert` dans `search/dist/common` pour que le client node elasticsearch le prenne en compte

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

## Variables d'environnement

- `TD_SIRENE_INDEX_NB_REPLICAS`: à la fin de la création d'un index, le nombre de replicas ES de l'index créé
- `TD_SIRENE_INDEX_REFRESH_INTERVAL`: à la fin de la création d'un index, l'interval de temps entre deux cycles de rafraichissement (ex."1s")
- `INDEX_CHUNK_SIZE`: le nombre de lignes du CSV à indexer à la fois dans une requête `bulkIndex` ES
- `TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS`: le nombre de chunks à indexer à la fois dans de multiples requêtes `bulkIndex` ES en parallèle
- `INSEE_DOWNLOAD_DIRECTORY`: remplace le répertoire temporaire par défaut pour télécharger le fichier de l'INSEE
- `NODE_ENV`: Nom de l'environnement, qu sera utilisé pour nommer l'index
- `DD_ENV`: Datadog tracer
- `ELASTICSEARCH_URL`: l'URL du serveur
- `FORCE_LOGGER_CONSOLE`: forcer 
- `MAX_ROWS`: pour tester une indexation partielle, s'arrête après ce nombre de lignes.
- `INSEE_SIRENE_URL`: utiliser une autre URL pour télécharger le ZIP de la base Sirene "stock unité légale"
- `INSEE_SIRET_URL`: utiliser une autre URL pour télécharger le ZIP de la base Sirene "stock établissements"
- `INSEE_SIRET_ZIP_PATH`: chemin direct au fichier ZIP de la base Sirene "stock établissements"
- `INSEE_SIRENE_ZIP_PATH`: chemin direct au fichier ZIP de la base Sirene "stock unité légale"
- `LOG_PATH`: remplace le chemin par défaut des logs ()"logs/trackdechets-search.log")
- `LOG_TO_HTTP`: remplace le logging vers fichier pour un envoie direct par requête HTTP au collecteur "http-intake.logs.datadoghq.com"
- `INDEX_ALIAS_NAME_SUFFIX`: ajouter un suffixe custom
 au nom de l'index créé
