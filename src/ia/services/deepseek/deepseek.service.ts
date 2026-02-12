import OpenAI from "openai";

export class DeepSeekService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
  }

  async createChatCompletion(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  ) {
    const completion = await this.client.chat.completions.create({
      model: "deepseek-chat",
      messages,
    });

    return completion.choices[0].message.content;
  }
}
