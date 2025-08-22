import "../common/tracer"; // tracer.init() doit précéder l'importation des modules instrumentés.
import path from "path";
import fs from "fs";
import { logger } from "../common/logger";
import { unzipAndIndex } from "../indexation/unzipAndIndex";
import { downloadAndIndex } from "../indexation/downloadAndIndex";

import { sireneIndexConfig } from "../indexation/indexInsee.helpers";

/**
 * StockUniteLegale data specifications
 * infos : https://www.insee.fr/fr/statistiques/4202741?sommaire=3357459
 */
const sireneUrl =
  process.env.INSEE_SIRENE_URL ||
  "https://object.files.data.gouv.fr/data-pipeline-open/siren/stock/StockUniteLegale_utf8.zip";

process.on("exit", function () {
  console.log(`Command index:sirene finished`);
  logger.end();
});

/**
 * Index the Sirene INSEE database
 */
(async function main() {
  logger.info("Starting indexation of StockUniteLegale");
  let indexName = "";
  if (process.env.INSEE_SIRENE_ZIP_PATH) {
    // path ../../csv* is in .gitignore or override with INSEE_DOWNLOAD_DIRECTORY
    const destination = fs.mkdtempSync(
      process.env.INSEE_DOWNLOAD_DIRECTORY ||
        path.join(__dirname, "..", "..", "csv")
    );
    indexName = await unzipAndIndex(
      process.env.INSEE_SIRENE_ZIP_PATH,
      destination,
      sireneIndexConfig
    );
  } else {
    indexName = await downloadAndIndex(sireneUrl, sireneIndexConfig);
  }
  logger.info(`Created the new index ${indexName}`);
  logger.info("Command index:sirene finished");
})();
