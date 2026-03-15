// This app was built by CeeJay for Chinedum Aranotu – 2026
export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { text, voice = 'nova', speed = 1.0 } = body
  if (!text) return new Response('Missing text', { status: 400 })
  if (text.length > 4096) return new Response('Text too long', { status: 400 })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return new Response('NO API KEY FOUND IN ENVIRONMENT', { status: 500 })

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice,
      input: text,
      speed: Math.min(Math.max(Number(speed), 0.25), 4.0),
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    // Return the FULL OpenAI error so we can read it
    return new Response(`OpenAI said: ${response.status} — ${err}`, { status: response.status })
  }

  const audioBuffer = await response.arrayBuffer()
  return new Response(audioBuffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}