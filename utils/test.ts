import { codingAgent } from "./agent";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

codingAgent(
  "Explore https://checklyhq.com",
)
  .then(console.log)
  .catch(console.error);
