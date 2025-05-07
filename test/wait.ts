import { callback, delay } from "awaiting";

export default async function wait({ until }: { until: Function }) {
  let d = 5;
  while (!(await until())) {
    await delay(d);
    d = Math.min(1000, d * 1.2);
  }
}

import type { EventEmitter } from "events";

export async function once(obj: EventEmitter, event: string): Promise<any> {
  if (obj == null) {
    throw Error("once -- obj is undefined");
  }
  if (typeof obj.once != "function") {
    throw Error("once -- obj.once must be a function");
  }
  let val: any[] = [];
  function wait(cb: Function): void {
    obj.once(event, function (...args): void {
      val = args;
      cb();
    });
  }
  await callback(wait);
  return val;
}
