// This app was built by CeeJay for Chinedum Aranotu – 2026
export const config = {
  maxDuration: 30,   // allow 30s instead of default 10s
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed')
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).send('Invalid JSON')
  }

  const { text, voice = 'nova', speed = 1.0 } = body
  if (!text) return res.status(400).send('Missing text')
  if (text.length > 1000) return res.status(400).send('Text too long')

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).send('No API key configured')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  try {
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
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).send(`OpenAI error: ${err}`)
    }

    const buffer = await response.arrayBuffer()
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.status(200).send(Buffer.from(buffer))

  } catch (e) {
    clearTimeout(timeout)
    if (e.name === 'AbortError') {
      return res.status(504).send('TTS request timed out')
    }
    return res.status(500).send('Server error: ' + e.message)
  }
}