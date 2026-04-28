import "dotenv/config";
import { buildChallengeKey, getUploadUrl } from "../services/s3.service";

(async () => {
  const key = buildChallengeKey("test-challenge-id", "hello.zip");
  console.log("Key:", key);

  const url = await getUploadUrl(key, "application/zip");
  console.log("Upload URL:", url);
})();
