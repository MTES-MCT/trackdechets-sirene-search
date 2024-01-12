import fs from "fs";
import { rm } from "fs/promises";
import https from "https";
import path from "path";
import { logger } from "..";
import { IndexProcessConfig } from "./types";
import { getCsvPath } from "./indexInsee.helpers";
import { unzipAndIndex } from "./unzipAndIndex";

/**
 * Download and launch indexation
 */
export const downloadAndIndex = async (
  url: string,
  indexConfig: IndexProcessConfig
): Promise<string> => {
  // path ../../csv* is in .gitignore or override with INSEE_DOWNLOAD_DIRECTORY
  const destination = fs.mkdtempSync(
    process.env.INSEE_DOWNLOAD_DIRECTORY ||
      path.join(__dirname, "..", "..", "csv")
  );

  const zipPath = path.join(destination, indexConfig.zipFileName);
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        const contentLength = parseInt(
          res.headers["content-length"] as string,
          10
        );
        logger.info(
          `Start downloading the INSEE archive of ${
            contentLength / 1000000
          } MB from ${url} to ${zipPath}`
        );
        const interval = setInterval(
          () =>
            logger.info(
              `Downloading the INSEE archive : ${currentLength / 1000000} MB`
            ),
          5000
        );
        // Bytes progess var
        let currentLength = 0;
        const file = fs.createWriteStream(zipPath);
        // monitor progress
        res.on("data", chunk => {
          currentLength += Buffer.byteLength(chunk);
        });
        // stream into the file
        res.pipe(file);
        // Close the file
        file.on("finish", async () => {
          clearInterval(interval);
          file.close();
          logger.info(`Finished downloading the INSEE archive to ${zipPath}`);
          const csvPath = getCsvPath(destination, indexConfig);
          try {
            const indexName = await unzipAndIndex(
              zipPath,
              destination,
              indexConfig
            );
            resolve(indexName);
          } catch (e: any) {
            reject(e.message);
          } finally {
            await rm(zipPath, { force: true });
            await rm(csvPath, { force: true });
          }
        });
      })
      .on("error", err => {
        logger.info("HTTP download Error: ", err.message);
        reject(err.message);
      });
  });
};
