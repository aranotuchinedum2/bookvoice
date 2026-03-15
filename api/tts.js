import OpenAI from 'openai';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { text, voice = 'alloy', speed = 1.0 } = await req.json();
  if (!text) return new Response('Missing text', { status: 400 });
  // Limit text length for cost control
  if (text.length > 4096) return new Response('Text too long', { status: 400 });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const mp3 = await openai.audio.speech.create({
    model: 'tts-1',
    voice,       // alloy | echo | fable | onyx | nova | shimmer
    input: text,
    speed,
  });

  const buffer = await mp3.arrayBuffer();
  return new Response(buffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400', // cache identical audio
    },
  });
}