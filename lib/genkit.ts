// SERVER-ONLY Genkit flows (do not import from client components).
// Client AI uses Firebase AI Logic (lib/ai.ts). These flows power
// `genkit dev`, scripts, and future server execution.
import { genkit, z } from "genkit";
import { googleAI, gemini15Flash, gemini15Pro } from "@genkit-ai/googleai";

export const ai = genkit({
  plugins: [googleAI()],
  model: gemini15Flash,
});

export { gemini15Flash, gemini15Pro };

const MessageItem = z.object({
  sender: z.string(),
  content: z.string(),
  timestamp: z.string().optional(),
});

export const chatFlow = ai.defineFlow(
  {
    name: "chatFlow",
    inputSchema: z.object({
      message: z.string(),
      conversationHistory: z.array(z.string()).optional(),
      systemPrompt: z.string().optional(),
    }),
    outputSchema: z.object({ response: z.string() }),
  },
  async ({ message, conversationHistory = [], systemPrompt }) => {
    const history = conversationHistory.map((msg, i) => ({
      role: (i % 2 === 0 ? "user" : "model") as "user" | "model",
      content: [{ text: msg }],
    }));
    const res = await ai.generate({
      model: gemini15Flash,
      system:
        systemPrompt ??
        "You are a helpful AI assistant in MS-ROOMS, a social audio party app. Keep responses friendly and concise.",
      messages: [...history, { role: "user" as const, content: [{ text: message }] }],
    });
    return { response: res.text };
  }
);

export const summarizeConversationFlow = ai.defineFlow(
  {
    name: "summarizeConversation",
    inputSchema: z.object({ messages: z.array(MessageItem) }),
    outputSchema: z.object({
      summary: z.string(),
      keyTopics: z.array(z.string()),
      sentiment: z.enum(["positive", "neutral", "negative"]),
    }),
  },
  async ({ messages }) => {
    const messageText = messages.map((m) => `${m.sender}: ${m.content}`).join("\n");
    const res = await ai.generate({
      model: gemini15Flash,
      system:
        'Summarize the chat. Return ONLY JSON: {"summary": string, "keyTopics": string[], "sentiment": "positive"|"neutral"|"negative"}.',
      prompt: `Summarize this conversation:\n\n${messageText}`,
      output: { format: "json" },
    });
    return JSON.parse(res.text) as { summary: string; keyTopics: string[]; sentiment: "positive" | "neutral" | "negative" };
  }
);

export const moderateContentFlow = ai.defineFlow(
  {
    name: "moderateContent",
    inputSchema: z.object({ content: z.string(), context: z.string().optional() }),
    outputSchema: z.object({
      allowed: z.boolean(),
      reason: z.string().optional(),
      severity: z.enum(["none", "low", "medium", "high"]),
      categories: z.array(z.string()).optional(),
    }),
  },
  async ({ content, context }) => {
    const res = await ai.generate({
      model: gemini15Flash,
      system:
        'You are a content moderator. Return ONLY JSON: {"allowed": boolean, "reason": string, "severity": "none"|"low"|"medium"|"high", "categories": string[]}.',
      prompt: `Moderate this message from ${context ?? "chat"}: "${content}"`,
      output: { format: "json" },
    });
    return JSON.parse(res.text) as { allowed: boolean; reason?: string; severity: "none" | "low" | "medium" | "high"; categories?: string[] };
  }
);

export const translateMessageFlow = ai.defineFlow(
  {
    name: "translateMessage",
    inputSchema: z.object({ sourceText: z.string(), targetLanguage: z.string().default("en") }),
    outputSchema: z.object({ translatedText: z.string(), detectedLanguage: z.string() }),
  },
  async ({ sourceText, targetLanguage }) => {
    const res = await ai.generate({
      model: gemini15Flash,
      system: "You are a translator. Return ONLY JSON: {\"translatedText\": string, \"detectedLanguage\": string}.",
      prompt: `Translate to ${targetLanguage}: "${sourceText}"`,
      output: { format: "json" },
    });
    return JSON.parse(res.text) as { translatedText: string; detectedLanguage: string };
  }
);

export const suggestRepliesFlow = ai.defineFlow(
  {
    name: "suggestReplies",
    inputSchema: z.object({
      recentMessages: z.array(z.object({ sender: z.string(), content: z.string() })),
    }),
    outputSchema: z.object({ suggestions: z.array(z.string()) }),
  },
  async ({ recentMessages }) => {
    const messageText = recentMessages
      .slice(-5)
      .map((m) => `${m.sender}: ${m.content}`)
      .join("\n");
    const res = await ai.generate({
      model: gemini15Flash,
      system:
        "Suggest 3 short chat replies (<120 chars each). Return ONLY JSON: {\"suggestions\": string[]}.",
      prompt: `Suggest 3 replies for this conversation:\n\n${messageText}`,
      output: { format: "json" },
    });
    return JSON.parse(res.text) as { suggestions: string[] };
  }
);

export const suggestRoomTopicsFlow = ai.defineFlow(
  {
    name: "suggestRoomTopics",
    inputSchema: z.object({
      conversationHistory: z.array(z.object({ sender: z.string(), content: z.string() })),
    }),
    outputSchema: z.object({ topics: z.array(z.string()) }),
  },
  async ({ conversationHistory }) => {
    const messageText = conversationHistory
      .slice(-20)
      .map((m) => `${m.sender}: ${m.content}`)
      .join("\n");
    const res = await ai.generate({
      model: gemini15Flash,
      system: "Suggest 5 engaging room discussion topics. Return ONLY JSON: {\"topics\": string[]}.",
      prompt: `Based on this conversation, suggest 5 room topics:\n\n${messageText}`,
      output: { format: "json" },
    });
    return JSON.parse(res.text) as { topics: string[] };
  }
);
