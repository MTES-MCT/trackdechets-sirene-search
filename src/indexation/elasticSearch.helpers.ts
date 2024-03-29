import fs from "fs";
import stream, { Writable } from "stream";
import util from "util";
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

const pipeline = util.promisify(stream.pipeline);
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
        number_of_replicas: process.env.TD_SIRENE_INDEX_NB_REPLICAS || "2", // 2 replicas is optimal for a 3 nodes cluster
        refresh_interval: process.env.TD_SIRENE_INDEX_REFRESH_INTERVAL || "1s"
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

/**
 * Log bulkIndex errors and retries in some cases
 */
const logBulkErrorsAndRetry = async (
  indexName: string,
  bulkResponse: BulkResponse,
  body: BulkOperationContainer[]
) => {
  if (bulkResponse.errors) {
    logger.error(
      `BulkIndex ERROR on index ${indexName}, retrying but the index may be corrupt`
    );
    for (let k = 0; k < bulkResponse.items.length; k++) {
      const action = bulkResponse.items[k]!;
      const operations: string[] = Object.keys(action);
      for (const operation of operations) {
        const opType = operation;
        if (opType && action[opType]?.error) {
          // If the status is 429 it means that we can retry the document
          if (action[opType]?.status === 429) {
            try {
              await client.index({
                index: indexName,
                id: body[k * 2].index?._id as string,
                body: body[k * 2 + 1],
                type: "_doc",
                refresh: false
              });
            } catch (err) {
              // do nothing
              return;
            }
          }
        }
      }
    }
  }
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calls client.bulk and retry
 */
const requestBulkIndex = async (
  indexName: string,
  body: BulkOperationContainer[]
): Promise<void> => {
  const maxRetries = 5;
  let retries = 0;
  let waitTime = 1000; // Initial wait time in milliseconds

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
      if (bulkResponse) {
        await logBulkErrorsAndRetry(indexName, bulkResponse.body, body);
      }
      return;
    } catch (bulkIndexError) {
      // this error ihappens when the Elasticserver cannot take more data input
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

/**
 * Bulk Index and collect errors
 * controls the maximum chunk size because unzip does not
 */
export const bulkIndexByChunks = async (
  body: ElasticBulkNonFlatPayload,
  indexConfig: IndexProcessConfig,
  indexName: string
): Promise<void> => {
  // immediat return the chunk when size is greater than the data streamed
  if (CHUNK_SIZE > body.length) {
    await request(indexName, indexConfig, body);
    return;
  }

  const promises: Promise<void>[] = [];
  // number if chunk requests in-flight
  let numberOfChunkRequests = 0;
  logger.info(
    `Number of chunks to process : ${Math.floor(body.length / CHUNK_SIZE)}`
  );
  // loop over other chunks
  for (let i = 0; i < body.length; i += CHUNK_SIZE) {
    const end = i + CHUNK_SIZE;
    const slice = body.slice(i, end);
    const promise = request(indexName, indexConfig, slice);
    if (TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS > 1) {
      promises.push(promise);
      numberOfChunkRequests++; // Increment the in-flight counter

      // Check if the maximum number of promises is reached
      if (numberOfChunkRequests >= TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS) {
        await Promise.race(promises); // Wait for any one of the promises to resolve
        numberOfChunkRequests--; // Decrement the in-flight counter
      }
    } else {
      // no concurrency
      await promise;
      if (TD_SIRENE_INDEX_SLEEP_BETWEEN_CHUNKS) {
        await sleep(TD_SIRENE_INDEX_SLEEP_BETWEEN_CHUNKS);
      }
    }
  }
  if (promises.length > 0) {
    await Promise.all(promises);
  }
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
    // defauly 16 KiB (16*1024=16384)
    highWaterMark: TD_SIRENE_INDEX_MAX_HIGHWATERMARK,
    objectMode: true,
    writev: (csvLines, next) => {
      const body: ElasticBulkNonFlatPayloadWithNull = csvLines.map(
        (chunk, _i) => {
          const doc = chunk.chunk;
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
                  _id: doc[indexConfig.idKey],
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
  const headers = indexConfig.headers;
  const writableStream = getWritableParserAndIndexer(indexConfig, indexName);
  // stop parsing CSV after MAX_ROWS
  const maxRows = parseInt(process.env.MAX_ROWS as string, 10);
  await pipeline(
    fs.createReadStream(csvPath),
    parse({
      headers,
      ignoreEmpty: true,
      discardUnmappedColumns: true,
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
      }),
    writableStream
  );
  // roll-over index alias
  if (isReleaseIndexation) {
    await finalizeNewIndexRelease(indexConfig.alias, indexName);
  }
  logger.info(`Finished indexing ${indexName} with alias ${indexConfig.alias}`);
  return csvPath;
};
