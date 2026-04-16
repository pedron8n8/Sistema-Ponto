const {
  issuePublicApiToken,
  verifyPublicApiToken,
  maskPublicApiToken,
} = require('../utils/publicApiToken');

const createPublicApiTokenService = ({
  issueFn = issuePublicApiToken,
  verifyFn = verifyPublicApiToken,
  maskFn = maskPublicApiToken,
} = {}) => ({
  issueToken: (payload) => issueFn(payload),
  verifyToken: (token) => verifyFn(token),
  maskToken: (token) => maskFn(token),
});

module.exports = {
  createPublicApiTokenService,
};
