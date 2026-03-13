const DEFAULT_THRESHOLD = Number(process.env.FACIAL_MATCH_THRESHOLD_DEFAULT || 0.45);

const normalizeEmbedding = (embedding) => {
  if (!Array.isArray(embedding)) {
    return null;
  }

  if (embedding.length < 64) {
    return null;
  }

  const normalized = embedding.map((value) => Number(value));

  if (normalized.some((value) => Number.isNaN(value) || !Number.isFinite(value))) {
    return null;
  }

  return normalized;
};

const euclideanDistance = (vectorA, vectorB) => {
  if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
    return null;
  }

  let sum = 0;

  for (let i = 0; i < vectorA.length; i += 1) {
    const diff = vectorA[i] - vectorB[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
};

const verifyFaceMatch = ({ storedEmbedding, candidateEmbedding, threshold }) => {
  const normalizedStored = normalizeEmbedding(storedEmbedding);
  const normalizedCandidate = normalizeEmbedding(candidateEmbedding);

  if (!normalizedStored || !normalizedCandidate) {
    return {
      valid: false,
      matched: false,
      distance: null,
      threshold: threshold || DEFAULT_THRESHOLD,
      reason: 'INVALID_EMBEDDING',
    };
  }

  if (normalizedStored.length !== normalizedCandidate.length) {
    return {
      valid: false,
      matched: false,
      distance: null,
      threshold: threshold || DEFAULT_THRESHOLD,
      reason: 'EMBEDDING_SIZE_MISMATCH',
    };
  }

  const effectiveThreshold = Number.isFinite(Number(threshold)) ? Number(threshold) : DEFAULT_THRESHOLD;
  const distance = euclideanDistance(normalizedStored, normalizedCandidate);
  const matched = distance !== null ? distance <= effectiveThreshold : false;

  return {
    valid: true,
    matched,
    distance: distance !== null ? Number(distance.toFixed(6)) : null,
    threshold: effectiveThreshold,
    reason: matched ? 'FACE_MATCHED' : 'FACE_NOT_MATCHED',
  };
};

const isFacialClockInEnabled = () => String(process.env.FACIAL_CLOCK_IN_ENABLED || 'true').toLowerCase() !== 'false';
const isFacialEnrollmentRequired = () =>
  String(process.env.FACIAL_REQUIRE_ENROLLMENT || 'false').toLowerCase() === 'true';

module.exports = {
  normalizeEmbedding,
  verifyFaceMatch,
  isFacialClockInEnabled,
  isFacialEnrollmentRequired,
  DEFAULT_THRESHOLD,
};
