// This app was built by CeeJay for Chinedum Aranotu – 2026
export const config = { maxDuration: 20 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')

  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body }
  catch { return res.status(400).send('Invalid JSON') }

  const { chapterTitle, text } = body
  if (!text) return res.status(400).send('Missing text')

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).send('No API key')

  const prompt = `You are a helpful reading assistant. Summarize the following excerpt from the chapter titled "${chapterTitle}" in exactly 2 sentences. Be concise and informative. Do not say "This chapter" — just state what happens or is discussed.\n\nText:\n${text.slice(0, 1000)}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0.4,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    return res.status(response.status).send(`OpenAI error: ${err}`)
  }

  const data = await response.json()
  const summary = data.choices?.[0]?.message?.content?.trim() || ''
  return res.status(200).json({ summary })
}
