import "../common/tracer"; // tracer.init() doit précéder l'importation des modules instrumentés.
import path from "path";
import fs from "fs";
import { logger } from "..";
import { siretUrl, siretIndexConfig } from "../indexation/indexInsee.helpers";
import { unzipAndIndex } from "../indexation/unzipAndIndex";
import { downloadAndIndex } from "../indexation/downloadAndIndex";

process.on("exit", function () {
  console.log("Command index:siret finished");
  logger.end();
});

/**
 * Index the SIRET INSEE database
 */
(async function main() {
  logger.info("Starting indexation of StockEtablissements");
  let indexName = "";
  if (process.env.INSEE_SIRET_ZIP_PATH) {
    // path ../../csv* is in .gitignore or override with INSEE_DOWNLOAD_DIRECTORY
    const destination = fs.mkdtempSync(
      process.env.INSEE_DOWNLOAD_DIRECTORY ||
        path.join(__dirname, "..", "..", "csv")
    );
    indexName = await unzipAndIndex(
      process.env.INSEE_SIRET_ZIP_PATH,
      destination,
      siretIndexConfig
    );
    logger.info(`Created the new index ${indexName}`);
  } else {
    indexName = await downloadAndIndex(siretUrl, siretIndexConfig);
  }
  logger.info(`Created the new index ${indexName}`);
  logger.info("Command index:siret finished");
})();
