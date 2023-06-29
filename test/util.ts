import {
  BatchWriteItemCommand,
  CreateTableCommand,
  DeleteTableCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  PurgeQueueCommand,
} from "@aws-sdk/client-sqs";
import assert from "node:assert";
import { dynamodb, s3, sqs } from "../src/clients";
import { getImageCacheQueueUrl } from "../src/image-utils";

const {
  JOB_TABLE,
  QUEUE_URL,
  ACTIVE_USER_TABLE,
  PUBLIC_STATS_TABLE,
  IMAGE_CACHE_TABLE,
  USER_CONTENT_BUCKET,
  IMAGE_CACHE_BUCKET,
  IMAGE_CACHE_QUEUE,
} = process.env;

assert(JOB_TABLE, "JOB_TABLE must be set");
assert(QUEUE_URL, "QUEUE_URL must be set");
assert(ACTIVE_USER_TABLE, "ACTIVE_USER_TABLE must be set");
assert(PUBLIC_STATS_TABLE, "PUBLIC_STATS_TABLE must be set");
assert(IMAGE_CACHE_TABLE, "IMAGE_CACHE_TABLE must be set");
assert(USER_CONTENT_BUCKET, "USER_CONTENT_BUCKET must be set");
assert(IMAGE_CACHE_BUCKET, "IMAGE_CACHE_BUCKET must be set");
assert(IMAGE_CACHE_QUEUE, "IMAGE_CACHE_QUEUE must be set");

const queueName = QUEUE_URL?.split("/").pop();
const isFifo = queueName?.endsWith(".fifo");

