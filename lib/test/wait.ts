import { setTimeout } from "node:timers/promises";

export default async function wait({ until }: { until: Function }) {
  let d = 5;
  while (!(await until())) {
    await setTimeout(d);
    d = Math.min(1000, d * 1.2);
  }
}
