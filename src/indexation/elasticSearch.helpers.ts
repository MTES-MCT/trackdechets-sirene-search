import fs from "fs";
import { Writable } from "stream";
import { pipeline } from "node:stream/promises";
import {
  BulkOperationContainer,
  BulkResponse
} from "@elastic/elasticsearch/api/types";
import { ApiResponse, errors } from "@elastic/elasticsearch";
import { parse } from "fast-csv";
import { logger, elasticSearchClient as client } from "..";
import {
  ElasticBulkNonFlatPayload,
  ElasticBulkNonFlatPayloadWithNull,
  IndexProcessConfig
} from "./types";
import { INDEX_ALIAS_NAME_SEPARATOR } from "./indexInsee.helpers";

const { ResponseError } = errors;

const pjson = require("../../package.json");

/**
 * Max buffer size for the CSV stream reader
 * Increase memory usage for better performance, but more memory usage
 * default is 64 KiB (64*1024 = 65_536)
 * 64 KiB approximatively represents a maximul of 5 CHUNKS in memery
 **/
const TD_SIRENE_INDEX_MAX_HIGHWATERMARK: number =
  parseInt(`${process.env.TD_SIRENE_INDEX_MAX_HIGHWATERMARK}`, 10) || 65_536;

// Max size of documents to bulk index, depends on ES JVM memory available
const CHUNK_SIZE: number =
  parseInt(`${process.env.INDEX_CHUNK_SIZE}`, 10) || 10_000;

// Default concurrent requests is 2
const TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS = isNaN(
  parseInt(process.env.TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS || "1", 10)
)
  ? 1
  : parseInt(process.env.TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS || "1", 10);

// Default sleep is 0
const TD_SIRENE_INDEX_SLEEP_BETWEEN_CHUNKS: number =
  parseInt(`${process.env.TD_SIRENE_INDEX_SLEEP_BETWEEN_CHUNKS}`, 10) || 0;

/**
 * Common index name formatter
 */
const getIndexVersionName = (indexConfig: IndexProcessConfig) =>
  `${indexConfig.alias}${INDEX_ALIAS_NAME_SEPARATOR}${
    pjson.version
  }${INDEX_ALIAS_NAME_SEPARATOR}${Date.now()}`;

/**
 * Create a new index with timestamp appended to the alias name
 * overrides the index alias with a timestamp in order to handle roll-over indices
 */
export const createIndexRelease = async (
  indexConfig: IndexProcessConfig
): Promise<string> => {
  const indexName = getIndexVersionName(indexConfig);
  const { mappings, settings } = indexConfig;
  await client.indices.create({
    index: indexName,
    body: {
      ...(mappings && { mappings }),
      ...{
        settings: {
          // optimize for speed https://www.elastic.co/guide/en/elasticsearch/reference/6.8/tune-for-indexing-speed.html
          refresh_interval: -1,
          number_of_replicas: 0
        }
      },
      ...(settings && { settings })
    },
    include_type_name: true // Compatibility for v7+ with _doc types
  });
  logger.info(`Created a new index ${indexName}`);
  return indexName;
};

/**
 * Clean older indexes and point the production alias on the new index
 * Setup final settings
 */
