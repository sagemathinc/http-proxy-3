import { delay } from "awaiting";

export default async function wait({ until }: { until: Function }) {
  let d = 5;
  while (!(await until())) {
    await delay(d);
    d = Math.min(1000, d * 1.2);
  }
}
