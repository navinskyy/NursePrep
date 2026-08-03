import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.AGENTROUTER_API_KEY,
  baseURL: process.env.AGENTROUTER_BASE_URL,
});

export default client;