const finalizeNewIndexRelease = async (
  indexAlias: string,
  indexName: string
) => {
  const aliases = await client.cat.aliases({
    name: indexAlias,
    format: "json"
  });
  const bindedIndexes = aliases.body.map((info: { index: any }) => info.index);
  logger.info(`Setting up final parameters for the index alias ${indexAlias}.`);
  await client.indices.putSettings({
    index: indexName,
    body: {
      index: {
        number_of_replicas: process.env.TD_SIRENE_INDEX_NB_REPLICAS || "2" // 2 replicas is optimal for a 3 nodes cluster
      }
    }
  });
  logger.info(
    `Pointing the index alias ${indexAlias} to the index ${indexName}.`
  );
  await client.indices.updateAliases({
    body: {
      actions: [
        ...(bindedIndexes.length
          ? [{ remove: { indices: bindedIndexes, alias: indexAlias } }]
          : []),
        { add: { index: indexName, alias: indexAlias } }
      ]
    }
  });
  if (bindedIndexes.length) {
    logger.info(
      `Removed alias pointers to older indices ${bindedIndexes.join(", ")}.`
    );
  }
  // Delete old indices to save disk space, except the last
  const indices = await client.cat.indices({
    index: `${indexAlias}${INDEX_ALIAS_NAME_SEPARATOR}${pjson.version}${INDEX_ALIAS_NAME_SEPARATOR}*`,
    format: "json"
  });
  const oldIndices: string[] = indices.body
    .map((info: { index: string }) => info.index)
    // Filter out the last indexName
    .filter((name: string) => name !== indexName)
    .sort();
  // keep the last index in order to rollback if needed
  oldIndices.pop();
  if (oldIndices.length) {
    logger.info(
      `Removing ${oldIndices.length} old index(es) (${oldIndices.join(", ")})`
    );
    await client.indices.delete({ index: oldIndices.join(",") });
  }
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const getOperationsToRetry = (
  bulkResponse: BulkResponse,
  bulkQueryBody: BulkOperationContainer[]
) => {
  const operationsToRetry: BulkOperationContainer[] = [];

  for (let k = 0; k < bulkResponse.items.length; k++) {
    const action = bulkResponse.items[k];
    const operationTypes: string[] = Object.keys(action);
    for (const opType of operationTypes) {
      // If the status is 429 it means that we can retry the document
      if (opType && action[opType]?.error && action[opType]?.status === 429) {
        operationsToRetry.push(bulkQueryBody[k * 2], bulkQueryBody[k * 2 + 1]); // push [index header, index content]
      }
    }
  }
  return operationsToRetry;
};

/**
 * Calls client.bulk and retry
 */
const requestBulkIndex = async (
  indexName: string,
  body: BulkOperationContainer[]
): Promise<void> => {
  const maxRetries = 5;
  let retries = 0;
  let waitTime = 5000; // in milliseconds

  if (!body || !body.length) {
    // nothing to index
    return;
  }
  while (retries < maxRetries) {
    try {
      const bulkResponse: ApiResponse<BulkResponse> = await client.bulk({
        body,
        // lighten the response
        _source_excludes: ["items.index._*", "took"]
      });
      // Log error data and continue
      if (bulkResponse && bulkResponse.body.errors) {
        logger.error(
          `BulkIndex ERROR on index ${indexName}, retrying but the index may be corrupt`
        );
        const toRetry = getOperationsToRetry(bulkResponse.body, body);
        await requestBulkIndex(indexName, toRetry);
      }
      return;
    } catch (bulkIndexError) {
      // this error happens when the Elasticserver cannot take more data input
      // so we can sleep and retry
      if (
        bulkIndexError instanceof ResponseError &&
        bulkIndexError.body.error.root_cause.some(
          cause => cause.type === "es_rejected_execution_exception"
        )
      ) {
        logger.error(
          `Retrying bulkIndex operation after "es_rejected_execution_exception" (retry ${
            retries + 1
          }) with exponential backoff, message of the "error.reason" from the server : "${
            bulkIndexError.body.error.reason
          }"`,
          bulkIndexError.body.error
        );
        await sleep(waitTime);
        // Exponential backoff: double the wait time on each retry
        waitTime *= 2;
        retries++;
      } else {
        // avoid dumping huge errors to the logger
        logger.error(
          `Fatal error on one chunk to index ${indexName}`,
          bulkIndexError
        );
        return;
      }
    }
  }
};

/**
 * Bulk Index and enrich data if configured for
 */
const request = async (
  indexName: string,
  indexConfig: IndexProcessConfig,
  bodyChunk: ElasticBulkNonFlatPayload
): Promise<void> => {
  if (bodyChunk.length) {
    logger.info(
      `Indexing ${bodyChunk.length} documents in bulk to index ${indexName}`
    );
  }
  // append new data to the body before indexation
  if (typeof indexConfig.dataFormatterFn === "function") {
    const formattedChunk = await indexConfig.dataFormatterFn(
      bodyChunk,
      indexConfig.dataFormatterExtras
    );
    return requestBulkIndex(
      indexName,
      formattedChunk.flat() as BulkOperationContainer[]
    );
  }
  return requestBulkIndex(
    indexName,
    bodyChunk.flat() as BulkOperationContainer[]
  );
};

// Queue holding the bulk indexation requests promises
// It's a global variable to keep track of the promises
// across the different chunks calls.
const indexPromisesQueue: Promise<void>[] = [];

// Buffer to accumulate the body before indexing,
// to avoid indexing chunks that are too small
let bodyBuffer: ElasticBulkNonFlatPayload = [];

/**
 * Bulk Index and collect errors
 * controls the maximum chunk size because unzip does not
 */
export const bulkIndexByChunks = async (
  body: ElasticBulkNonFlatPayload,
  indexConfig: IndexProcessConfig,
  indexName: string
): Promise<void> => {
  // Accumulate chucks in a buffer to avoid indexing chunks that are too small
  bodyBuffer.push(...body);
  if (bodyBuffer.length < CHUNK_SIZE) {
    return;
  }

  for (let i = 0; i < bodyBuffer.length; i += CHUNK_SIZE) {
    if (indexPromisesQueue.length >= TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS) {
      await Promise.race(indexPromisesQueue);
    }

    const end = i + CHUNK_SIZE;
    const slice = bodyBuffer.slice(i, end);
    const promise = request(indexName, indexConfig, slice);

    const autoCleanPromise = promise.then(() => {
      indexPromisesQueue.splice(
        indexPromisesQueue.indexOf(autoCleanPromise),
        1
      );
    });

    indexPromisesQueue.push(autoCleanPromise);

    // Wait between chunks can be usefull to slow down the write stream,
    // and avoid having too many small chunks in the queue
    if (TD_SIRENE_INDEX_SLEEP_BETWEEN_CHUNKS) {
      await sleep(TD_SIRENE_INDEX_SLEEP_BETWEEN_CHUNKS);
    }
  }

  bodyBuffer = [];
};

export const flushBuffer = async (
  indexConfig: IndexProcessConfig,
  indexName: string
) => {
  await request(indexName, indexConfig, bodyBuffer);
};

/**
 * Writable stream that parses CSV to an ES bulk body
 */
const getWritableParserAndIndexer = (
  indexConfig: IndexProcessConfig,
  indexName: string
) =>
  new Writable({
    // Increase memory usage for better performance
    // default is 16 KiB (16*1024=16384)
    highWaterMark: TD_SIRENE_INDEX_MAX_HIGHWATERMARK,
    objectMode: true,
    writev: (csvLines, next) => {
      const body: ElasticBulkNonFlatPayloadWithNull = csvLines.map(
        (csvLine, _i) => {
          const doc = csvLine.chunk;
          // skip lines without "idKey" column because we cannot miss the _id in ES
          if (
            doc[indexConfig.idKey] === undefined ||
            !doc[indexConfig.idKey].length
          ) {
            return null;
          } else if (doc[indexConfig.idKey] === indexConfig.idKey) {
            // first line
            return null;
          } else {
            return [
              {
                index: {
                  _index: indexName,
                  // Next major ES version won't need _type anymore
                  _type: "_doc"
                }
              },
              doc
            ];
          }
        }
      );

      bulkIndexByChunks(
        body.filter(line => line !== null) as ElasticBulkNonFlatPayload,
        indexConfig,
        indexName
      )
        .then(() => next())
        .catch(err => next(err));
    },
    final: async callback => {
      // Because we buffer chunks, we need to flush it at the end
      await flushBuffer(indexConfig, indexName);
      callback();
    }
  });

/**
 * Stream CSV to index them in bulk
 */
export const streamReadAndIndex = async (
  csvPath: string,
  indexName: string,
  indexConfig: IndexProcessConfig,
  isReleaseIndexation = true
): Promise<string> => {
  // stop parsing CSV after MAX_ROWS
  const maxRows = parseInt(process.env.MAX_ROWS as string, 10);

  const readableStream = fs.createReadStream(csvPath);
  const parseCsvStream = parse({
    headers: true,
    ignoreEmpty: true,
    ...(maxRows && { maxRows })
  })
    .transform((data, callback) => {
      if (!!indexConfig.transformCsv) {
        indexConfig.transformCsv(data, callback);
      } else {
        callback(null, data);
      }
    })
    .on("error", error => {
      throw error;
    })
    .on("end", async (rowCount: number) => {
      logger.info(`Finished parsing ${rowCount} CSV rows`);
    });
  const writableStream = getWritableParserAndIndexer(indexConfig, indexName);

  await pipeline(readableStream, parseCsvStream, writableStream);

  // roll-over index alias
  if (isReleaseIndexation) {
    await finalizeNewIndexRelease(indexConfig.alias, indexName);
  }

  // Auto refresh is disabled, we manually refresh after each indexation
  await client.indices.refresh({ index: indexName });

  logger.info(`Finished indexing ${indexName} with alias ${indexConfig.alias}`);
  return csvPath;
};
