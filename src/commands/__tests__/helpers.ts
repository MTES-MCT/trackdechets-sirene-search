import { elasticSearchClient } from "../../common/elastic";
import { INDEX_NAME_INSEE_PREFIX } from "../../indexation/indexInsee.helpers";

export async function resetDatabase() {
  const indices = await elasticSearchClient.cat.indices({
    index: `${INDEX_NAME_INSEE_PREFIX}*`,
    format: "json"
  });

  const indicesNames: string[] = indices.body.map(
    (info: { index: string }) => info.index
  );
  if (indicesNames.length) {
    await elasticSearchClient.indices.delete({ index: indicesNames.join(",") });
  }
}
