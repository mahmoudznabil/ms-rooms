"use client";

import { getFirebaseAIModel } from "@/lib/firebase";
import { logAIEvent, trace } from "@/lib/metrics";

async function runModel(prompt: string, systemInstruction: string, modelName = "gemini-2.5-flash"): Promise<string> {
  const started = Date.now();
  try {
    const result = await trace("ai-generate", async () => {
      const model = await getFirebaseAIModel(modelName);
      const res = await model.generateContent({
        systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      return res.response.text();
    });
    logAIEvent("reply", Date.now() - started, true);
    return result;
  } catch (e) {
    logAIEvent("reply", Date.now() - started, false);
    throw e instanceof Error ? e : new Error("AI request failed");
  }
}

function tryParseJson<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

export async function aiChatReply(message: string, history: string[] = []): Promise<string> {
  const convo = history.slice(-8).join("\n");
  return runModel(
    `${convo ? `History:\n${convo}\n\n` : ""}User: ${message}`,
    "You are a friendly assistant in MS-ROOMS, a social audio party app. Keep replies short, warm, and under 300 characters."
  );
}

export async function aiSummarizeConversation(messages: Array<{ sender: string; content: string }>): Promise<{ summary: string; keyTopics: string[]; sentiment: "positive" | "neutral" | "negative" }> {
  const started = Date.now();
  try {
    const text = await runModel(
      messages.map((m) => `${m.sender}: ${m.content}`).join("\n"),
      "Summarize the chat. Return ONLY JSON: {\"summary\": string, \"keyTopics\": string[], \"sentiment\": \"positive\"|\"neutral\"|\"negative\"}."
    );
    const parsed = tryParseJson(text, { summary: text.slice(0, 500), keyTopics: [], sentiment: "neutral" as const });
    logAIEvent("summarize", Date.now() - started, true);
    return parsed;
  } catch {
    logAIEvent("summarize", Date.now() - started, false);
    return { summary: "Could not summarize right now.", keyTopics: [], sentiment: "neutral" };
  }
}

export async function aiModerateContent(content: string, context = "chat"): Promise<{ allowed: boolean; reason: string; severity: "none" | "low" | "medium" | "high" }> {
  const started = Date.now();
  try {
    const text = await runModel(
      `Message from ${context}: "${content.slice(0, 1000)}"`,
      "You are a content moderator. Return ONLY JSON: {\"allowed\": boolean, \"reason\": string, \"severity\": \"none\"|\"low\"|\"medium\"|\"high\"}. Block hate, harassment, sexual content involving minors, credible threats, spam."
    );
    const parsed = tryParseJson(text, { allowed: true, reason: "", severity: "none" as const });
    logAIEvent("moderate", Date.now() - started, true);
    return parsed;
  } catch {
    logAIEvent("moderate", Date.now() - started, false);
    return { allowed: true, reason: "", severity: "none" };
  }
}

export async function aiTranslate(text: string, targetLanguage = "en"): Promise<{ translatedText: string; detectedLanguage: string }> {
  const started = Date.now();
  try {
    const out = await runModel(
      `Translate to ${targetLanguage}: "${text.slice(0, 1000)}"`,
      "You are a translator. Return ONLY JSON: {\"translatedText\": string, \"detectedLanguage\": string}."
    );
    const parsed = tryParseJson(out, { translatedText: text, detectedLanguage: "unknown" });
    logAIEvent("translate", Date.now() - started, true, { target: targetLanguage });
    return parsed;
  } catch {
    logAIEvent("translate", Date.now() - started, false);
    return { translatedText: text, detectedLanguage: "unknown" };
  }
}

export async function aiSuggestReplies(recent: Array<{ sender: string; content: string }>): Promise<string[]> {
  const started = Date.now();
  try {
    const out = await runModel(
      recent.slice(-5).map((m) => `${m.sender}: ${m.content}`).join("\n"),
      "Suggest 3 short chat replies (<120 chars each). Return ONLY JSON: {\"suggestions\": string[]}."
    );
    const parsed = tryParseJson(out, { suggestions: [] as string[] });
    logAIEvent("suggest", Date.now() - started, true);
    return parsed.suggestions.slice(0, 3);
  } catch {
    logAIEvent("suggest", Date.now() - started, false);
    return [];
  }
}
