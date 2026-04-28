import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();
// SDK auto-discovers credentials:
// - Local: from AWS_PROFILE in ~/.aws/credentials
// - EC2: from the IAM role attached to the instance
const s3 = new S3Client({ region: process.env.AWS_REGION });

export default s3;
