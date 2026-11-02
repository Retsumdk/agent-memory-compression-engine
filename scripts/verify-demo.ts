import { runDemo } from "../src/demo.js";
import { DEMO_OUTPUT } from "../src/demo-output.js";

const actual = runDemo();
if (actual !== DEMO_OUTPUT) {
  console.error("demo output mismatch");
  process.exit(1);
}
console.log("demo output OK");
