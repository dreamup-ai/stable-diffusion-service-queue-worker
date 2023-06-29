import { PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import assert from "node:assert";
import { cloudwatch, dynamodb } from "./clients";

const { PUBLIC_STATS_TABLE, IMAGE_COUNT_KEY } = process.env;

assert(PUBLIC_STATS_TABLE, "PUBLIC_STATS_TABLE must be set");
assert(IMAGE_COUNT_KEY, "IMAGE_COUNT_KEY must be set");

export async function emitStatusMetric(status: string) {
  const params = {
    Namespace: "dreamup-unified-gpu",
    MetricData: [
      {
        MetricName: status,
        Value: 1,
        Unit: "None",
        Timestamp: new Date(),
      },
    ],
  };
  try {
    await cloudwatch.send(new PutMetricDataCommand(params));
  } catch (e: any) {
    console.error("Failed to emit metric data");
    console.error(e);
  }
}

export async function incrementImagesGeneratedCount() {
  const params = {
    TableName: PUBLIC_STATS_TABLE,
    Key: {
      key: {
        S: IMAGE_COUNT_KEY as string,
      },
    },
    UpdateExpression: "ADD #count :increment",
    ExpressionAttributeNames: {
      "#count": "value",
    },
    ExpressionAttributeValues: {
      ":increment": {
        N: "1",
      },
    },
    ReturnValues: "NONE",
  };

  try {
    await dynamodb.send(new UpdateItemCommand(params));
  } catch (e: any) {
    console.error("Failed to increment image count");
    console.error(e);
  }
}