export const initDynamoDb = async () => {
  const jobTable = {
    TableName: JOB_TABLE,
    KeySchema: [
      {
        AttributeName: "job_id",
        KeyType: "HASH",
      },
    ],
    AttributeDefinitions: [
      {
        AttributeName: "job_id",
        AttributeType: "S",
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  };

  const activeUserTable = {
    TableName: ACTIVE_USER_TABLE,
    KeySchema: [
      {
        AttributeName: "user_id",
        KeyType: "HASH",
      },
    ],
    AttributeDefinitions: [
      {
        AttributeName: "user_id",
        AttributeType: "S",
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  };

  const publicStatsTable = {
    TableName: PUBLIC_STATS_TABLE,
    KeySchema: [
      {
        AttributeName: "key",
        KeyType: "HASH",
      },
    ],
    AttributeDefinitions: [
      {
        AttributeName: "key",
        AttributeType: "S",
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  };

  const imageCacheTable = {
    TableName: IMAGE_CACHE_TABLE,
    KeySchema: [
      {
        AttributeName: "url",
        KeyType: "HASH",
      },
    ],
    AttributeDefinitions: [
      {
        AttributeName: "url",
        AttributeType: "S",
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  };

  await Promise.all([
    dynamodb.send(new CreateTableCommand(jobTable)),
    dynamodb.send(new CreateTableCommand(activeUserTable)),
    dynamodb.send(new CreateTableCommand(publicStatsTable)),
    dynamodb.send(new CreateTableCommand(imageCacheTable)),
  ]);
};

/**
 * This implementation only works for tables with 25 items or less.
 * @returns
 */
export const clearTable = async (tableName: string, primaryKey: string) => {
  const params = {
    TableName: tableName,
    ProjectionExpression: "#primaryKey",
    ExpressionAttributeNames: {
      "#primaryKey": primaryKey,
    },
  };

  const { Items } = await dynamodb.send(new ScanCommand(params));

  if (!Items || Items.length === 0) {
    return;
  }

  const params2 = {
    RequestItems: {
      [tableName]: Items.map((item) => ({
        DeleteRequest: {
          Key: {
            [primaryKey]: item[primaryKey],
          },
        },
      })),
    },
  };

  await dynamodb.send(new BatchWriteItemCommand(params2));
};

export const clearAllTables = async () => {
  await Promise.all(
    [
      [JOB_TABLE, "job_id"],
      [ACTIVE_USER_TABLE, "user_id"],
      [PUBLIC_STATS_TABLE, "key"],
      [IMAGE_CACHE_TABLE, "url"],
    ].map(([tableName, primaryKey]) => clearTable(tableName, primaryKey))
  );
};

export const deleteTable = async (tableName: string) => {
  const params = {
    TableName: tableName,
  };

  await dynamodb.send(new DeleteTableCommand(params));
};

export const deleteAllTables = async () => {
  await Promise.all(
    [JOB_TABLE, ACTIVE_USER_TABLE, PUBLIC_STATS_TABLE, IMAGE_CACHE_TABLE].map(
      deleteTable
    )
  );
};

export const initSQS = async () => {
  const mainQueue = {
    QueueName: queueName,
    Attributes: {
      FifoQueue: isFifo ? "true" : "false",
    },
  };

  const imageCacheQueue = {
    QueueName: IMAGE_CACHE_QUEUE,
    Attributes: {
      FifoQueue: IMAGE_CACHE_QUEUE.endsWith(".fifo") ? "true" : "false",
    },
  };

  await Promise.all([
    sqs.send(new CreateQueueCommand(mainQueue)),
    sqs.send(new CreateQueueCommand(imageCacheQueue)),
  ]);
};

export const deleteQueue = async (queueUrl: string) => {
  const params = {
    QueueUrl: queueUrl,
  };

  await sqs.send(new DeleteQueueCommand(params));
};

export const deleteAllQueues = async () => {
  await Promise.all(
    [QUEUE_URL, IMAGE_CACHE_QUEUE].map((queueUrl) => deleteQueue(queueUrl))
  );
};

export const purgeMainQueue = async () => {
  const params = {
    QueueUrl: QUEUE_URL,
  };

  await sqs.send(new PurgeQueueCommand(params));
};

export const purgeImageCacheQueue = async () => {
  const params = {
    QueueUrl: await getImageCacheQueueUrl(),
  };

  await sqs.send(new PurgeQueueCommand(params));
};

export const purgeAllQueues = async () => {
  await Promise.all([purgeMainQueue(), purgeImageCacheQueue()]);
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const initS3 = async () => {
  const userContentBucket = {
    Bucket: USER_CONTENT_BUCKET,
  };

  const imageCacheBucket = {
    Bucket: IMAGE_CACHE_BUCKET,
  };

  await Promise.all([
    s3.send(new CreateBucketCommand(userContentBucket)),
    s3.send(new CreateBucketCommand(imageCacheBucket)),
  ]);
};

export const clearBucket = async (bucketName: string) => {
  const params = {
    Bucket: bucketName,
  };

  const { Contents } = await s3.send(new ListObjectsCommand(params));

  if (!Contents) {
    return;
  }

  const params2 = {
    Bucket: bucketName,
    Delete: {
      Objects: Contents.map((item: any) => ({
        Key: item.Key,
      })),
    },
  };

  await s3.send(new DeleteObjectsCommand(params2));
};

export const clearAllBuckets = async () => {
  await Promise.all([USER_CONTENT_BUCKET, IMAGE_CACHE_BUCKET].map(clearBucket));
};

export const deleteBucket = async (bucketName: string) => {
  const params = {
    Bucket: bucketName,
  };

  await s3.send(new DeleteBucketCommand(params));
};

export const deleteAllBuckets = async () => {
  await Promise.all(
    [USER_CONTENT_BUCKET, IMAGE_CACHE_BUCKET].map(deleteBucket)
  );
};

export const randomString = (numChars: number) => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let str = "";

  for (let i = 0; i < numChars; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }

  return str;
};

// before(async () => {
//   await initDynamoDb();
//   await initSQS();
//   await initS3();
// });

// after(async () => {
//   await deleteTable();
//   await deleteQueue();
//   await deleteBucket();

//   setStayAlive(false);
// });
