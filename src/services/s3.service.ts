import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { env } from "../config/env";

// SDK auto-discovers credentials:
// - Local: from AWS_PROFILE in ~/.aws/credentials
// - EC2: from the IAM role attached to the instance
const s3 = new S3Client({ region: env.AWS_REGION });

const BUCKET = env.AWS_S3_BUCKET;

/**
 * Build an S3 key for a challenge file.
 * Format: challenges/{challengeId}/{uuid}-{safeFilename}
 *
 * The UUID prevents collisions and makes keys unguessable.
 * The challengeId in the path makes admin cleanup and security checks easier.
 */
export const buildChallengeKey = (challengeId: string, filename: string) => {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `challenges/${challengeId}/${randomUUID()}-${safe}`;
};

/**
 * Generate a presigned URL the client can PUT a file to.
 * Default expiry: 5 minutes.
 */
export const getUploadUrl = async (
  key: string,
  contentType: string,
  expiresIn = 300,
) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn });
};

/**
 * Generate a presigned URL the client can GET a file from.
 * Sets Content-Disposition so the browser downloads (not previews)
 * and uses the original filename instead of the UUID-prefixed S3 key.
 * Default expiry: 10 minutes.
 */
export const getDownloadUrl = async (
  key: string,
  downloadFilename?: string,
  expiresIn = 600,
) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(downloadFilename && {
      ResponseContentDisposition: `attachment; filename="${downloadFilename}"`,
    }),
  });
  return getSignedUrl(s3, command, { expiresIn });
};

/**
 * Delete an object from S3. Used when admin replaces a challenge file
 * or removes a challenge entirely.
 */
export const deleteObject = async (key: string) => {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
};

// Export the raw client for HeadObject and other commands.
export { s3 };
