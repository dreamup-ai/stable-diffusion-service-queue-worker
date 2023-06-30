import { ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import assert from "node:assert";
import { sqs as sqsClient } from "./clients";
import { getCachedImageViaQueue, uploadImageToS3 } from "./image-utils";
import { setJobStatus } from "./job-utils";
const {
  QUEUE_URL,
  STABLE_DIFFUSION_SERVICE_URL,
  SALAD_API_KEY,
  JOB_TABLE,
  USER_CONTENT_BUCKET,
  NUM_WORKERS = "1",
} = process.env;

assert(QUEUE_URL, "QUEUE_URL must be set");
assert(
  STABLE_DIFFUSION_SERVICE_URL,
  "STABLE_DIFFUSION_SERVICE_URL must be set"
);
assert(JOB_TABLE, "JOB_TABLE must be set");
assert(USER_CONTENT_BUCKET, "USER_CONTENT_BUCKET must be set");

const baseUrl = new URL(STABLE_DIFFUSION_SERVICE_URL);
const numWorkers = parseInt(NUM_WORKERS, 10);

export let stayAlive = true;
export const setStayAlive = (value: boolean) => {
  stayAlive = value;
};
process.on("SIGINT", () => {
  stayAlive = false;
});

async function main() {
  while (stayAlive) {
    const { Messages } = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: numWorkers,
        WaitTimeSeconds: 20,
      })
    );
    console.log("Received messages", Messages?.length || 0);
    if (Messages && Messages.length > 0) {
      const settled = await Promise.allSettled(
        Messages.map(async ({ Body, ReceiptHandle }) => {
          if (!Body || !ReceiptHandle) return;

          const timeStarted = Date.now();

          const job = JSON.parse(Body);

          console.log(`Processing job ${job.id}`);
          setJobStatus(job.id, "running");
          const url = new URL(`/image`, baseUrl);

          if (job.params.image) {
            try {
              const img = await getCachedImageViaQueue(job.params.image);
              job.params.image = img.toString("base64");
            } catch (e: any) {
              console.error(job.id, e);
              return setJobStatus(job.id, "failed", ReceiptHandle);
            }
          }

          if (job.params.mask_image) {
            try {
              const img = await getCachedImageViaQueue(job.params.mask_image);
              job.params.mask_image = img.toString("base64");
            } catch (e: any) {
              console.error(job.id, e);
              return setJobStatus(job.id, "failed", ReceiptHandle);
            }
          }

          /**
           * Send the job to the service
           */
          const reqInfo = {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            } as any,
            body: JSON.stringify(job),
          };
          if (SALAD_API_KEY) {
            reqInfo.headers["Salad-Api-Key"] = SALAD_API_KEY;
          }
          console.log("Sending request to", url.toString());
          const result = await fetch(url.toString(), reqInfo);
          if (!result.ok) {
            console.error(job.id, await result.text());

            return setJobStatus(job.id, "failed", ReceiptHandle);
          }

          let response: any;
          try {
            const resultJson = await result.json();
            if (resultJson.error) {
              console.error(job.id, resultJson.error);
              return setJobStatus(job.id, "failed", ReceiptHandle);
            }
            response = resultJson;
          } catch (e: any) {
            console.error(job.id, e);
            return setJobStatus(job.id, "failed", ReceiptHandle);
          }

          const { image, seed, nsfw, gpu_duration } = response;

          if (!image) {
            return setJobStatus(job.id, "failed", ReceiptHandle);
          }

          try {
            await uploadImageToS3(
              USER_CONTENT_BUCKET as string,
              job.output_key,
              Buffer.from(image, "base64")
            );
          } catch (e: any) {
            console.error(job.id, e);
            return setJobStatus(job.id, "failed", ReceiptHandle);
          }

          const timeCompleted = Date.now();
          const jobTime = (timeCompleted - timeStarted) / 1000;

          await Promise.all([
            setJobStatus(
              job.id,
              "completed",
              ReceiptHandle,
              jobTime,
              gpu_duration,
              nsfw,
              seed,
              job.output_key
            ),
          ]);
        })
      );

      const failed = settled.filter((s) => s.status === "rejected");
      if (failed.length > 0) {
        failed.forEach((f) => console.error(f));
      }
    }
  }
}

main();
