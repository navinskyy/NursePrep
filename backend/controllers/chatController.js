import { sendMessage } from "../services/ai/chatService.js";

export async function chat(req, res) {
  try {
    const { message } = req.body;

    // Validate request
    if (!message || message.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Message is required.",
      });
    }

    // Get AI response
    const reply = await sendMessage(message);

    // Return response
    res.status(200).json({
      success: true,
      reply,
    });

  } catch (error) {
    console.error("Chat Controller Error:", error);

    res.status(500).json({
      success: false,
      error: "Something went wrong while talking to the AI.",
    });
  }
}