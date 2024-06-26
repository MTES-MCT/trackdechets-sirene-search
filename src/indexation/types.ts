/**
 * Indexing process configuration
 */
export interface IndexProcessConfig {
  headers: string[] | boolean;
  alias: string;
  csvFileName: string;
  idKey: string;
  zipFileName: string;
  dataFormatterFn?: (
    body: ElasticBulkNonFlatPayload,
    extras: any
  ) => Promise<ElasticBulkNonFlatPayload>;
  dataFormatterExtras?: any;
  mappings?: Record<string, any>;
  settings?: Record<string, any>;
  transformCsv?: (data, callback) => void;
}

/**
 * Bulk Indexing error
 */
export interface ElasticBulkIndexError {
  status: number;
  error: any;
  body: Record<string, any>;
}

type ElasticBulkPrepayload = {
  index: {
    _index: string;
    // Next major ES version won't need _type anymore
    _type?: "_doc";
  };
};

type ElasticBulkPayloadDocument = Record<string, any>;

/**
 * Preprocessing Bulk payload
 */
export type ElasticBulkNonFlatPayloadWithNull = Array<
  [ElasticBulkPrepayload, ElasticBulkPayloadDocument] | null
>;

export type ElasticBulkNonFlatPayload = Array<
  [ElasticBulkPrepayload, ElasticBulkPayloadDocument]
>;
