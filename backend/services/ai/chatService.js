import client from "./client.js";
import { SYSTEM_PROMPT } from "./prompts.js";

export async function sendMessage(message) {
  try {
    const completion = await client.chat.completions.create({
      model: process.env.AI_MODEL,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    return completion.choices[0].message.content;

  } catch (error) {
    console.log("========== FULL ERROR ==========");
    console.dir(error, { depth: null });

    throw error;
  }
}