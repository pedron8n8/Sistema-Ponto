class PublicApiError extends Error {
  constructor({
    status = 500,
    error = 'Internal Server Error',
    message = 'Erro inesperado na API pública.',
    code,
  } = {}) {
    super(message);
    this.name = 'PublicApiError';
    this.status = status;
    this.error = error;
    this.code = code;
  }
}

module.exports = PublicApiError;
