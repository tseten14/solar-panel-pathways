import { describe, it, expect, vi } from "vitest";
import { buildSystemPrompt, handleChat, handleHealth, sanitiseMessages, summariseSurvey } from "../../api/_lib/survey-chat";
import type { SurveySite } from "@/lib/solarcycle";

function site(overrides: Partial<SurveySite>): SurveySite {
  return {
    id: overrides.name ?? "x",
    state: "AZ",
    name: "Test Landfill",
    type: null,
    pvStatus: "not_surveyed",
    pvRaw: "",
    acceptLqg: null,
    restrictions: null,
    owner: null,
    phone: null,
    altContact: null,
    location: null,
    website: null,
    cost: null,
    costPer: null,
    costUnit: null,
    costPerPanel: null,
    usedInCalc: null,
    callNotes: null,
    notes: null,
    ...overrides,
  };
}

const SITES = [
  site({ name: "Red Rock Landfill", pvStatus: "accepts", pvRaw: "Yes", costPerPanel: 2.1, cost: 60 }),
  site({ name: "Cerbat Landfill", pvStatus: "declines", pvRaw: "No" }),
  site({ name: "Ely", state: "NV" }),
];

function chatRequest(messages: unknown) {
  return new Request("http://localhost/api/solarcycle-ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text
    .trim()
    .split("\n\n")
    .map((block) => {
      const [eventLine, dataLine] = block.split("\n");
      return { event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) };
    });
}

function openAiStream(chunks: string[]) {
  const body = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("");
  return new Response(`${body}data: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}

describe("survey chat prompt", () => {
  it("summarises acceptance by state and the price range", () => {
    const summary = summariseSurvey(SITES);
    expect(summary.rows).toBe(3);
    expect(summary.by_state.AZ).toEqual({ total: 2, accepts: 1, declines: 1 });
    expect(summary.cheapest_per_panel).toBe(2.1);
  });

  it("includes every row and drops empty fields", () => {
    const prompt = buildSystemPrompt(SITES);
    expect(prompt).toContain("Cerbat Landfill");
    expect(prompt).not.toContain('"restrictions":null');
  });

  it("only accepts conversations that end with a user turn", () => {
    expect(sanitiseMessages([])).toBeNull();
    expect(sanitiseMessages([{ role: "assistant", content: "hi" }])).toBeNull();
    expect(sanitiseMessages([{ role: "system", content: "x" }, { role: "user", content: "hi" }])).toEqual([
      { role: "user", content: "hi" },
    ]);
  });
});

describe("survey chat handler", () => {
  it("reports whether a key is configured", async () => {
    expect(await handleHealth({ apiKey: "" }).json()).toMatchObject({ configured: false });
    expect(await handleHealth({ apiKey: "sk-test" }).json()).toMatchObject({ configured: true });
  });

  it("rejects an empty conversation", async () => {
    const res = await handleChat(chatRequest([]), { apiKey: "sk-test", sites: SITES });
    expect(res.status).toBe(422);
  });

  it("explains a missing key instead of failing silently", async () => {
    const res = await handleChat(chatRequest([{ role: "user", content: "hi" }]), { apiKey: "", sites: SITES });
    const events = await readEvents(res);
    expect(events[0].event).toBe("error");
    expect(events[0].data.message).toContain("OPENAI_API_KEY");
    expect(events.at(-1)?.event).toBe("done");
  });

  it("streams the model's reply and sends the survey as the system prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(openAiStream(["Red Rock ", "accepts panels."]));
    const res = await handleChat(chatRequest([{ role: "user", content: "Who accepts panels?" }]), {
      apiKey: "sk-test",
      model: "test-model",
      sites: SITES,
      fetchImpl,
    });
    const events = await readEvents(res);
    const text = events.filter((e) => e.event === "assistant_delta").map((e) => e.data.text).join("");

    expect(text).toBe("Red Rock accepts panels.");
    expect(events.at(-1)?.event).toBe("done");
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent.model).toBe("test-model");
    expect(sent.messages[0].role).toBe("system");
    expect(sent.messages[0].content).toContain("Red Rock Landfill");
    expect(sent.messages.at(-1)).toEqual({ role: "user", content: "Who accepts panels?" });
  });

  it("turns an OpenAI rate limit into a readable message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    const res = await handleChat(chatRequest([{ role: "user", content: "hi" }]), {
      apiKey: "sk-test",
      sites: SITES,
      fetchImpl,
    });
    const events = await readEvents(res);
    expect(events[0]).toEqual({ event: "error", data: { message: expect.stringContaining("busy") } });
  });

  it("loads the bundled survey when no sites are injected", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(openAiStream(["ok"]));
    await (await handleChat(chatRequest([{ role: "user", content: "hi" }]), { apiKey: "sk-test", fetchImpl })).text();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[0].content).toContain("Arizona Strip Landfill");
  });
});
