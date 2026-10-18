import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

// 各分部的培训资料，在 /training 下。id 是 `<分部>/<资料>`，和 src/lib/training.ts 一致。
const training = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/training" }),
});

export const collections = { training };
