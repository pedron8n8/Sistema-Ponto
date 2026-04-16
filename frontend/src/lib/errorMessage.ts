const URL_PATTERN = /(https?:\/\/[^\s]+)/i

type ParsedMessageLink = {
  text: string
  url: string | null
}

export const splitMessageLink = (rawMessage: string): ParsedMessageLink => {
  const message = String(rawMessage || '').trim()
  if (!message) {
    return {
      text: '',
      url: null,
    }
  }

  const match = message.match(URL_PATTERN)
  if (!match) {
    return {
      text: message,
      url: null,
    }
  }

  const matchedUrl = match[0]
  const normalizedUrl = matchedUrl.replace(/[),.;!?]+$/, '')
  const textWithoutUrl = message
    .replace(matchedUrl, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+(em|at)$/i, '')
    .trim()

  return {
    text: textWithoutUrl,
    url: normalizedUrl,
  }
}