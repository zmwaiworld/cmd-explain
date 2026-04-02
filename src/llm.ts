/**
 * Tier 3: LLM fallback (optional).
 * Calls Ollama, OpenAI, or Anthropic to explain unknown commands.
 * Only active if the user has configured the relevant env vars.
 */

const PROMPT_TEMPLATE = `Explain this CLI command in one sentence for a developer. Be concise and specific about what it does. Do not include the command itself in the explanation.

Command: {command}

Explanation:`;

interface LLMConfig {
  provider: "ollama" | "openai" | "anthropic";
  url: string;
  model: string;
  apiKey?: string;
}

function getConfig(): LLMConfig | null {
  const ollamaModel = process.env.OLLAMA_MODEL;
  if (ollamaModel) {
    return {
      provider: "ollama",
      url: process.env.OLLAMA_URL || "http://localhost:11434",
      model: ollamaModel,
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: "openai",
      url: "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      apiKey: openaiKey,
    };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      provider: "anthropic",
      url: "https://api.anthropic.com/v1",
      model: process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307",
      apiKey: anthropicKey,
    };
  }

  return null;
}

export function isLLMAvailable(): boolean {
  return getConfig() !== null;
}

export async function explainWithLLM(command: string): Promise<string | null> {
  const config = getConfig();
  if (!config) return null;

  const prompt = PROMPT_TEMPLATE.replace("{command}", command);

  try {
    switch (config.provider) {
      case "ollama":
        return await callOllama(config, prompt);
      case "openai":
        return await callOpenAI(config, prompt);
      case "anthropic":
        return await callAnthropic(config, prompt);
    }
  } catch {
    return null;
  }
}

async function callOllama(config: LLMConfig, prompt: string): Promise<string | null> {
  const res = await fetch(`${config.url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      prompt,
      stream: false,
      options: { temperature: 0, num_predict: 100 },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { response?: string };
  return data.response?.trim() || null;
}

async function callOpenAI(config: LLMConfig, prompt: string): Promise<string | null> {
  const res = await fetch(`${config.url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function callAnthropic(config: LLMConfig, prompt: string): Promise<string | null> {
  const res = await fetch(`${config.url}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text?.trim() || null;
}
