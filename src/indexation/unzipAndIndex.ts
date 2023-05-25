import StreamZip from "node-stream-zip";
import { IndexProcessConfig } from "./types";
import {
  createIndexRelease,
  streamReadAndIndex
} from "./elasticSearch.helpers";
import { getCsvPath } from "./indexInsee.helpers";

/**
 * Streaming unzip, formatting documents and index them
 */
export const unzipAndIndex = async (
  zipPath: string,
  destination: string,
  indexConfig: IndexProcessConfig
): Promise<string> => {
  const indexName = await createIndexRelease(indexConfig);
  const zip = new StreamZip.async({ file: zipPath });
  const csvPath = getCsvPath(destination, indexConfig);
  await zip.extract(indexConfig.csvFileName, csvPath);
  await zip.close();
  await streamReadAndIndex(csvPath, indexName, indexConfig);
  return indexName;
};
