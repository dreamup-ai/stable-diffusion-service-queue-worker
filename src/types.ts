export type JobStatusUpdate = {
  job: any;
  status: string;
  receiptHandle?: string;
  job_time?: number;
  gpu_time?: number;
  is_nsfw?: boolean;
  seed?: number;
  output_key?: string;
};

export enum JobType {
  StableDiffusion = "stable-diffusion",
}

export enum Pipeline {
  text2img = "text2img",
  img2img = "img2img",
  controlnet = "controlnet",
  controlnet_img2img = "controlnet_img2img",
  inpaint = "inpaint",
}

export type JobFromQueue = {
  id: string;
  user_id: string;
  type: JobType;
  model: string;
  output_key: string;
  pipeline: Pipeline;
  params: {
    height?: number;
    width?: number;
    num_inference_steps: number;
    seed?: number;
    guidance_scale: number;
    prompt: string;
    negative_prompt?: string;
    eta?: number;
    strength?: number;
    scheduler?: string;
    image?: string; // url
    mask_image?: string; // url
    control_image?: string; // url
  };
};
