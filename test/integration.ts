import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import { dynamodb, s3, sqs } from "../src/clients";

import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  clearAllBuckets,
  clearAllTables,
  purgeAllQueues,
  randomString,
  sleep,
} from "./util";

import controlnetJob from "./fixtures/controlnet-job.json";
import img2imgJob from "./fixtures/img2img-job.json";
import text2imgJob from "./fixtures/text2img-job.json";

const { USER_CONTENT_BUCKET, IMAGE_CACHE_TABLE } = process.env;

const regularImageKey = "original.png";
const controlImageKey = "openpose.png";

describe("Integration test", () => {
  before(async () => {
    await clearAllTables();
    await purgeAllQueues();
    await clearAllBuckets();

    // Put an image in the bucket, and register it in the cache table
    const regularImage = fs.readFileSync("test/fixtures/original.png");
    const putObjCmd1 = new PutObjectCommand({
      Bucket: USER_CONTENT_BUCKET!,
      Key: regularImageKey,
      Body: regularImage,
    });
    await s3.send(putObjCmd1);

    const putItemCmd1 = new PutItemCommand({
      TableName: IMAGE_CACHE_TABLE!,
      Item: {
        url: { S: "https://example.com/original.png" },
        original: { S: regularImageKey },
        bucket: { S: USER_CONTENT_BUCKET! },
        status: { S: "success" },
      },
    });

    await dynamodb.send(putItemCmd1);

    const controlImage = fs.readFileSync("test/fixtures/openpose.png");
    const putObjCmd2 = new PutObjectCommand({
      Bucket: USER_CONTENT_BUCKET!,
      Key: controlImageKey,
      Body: controlImage,
    });
    await s3.send(putObjCmd2);

    const putItemCmd2 = new PutItemCommand({
      TableName: IMAGE_CACHE_TABLE!,
      Item: {
        url: { S: "https://example.com/openpose.png" },
        original: { S: controlImageKey },
        bucket: { S: USER_CONTENT_BUCKET! },
        status: { S: "success" },
      },
    });

    await dynamodb.send(putItemCmd2);
  });

  after(async () => {
    await clearAllTables();
    await purgeAllQueues();
    await clearAllBuckets();
  });

  it("works for text2img", async () => {
    // Submit a job to sqs, wait for it to be processed
    // and check that the output is correct

    // Submit the job
    const params = {
      QueueUrl: process.env.QUEUE_URL!,
      MessageBody: JSON.stringify(text2imgJob),
      MessageGroupId: randomString(10),
      MessageDeduplicationId: randomString(10),
    };

    await sqs.send(new SendMessageCommand(params));

    let retries = 0;
    let item;
    while (retries < 45) {
      retries += 1;
      console.log("Checking for job completion");
      await sleep(1000);

      // Check job table for status
      const { Item } = await dynamodb.send(
        new GetItemCommand({
          TableName: process.env.JOB_TABLE!,
          Key: {
            job_id: { S: text2imgJob.id },
          },
        })
      );

      if (!Item) {
        console.log("Item not found, trying again");
        continue;
      }

      const { status } = Item;

      if (!status) {
        throw new Error("Status not found");
      }

      if (status.S === "failed") {
        throw new Error("Job failed");
      }

      if (status.S !== "completed") {
        console.log(status.S);
        continue;
      }

      item = Item;
      break;
    }

    if (!item) {
      throw new Error("Item not found");
    }

    // Check that the output file exists
    const { Body } = (await s3.send(
      new GetObjectCommand({
        Bucket: USER_CONTENT_BUCKET!,
        Key: item.output_key.S,
      })
    )) as { Body: NodeJS.ReadableStream };

    if (!Body) {
      throw new Error("Body not found");
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of Body) {
      chunks.push(chunk as Buffer);
    }

    const buffer = Buffer.concat(chunks);

    // Write the output to the fixtures dir
    fs.writeFileSync("test/fixtures/text2img.png", buffer);
  }).timeout(45000);

  it("works for img2img", async () => {
    // Submit a job to sqs, wait for it to be processed
    // and check that the output is correct

    // Submit the job
    const params = {
      QueueUrl: process.env.QUEUE_URL!,
      MessageBody: JSON.stringify(img2imgJob),
      MessageGroupId: randomString(10),
      MessageDeduplicationId: randomString(10),
    };

    await sqs.send(new SendMessageCommand(params));

    let retries = 0;
    let item;
    while (retries < 45) {
      retries += 1;
      console.log("Checking for job completion");
      await sleep(1000);

      // Check job table for status
      const { Item } = await dynamodb.send(
        new GetItemCommand({
          TableName: process.env.JOB_TABLE!,
          Key: {
            job_id: { S: img2imgJob.id },
          },
        })
      );

      if (!Item) {
        console.log("Item not found, trying again");
        continue;
      }

      const { status } = Item;

      if (!status) {
        throw new Error("Status not found");
      }

      if (status.S === "failed") {
        throw new Error("Job failed");
      }

      if (status.S !== "completed") {
        console.log(status.S);
        continue;
      }

      item = Item;
      break;
    }

    if (!item) {
      throw new Error("Item not found");
    }

    // Check that the output file exists
    const { Body } = (await s3.send(
      new GetObjectCommand({
        Bucket: USER_CONTENT_BUCKET!,
        Key: item.output_key.S,
      })
    )) as { Body: NodeJS.ReadableStream };

    if (!Body) {
      throw new Error("Body not found");
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of Body) {
      chunks.push(chunk as Buffer);
    }

    const buffer = Buffer.concat(chunks);

    // Write the output to the fixtures dir
    fs.writeFileSync("test/fixtures/img2img.png", buffer);
  }).timeout(45000);

  it("works for a controlnet job", async () => {
    // Submit a job to sqs, wait for it to be processed
    // and check that the output is correct

    // Submit the job
    const params = {
      QueueUrl: process.env.QUEUE_URL!,
      MessageBody: JSON.stringify(controlnetJob),
      MessageGroupId: randomString(10),
      MessageDeduplicationId: randomString(10),
    };

    await sqs.send(new SendMessageCommand(params));

    let retries = 0;
    let item;
    while (retries < 45) {
      retries += 1;
      console.log("Checking for job completion");
      await sleep(1000);

      // Check job table for status
      const { Item } = await dynamodb.send(
        new GetItemCommand({
          TableName: process.env.JOB_TABLE!,
          Key: {
            job_id: { S: controlnetJob.id },
          },
        })
      );

      if (!Item) {
        console.log("Item not found, trying again");
        continue;
      }

      const { status } = Item;

      if (!status) {
        throw new Error("Status not found");
      }

      if (status.S === "failed") {
        throw new Error("Job failed");
      }

      if (status.S !== "completed") {
        console.log(status.S);
        continue;
      }

      item = Item;
      break;
    }

    if (!item) {
      throw new Error("Item not found");
    }

    // Check that the output file exists
    const { Body } = (await s3.send(
      new GetObjectCommand({
        Bucket: USER_CONTENT_BUCKET!,
        Key: item.output_key.S,
      })
    )) as { Body: NodeJS.ReadableStream };

    if (!Body) {
      throw new Error("Body not found");
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of Body) {
      chunks.push(chunk as Buffer);
    }

    const buffer = Buffer.concat(chunks);

    // Write the output to the fixtures dir
    fs.writeFileSync("test/fixtures/controlnet.png", buffer);
  }).timeout(45000);
});
