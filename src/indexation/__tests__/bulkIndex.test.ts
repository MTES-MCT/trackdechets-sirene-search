import { ElasticBulkNonFlatPayload, IndexProcessConfig } from "../types";

const esClientMock = jest.fn();

// Mocking the request function
jest.mock("../../common/elastic", () => ({
  elasticSearchClient: {
    bulk: esClientMock
  }
}));

const dataFormatterFnMock = jest.fn();

import { bulkIndexByChunks } from "../elasticSearch.helpers";

describe("bulkIndexByChunks", () => {
  const indexConfigMock: IndexProcessConfig = {
    headers: [],
    alias: "test_alias",
    csvFileName: "test.csv",
    idKey: "id",
    zipFileName: "test.zip",
    // Mocking the formatter
    dataFormatterFn: dataFormatterFnMock
  };
  const indexNameMock = "test_index";
  const CHUNK_SIZE = parseInt(`${process.env.INDEX_CHUNK_SIZE}`, 10) || 100;

  beforeEach(() => {
    process.env.TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS = "1";
    esClientMock.mockReset();
    dataFormatterFnMock.mockReset();
    esClientMock.mockImplementation(() => Promise.resolve());
    dataFormatterFnMock.mockImplementation((body, _) => Promise.resolve(body));
  });

  test("Should slice the body into chunks and send each as a separate request", async () => {
    // One Chunk + 1
    const bodyMock: ElasticBulkNonFlatPayload = Array(CHUNK_SIZE + 1)
      .fill(0)
      .map((_, i) => [
        { index: { _id: `${i}`, _index: indexNameMock } },
        { my_document_field: `value${i}` }
      ]);
    await bulkIndexByChunks(bodyMock, indexConfigMock, indexNameMock);
    const expectedChunks = Math.ceil(bodyMock.length / CHUNK_SIZE);
    expect(esClientMock).toHaveBeenCalledTimes(expectedChunks);
  });

  test("Should limit the number of concurrent requests", async () => {
    // 4 chunks
    const bodyMock: ElasticBulkNonFlatPayload = Array(CHUNK_SIZE * 4)
      .fill(0)
      .map((_, i) => [
        { index: { _id: `${i}`, _index: indexNameMock } },
        { my_document_field: `value${i}` }
      ]);
    // simulate 3 concurrent requests
    process.env.TD_SIRENE_INDEX_MAX_CONCURRENT_REQUESTS = "3";
    await bulkIndexByChunks(bodyMock, indexConfigMock, indexNameMock);
    // TODO Check the behavior
  });

  test("Should call dataFormatterFn if it is a function", async () => {
    const bodyMock: ElasticBulkNonFlatPayload = Array(CHUNK_SIZE + 1)
      .fill(0)
      .map((_, i) => [
        { index: { _id: `${i}`, _index: indexNameMock } },
        { my_document_field: `value${i}` }
      ]);
    await bulkIndexByChunks(bodyMock, indexConfigMock, indexNameMock);
    expect(indexConfigMock.dataFormatterFn).toHaveBeenCalled();
  });

  test("Should wait for all promises to resolve if there were concurrent requests", async () => {
    //
    const bodyMock: ElasticBulkNonFlatPayload = Array(CHUNK_SIZE * 4)
      .fill(0)
      .map((_, i) => [
        { index: { _id: `${i}`, _index: indexNameMock } },
        { my_document_field: `value${i}` }
      ]);
    (
      esClientMock as jest.MockedFunction<typeof esClientMock>
    ).mockResolvedValueOnce(new Promise(resolve => setTimeout(resolve, 1000)));
    await bulkIndexByChunks(bodyMock, indexConfigMock, indexNameMock);
    expect(esClientMock).toHaveBeenCalledTimes(
      Math.ceil(bodyMock.length / CHUNK_SIZE)
    );
  });
});
