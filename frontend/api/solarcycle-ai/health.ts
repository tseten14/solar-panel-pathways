import { handleHealth } from "../_lib/survey-chat.js";

export function GET() {
  return handleHealth();
}
