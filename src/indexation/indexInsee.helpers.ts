import path from "path";
import { elasticSearchClient as client, logger } from "..";
import { ElasticBulkNonFlatPayload, IndexProcessConfig } from "./types";

// Date dynamic mapping for all field names starting with "date*""
// like "dateDernierTraitementUniteLegale"
export const standardMapping = {
  _doc: {
    dynamic_templates: [
      {
        dateType: {
          match_pattern: "regex",
          match: "^date.*$",
          mapping: {
            type: "date",
            ignore_malformed: true
          }
        }
      }
    ]
  }
};

export const INDEX_ALIAS_NAME_SEPARATOR = "-";
export const INDEX_NAME_INSEE_PREFIX = "stock";

/**
 * stockunitelegale-* indexation config
 */
export const sireneIndexConfig: IndexProcessConfig = {
  alias: `${INDEX_NAME_INSEE_PREFIX}unitelegale${INDEX_ALIAS_NAME_SEPARATOR}${
    process.env.NODE_ENV ? process.env.NODE_ENV : "dev"
  }${
    process.env.INDEX_ALIAS_NAME_SUFFIX
      ? process.env.INDEX_ALIAS_NAME_SUFFIX
      : ""
  }`,
  // to match the filename inside zip
  csvFileName: "StockUniteLegale_utf8.csv",
  // zip target filename
  zipFileName: "StockUniteLegale_utf8.zip",
  idKey: "siren",
  mappings: standardMapping,
  headers: [
    "siren",
    "statutDiffusionUniteLegale",
    "unitePurgeeUniteLegale",
    "dateCreationUniteLegale",
    "sigleUniteLegale",
    "sexeUniteLegale",
    "prenom1UniteLegale",
    "prenom2UniteLegale",
    "prenom3UniteLegale",
    "prenom4UniteLegale",
    "prenomUsuelUniteLegale",
    "pseudonymeUniteLegale",
    "identifiantAssociationUniteLegale",
    "trancheEffectifsUniteLegale",
    "anneeEffectifsUniteLegale",
    "dateDernierTraitementUniteLegale",
    "nombrePeriodesUniteLegale",
    "categorieEntreprise",
    "anneeCategorieEntreprise",
    "dateDebut",
    "etatAdministratifUniteLegale",
    "nomUniteLegale",
    "nomUsageUniteLegale",
    "denominationUniteLegale",
    "denominationUsuelle1UniteLegale",
    "denominationUsuelle2UniteLegale",
    "denominationUsuelle3UniteLegale",
    "categorieJuridiqueUniteLegale",
    "activitePrincipaleUniteLegale",
    "nomenclatureActivitePrincipaleUniteLegale",
    "nicSiegeUniteLegale",
    "economieSocialeSolidaireUniteLegale",
    "caractereEmployeurUniteLegale"
  ],
  settings: {
    // Ignore malformed errors globally
    // Docs https://www.elastic.co/guide/en/elasticsearch/reference/7.17/ignore-malformed.html#ignore-malformed-setting
    "index.mapping.ignore_malformed": true
  }
};

/**
 * Formatter for siretIndexConfig
 * Appends SIREN data to SIRET data
 */
const siretWithUniteLegaleFormatter = async (
  body: ElasticBulkNonFlatPayload,
  extras: { sireneIndexConfig: IndexProcessConfig }
): Promise<ElasticBulkNonFlatPayload> => {
  if (!body.length) {
    return [];
  }

  const result: ElasticBulkNonFlatPayload = [];

  const chunkSize = 10_000; // Max number of SIREN to search in one request
  for (let i = 0; i < body.length; i += chunkSize) {
    const chunk = body.slice(i, i + chunkSize);
    const chunkResult = await siretWithUniteLegaleChunkFormatter(chunk, extras);
    result.push(...chunkResult);
  }

  return result;
};

const siretWithUniteLegaleChunkFormatter = async (
  body: ElasticBulkNonFlatPayload,
  extras: { sireneIndexConfig: IndexProcessConfig }
): Promise<ElasticBulkNonFlatPayload> => {
  const response = await client.search({
    index: sireneIndexConfig.alias,
    body: {
      size: 10_000,
      query: {
        terms: {
          siren: body.map(doc => doc[1].siren)
        }
      }
    }
  });
  if (!response.body.hits.total.value) {
    logger.error(
      `Empty SIRENE data returned from ${extras.sireneIndexConfig.alias}, final data may be corrupted`
    );
  }

  const sirenDocsLookup = response.body.hits.hits.reduce((acc, hit) => {
    acc[hit._source.siren] = hit._source;
    return acc;
  }, {});

  return body.map(siretDoc => {
    return [
      siretDoc[0],
      {
        ...siretDoc[1],
        ...sirenDocsLookup[siretDoc[1].siren]
      }
    ];
  });
};

/**
 * StockEtablissement configuration
 */
export const siretUrl =
  process.env.INSEE_SIRET_URL ||
  "https://files.data.gouv.fr/insee-sirene/StockEtablissement_utf8.zip";

