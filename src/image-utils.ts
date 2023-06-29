import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { GetQueueUrlCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import assert from "node:assert";
import { v4 as uuidv4 } from "uuid";
import {
  dynamodb as dynamoClient,
  s3 as s3Client,
  sqs as sqsClient,
} from "./clients";

const {
  IMAGE_CACHE_QUEUE,
  IMAGE_CACHE_BUCKET,
  USER_CONTENT_BUCKET,
  IMAGE_CACHE_TABLE,
  CACHE_FETCH_MAX_RETRIES = "16",
  CACHE_FETCH_RETRY_DELAY = "500",
} = process.env;
assert(IMAGE_CACHE_QUEUE, "IMAGE_CACHE_QUEUE must be set");
assert(IMAGE_CACHE_BUCKET, "IMAGE_CACHE_BUCKET must be set");
assert(USER_CONTENT_BUCKET, "USER_CONTENT_BUCKET must be set");
assert(IMAGE_CACHE_TABLE, "IMAGE_CACHE_TABLE must be set");
assert(USER_CONTENT_BUCKET, "USER_CONTENT_BUCKET must be set");

const cacheFetchMaxRetries = parseInt(CACHE_FETCH_MAX_RETRIES);
const cacheFetchRetryDelay = parseInt(CACHE_FETCH_RETRY_DELAY);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let imageCacheQueueUrl: string | undefined;
export async function getImageCacheQueueUrl(): Promise<string> {
  if (!imageCacheQueueUrl) {
    const { QueueUrl } = await sqsClient.send(
      new GetQueueUrlCommand({
        QueueName: IMAGE_CACHE_QUEUE,
      })
    );
    if (!QueueUrl) {
      throw new Error("Failed to get image cache queue URL");
    }
    imageCacheQueueUrl = QueueUrl;
  }
  return imageCacheQueueUrl;
}

export async function getImageFromS3(
  bucket: string,
  key: string
): Promise<Buffer> {
  const getObjCmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  let imageStream: NodeJS.ReadableStream | undefined;
  try {
    const { Body } = (await s3Client.send(getObjCmd)) as {
      Body: NodeJS.ReadableStream;
    };
    imageStream = Body;
  } catch (e: any) {
    console.error(e);
    throw new Error("Failed to get image from S3");
  }

  if (!imageStream) {
    console.error(bucket, key, "No image stream");
    throw new Error("Failed to get image from S3");
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of imageStream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function uploadImageToS3(
  bucket: string,
  key: string,
  image: Buffer
): Promise<void> {
  const putObjCmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: image,
    ContentType: "image/png",
  });
  try {
    await s3Client.send(putObjCmd);
  } catch (e: any) {
    console.error(e);
    throw new Error("Failed to upload image to S3");
  }
}

export async function getCachedImageViaQueue(url: string): Promise<Buffer> {
  const msgCmd = new SendMessageCommand({
    QueueUrl: await getImageCacheQueueUrl(),
    MessageBody: JSON.stringify({ url }),
    MessageGroupId: uuidv4(),
    MessageDeduplicationId: uuidv4(),
  });
  await sqsClient.send(msgCmd);

  let tries = 0;
  while (tries < cacheFetchMaxRetries) {
    tries += 1;
    await sleep(cacheFetchRetryDelay);
    const getItemCmd = new GetItemCommand({
      TableName: IMAGE_CACHE_TABLE,
      Key: {
        url: { S: url },
      },
    });
    const { Item } = await dynamoClient.send(getItemCmd);
    if (Item) {
      if (Item?.status?.S) {
        let itemKey: string;
        if (Item.status.S === "success") {
          console.log("Image is Cached");
          if (Item?.resized?.S) {
            itemKey = Item.resized.S;
          } else if (Item?.original?.S) {
            itemKey = Item.original.S;
          } else {
            throw new Error("Invalid Cache Record - No Image");
          }
        } else if (Item.status.S === "pending") {
          console.log("Image is still processing");
          continue;
        } else if (Item.status.S === "failed") {
          throw new Error("Image failed to process");
        } else {
          throw new Error("Invalid Cache Record - Unknown Status");
        }

        let itemBucket: string;
        if (Item?.bucket?.S) {
          itemBucket = Item.bucket.S;
        } else {
          itemBucket = USER_CONTENT_BUCKET as string;
        }

        return getImageFromS3(itemBucket, itemKey);
      } else {
        throw new Error("Invalid Cache Record - Unknown Status");
      }
    } else {
      continue;
    }
  }

  throw new Error(
    `Failed to get cached image after ${cacheFetchMaxRetries} tries`
  );
}
