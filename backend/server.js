import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import chatRoutes from "./routes/chat.js";

dotenv.config();
console.log("API KEY:", process.env.AGENTROUTER_API_KEY?.slice(0, 10));
console.log("BASE URL:", process.env.AGENTROUTER_BASE_URL);
console.log("MODEL:", process.env.AI_MODEL);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "NursePrep AI Backend is running 🚀",
  });
});

// AI Routes
app.use("/api/chat", chatRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});