export const siretIndexConfig: IndexProcessConfig = {
  alias: `${INDEX_NAME_INSEE_PREFIX}etablissement${INDEX_ALIAS_NAME_SEPARATOR}${
    process.env.NODE_ENV ? process.env.NODE_ENV : "dev"
  }${
    process.env.INDEX_ALIAS_NAME_SUFFIX
      ? process.env.INDEX_ALIAS_NAME_SUFFIX
      : ""
  }`,
  // to match the filename inside zip
  csvFileName: "StockEtablissement_utf8.csv",
  // zip target filename
  zipFileName: "StockEtablissement_utf8.zip",
  idKey: "siret",
  // append StockUniteLegale by JOINING ON siren
  dataFormatterFn: siretWithUniteLegaleFormatter,
  dataFormatterExtras: {
    sireneIndexConfig
  },
  // copy_to full-text search field to optimize multiple field search performance
  // docs https://www.elastic.co/guide/en/elasticsearch/reference/7.16/copy-to.html
  mappings: {
    _doc: {
      // inherit from standardMapping
      ...standardMapping._doc,
      // override
      properties: {
        siren: {
          type: "text",
          copy_to: "td_search_companies"
        },
        siret: {
          type: "text",
          copy_to: "td_search_companies"
        },
        denominationUniteLegale: {
          type: "text",
          copy_to: "td_search_companies"
        },
        nomUniteLegale: {
          type: "text",
          copy_to: "td_search_companies"
        },
        denominationUsuelleEtablissement: {
          type: "text",
          copy_to: "td_search_companies"
        },
        denominationUsuelle1UniteLegale: {
          type: "text",
          copy_to: "td_search_companies"
        },
        denominationUsuelle2UniteLegale: {
          type: "text",
          copy_to: "td_search_companies"
        },
        denominationUsuelle3UniteLegale: {
          type: "text",
          copy_to: "td_search_companies"
        },
        nomUsageUniteLegale: {
          type: "text",
          copy_to: "td_search_companies"
        },
        sigleUniteLegale: {
          type: "text",
          copy_to: "td_search_companies"
        },
        enseigne1Etablissement: {
          type: "text",
          copy_to: "td_search_companies"
        },
        enseigne2Etablissement: {
          type: "text",
          copy_to: "td_search_companies"
        },
        enseigne3Etablissement: {
          type: "text",
          copy_to: "td_search_companies"
        },
        etatAdministratifEtablissement: {
          type: "keyword"
        },
        td_search_companies: {
          type: "text"
        }
      }
    }
  },
  headers: [
    "siren",
    "nic",
    "siret",
    "statutDiffusionEtablissement",
    "dateCreationEtablissement",
    "trancheEffectifsEtablissement",
    "anneeEffectifsEtablissement",
    "activitePrincipaleRegistreMetiersEtablissement",
    "dateDernierTraitementEtablissement",
    "etablissementSiege",
    "nombrePeriodesEtablissement",
    "complementAdresseEtablissement",
    "numeroVoieEtablissement",
    "indiceRepetitionEtablissement",
    "dernierNumeroVoieEtablissement",
    "indiceRepetitionDernierNumeroVoieEtablissement",
    "typeVoieEtablissement",
    "libelleVoieEtablissement",
    "codePostalEtablissement",
    "libelleCommuneEtablissement",
    "libelleCommuneEtrangerEtablissement",
    "distributionSpecialeEtablissement",
    "codeCommuneEtablissement",
    "codeCedexEtablissement",
    "libelleCedexEtablissement",
    "codePaysEtrangerEtablissement",
    "libellePaysEtrangerEtablissement",
    "identifiantAdresseEtablissement",
    "coordonneeLambertAbscisseEtablissement",
    "coordonneeLambertOrdonneeEtablissement",
    "complementAdresse2Etablissement",
    "numeroVoie2Etablissement",
    "indiceRepetition2Etablissement",
    "typeVoie2Etablissement",
    "libelleVoie2Etablissement",
    "codePostal2Etablissement",
    "libelleCommune2Etablissement",
    "libelleCommuneEtranger2Etablissement",
    "distributionSpeciale2Etablissement",
    "codeCommune2Etablissement",
    "codeCedex2Etablissement",
    "libelleCedex2Etablissement",
    "codePaysEtranger2Etablissement",
    "libellePaysEtranger2Etablissement",
    "dateDebut",
    "etatAdministratifEtablissement",
    "enseigne1Etablissement",
    "enseigne2Etablissement",
    "enseigne3Etablissement",
    "denominationUsuelleEtablissement",
    "activitePrincipaleEtablissement",
    "nomenclatureActivitePrincipaleEtablissement",
    "caractereEmployeurEtablissement"
  ],
  settings: {
    "index.mapping.ignore_malformed": true
  }
};

/**
 * Build the CSV file path
 */
export const getCsvPath = (
  destination: string,
  indexConfig: IndexProcessConfig
) => path.join(destination, indexConfig.csvFileName);
