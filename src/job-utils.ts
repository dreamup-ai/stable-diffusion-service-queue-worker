import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { DeleteMessageCommand } from "@aws-sdk/client-sqs";
import assert from "node:assert";
import { dynamodb as dynamoClient, sqs as sqsClient } from "./clients";
import { emitStatusMetric, incrementImagesGeneratedCount } from "./metrics";

const { JOB_TABLE, QUEUE_URL, USER_CONTENT_BUCKET, ACTIVE_USER_TABLE } =
  process.env;
assert(JOB_TABLE, "JOB_TABLE must be set");
assert(QUEUE_URL, "QUEUE_URL must be set");
assert(USER_CONTENT_BUCKET, "USER_CONTENT_BUCKET must be set");
assert(ACTIVE_USER_TABLE, "ACTIVE_USER_TABLE must be set");

export const setJobStatus = async (
  jobId: string,
  status: string,
  receiptHandle: string | undefined = undefined,
  job_time: number | undefined = undefined,
  gpu_time: number | undefined = undefined,
  is_nsfw: boolean | undefined = undefined,
  seed: number | undefined = undefined,
  output_key: string | undefined = undefined
) => {
  console.log(`Setting job ${jobId} status to ${status}`);
  // We are going to add a timestamp to the job status
  // so we can see how long it took to process the job
  const statusToTimeField: {
    [key: string]: string;
  } = {
    running: "time_started",
    completed: "time_completed",
    failed: "time_failed",
  };

  if (!statusToTimeField[status]) {
    throw new Error(`Invalid status: ${status}`);
  }

  const promises: any[] = [];

  const params = {
    TableName: JOB_TABLE,
    Key: {
      job_id: { S: jobId },
    },
    UpdateExpression: `SET #status = :status, #timeField = :time`,
    ExpressionAttributeNames: {
      "#status": "status",
      "#timeField": statusToTimeField[status],
    } as any,
    ExpressionAttributeValues: {
      ":status": { S: status },
      ":time": { N: (Date.now() / 1000).toString() },
    } as any,
  };

  if (job_time) {
    params.UpdateExpression += ", #job_time = :job_time";
    params.ExpressionAttributeNames["#job_time"] = "job_time";
    params.ExpressionAttributeValues[":job_time"] = { N: job_time.toString() };
  }

  if (gpu_time) {
    params.UpdateExpression += ", #gpu_time = :gpu_time";
    params.ExpressionAttributeNames["#gpu_time"] = "gpu_time";
    params.ExpressionAttributeValues[":gpu_time"] = { N: gpu_time.toString() };
  }

  if (status === "completed") {
    params.UpdateExpression +=
      ", #is_nsfw = :is_nsfw, #seed = :seed, #output_bucket = :output_bucket, #output_key = :output_key";
    params.ExpressionAttributeNames["#is_nsfw"] = "is_nsfw";
    params.ExpressionAttributeNames["#seed"] = "seed";
    params.ExpressionAttributeNames["#output_bucket"] = "output_bucket";
    params.ExpressionAttributeNames["#output_key"] = "output_key";
    params.ExpressionAttributeValues[":is_nsfw"] = { BOOL: is_nsfw };
    params.ExpressionAttributeValues[":seed"] = { N: seed!.toString() };
    params.ExpressionAttributeValues[":output_bucket"] = {
      S: USER_CONTENT_BUCKET,
    };
    params.ExpressionAttributeValues[":output_key"] = { S: output_key };
    promises.push(
      incrementImagesGeneratedCount(),
      emitStatusMetric("stable-diffusion.completed")
    );
  } else if (status === "failed") {
    promises.push(emitStatusMetric("stable-diffusion.failed"));
  }

  if (receiptHandle) {
    promises.push(
      sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: receiptHandle,
        })
      )
    );
  }

  promises.push(dynamoClient.send(new UpdateItemCommand(params)));

  await Promise.all(promises);
};

export const decrementUserJobCount = async (userId: string) => {
  const params = {
    TableName: ACTIVE_USER_TABLE,
    Key: {
      user_id: { S: userId },
    },
    UpdateExpression: "ADD #job_count :decrement",
    ExpressionAttributeNames: {
      "#job_count": "num_in_queue",
    },
    ExpressionAttributeValues: {
      ":decrement": { N: "-1" },
    },
    ReturnValues: "NONE",
  };

  try {
    await dynamoClient.send(new UpdateItemCommand(params));
  } catch (e: any) {
    console.error(`Failed to decrement job count for user ${userId}: ${e}`);
  }
};
