export const modelErrorMessages = [
  'Provider authentication failed', 'Model request failed', 'Model unavailable', 'Model response failed',
  'Provider quota or rate limit reached. Check your account and retry.',
  'This model is unavailable or unsupported. Check the model ID.',
  'Could not reach the model server. Check the connection and retry.',
  'Model response was interrupted. Retry to complete the answer.',
  'Model returned no answer. Try another model or retry.',
  'Model reached its response limit. Ask a shorter question or continue from the partial answer.',
  'Provider filtered this response. Rephrase the request and retry.',
  'Model requested an unsupported action. Try another model.',
  'Model answer exceeded the size limit. Ask for a shorter response.',
  'Model returned an invalid response. Try another model or retry.',
]

export function generationError(message?: string) {
  if (message === 'Provider authentication failed') return 'The provider rejected the saved token. Replace it in Model connection.'
  if (message === 'Model unavailable' || message === 'Model request failed') return 'Could not reach the model server. Check Model connection and retry.'
  if (message === 'Generation stopped') return 'Generation stopped. Your partial answer is kept.'
  return message && modelErrorMessages.includes(message) && message !== 'Model response failed'
    ? message : 'ICARUS could not complete this request. Try again.'
}
