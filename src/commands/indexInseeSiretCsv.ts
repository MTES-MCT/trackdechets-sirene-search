import "../common/tracer"; // tracer.init() doit précéder l'importation des modules instrumentés.
import { existsSync } from "fs";

import { logger } from "../common/logger";
import { siretIndexConfig } from "../indexation/indexInsee.helpers";
import { streamReadAndIndex } from "../indexation/elasticSearch.helpers";

process.on("exit", function () {
  console.log("Command index:siret:csv finished");
  logger.end();
});

(async function main() {
  const csvPath: string = process.argv[2];
  if (!csvPath || !existsSync(csvPath)) {
    console.log(
      [
        "Ce script permet de mettre à jour l'indexation d'un CSV donné dans stocketablissement.",
        "",
        "Il accepte un argument: le chemin du fichier CSV existant sur le disque.",
        `Erreur avec le chemin de fichier suivant: "${csvPath}".`
      ].join("\n")
    );
    return;
  }
  logger.info(
    `Démarrage de l'indexation du fichier "${csvPath}" vers ${siretIndexConfig.alias}`
  );
  await streamReadAndIndex(
    csvPath,
    siretIndexConfig.alias,
    siretIndexConfig,
    false
  );
  logger.info("Command index:siret:csv finished");
})();
