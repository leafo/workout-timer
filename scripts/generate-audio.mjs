import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_TTS_MODEL = "gemini-2.5-pro-preview-tts";
const VOICE = "Kore";

const OUTPUT_DIR = join(import.meta.dirname, "..", "dist", "audio");

// Add new phrases here — each becomes a separate .mp3 file
const PHRASES = ["1", "2", "3", "Go", "Rest"];

function filenameFor(phrase) {
  return phrase.toLowerCase().replace(/\s+/g, "-") + ".mp3";
}

async function generateAudio(phrase, apiKey) {
  const url = `${GEMINI_API_BASE}/models/${GEMINI_TTS_MODEL}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: phrase }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: VOICE },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  const audioData = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!audioData) {
    throw new Error(`No audio data in response for "${phrase}"`);
  }

  return Buffer.from(audioData, "base64");
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: set GEMINI_API_KEY environment variable");
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const phrase of PHRASES) {
    const filename = filenameFor(phrase);
    process.stdout.write(`Generating "${phrase}" → ${filename} ... `);

    const audio = await generateAudio(phrase, apiKey);
    await writeFile(join(OUTPUT_DIR, filename), audio);

    console.log(`done (${audio.length} bytes)`);
  }

  console.log(`\nAll ${PHRASES.length} files written to ${OUTPUT_DIR}`);
}

main();
