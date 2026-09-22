import { handleChat } from "../_lib/survey-chat.js";

export function POST(request: Request) {
  return handleChat(request);
}
