import fs from "fs/promises";
import path from "path";
import StreamZip from "node-stream-zip";
import { IndexProcessConfig } from "./types";
import {
  createIndexRelease,
  streamReadAndIndex
} from "./elasticSearch.helpers";
import { logger } from "..";
import { getCsvPath } from "./indexInsee.helpers";

/**
 * CSV filename can change with time
 */
async function renameFile(directoryPath: string, newFilePath: string) {
  const regex = /Stock[\w]+_utf8\.csv/;
  const files = await fs.readdir(directoryPath);
  const fileToRename = files.find(file => regex.test(file));

  if (fileToRename) {
    const oldFilePath = path.join(directoryPath, fileToRename);
    await fs.rename(oldFilePath, newFilePath);
    logger.info(`File renamed from ${fileToRename} to ${newFilePath}`);
  } else {
    logger.info("No matching file found");
  }
}

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
  // extract everything from the zip
  await zip.extract(null, destination);
  await renameFile(destination, csvPath);
  await zip.close();
  await streamReadAndIndex(csvPath, indexName, indexConfig);
  return indexName;
};
