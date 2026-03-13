/**
 * Utilitários para capturar metadados de requisições HTTP
 */

/**
 * Extrai o endereço IP real do cliente
 * Considera proxies e load balancers
 */
const getClientIP = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.connection?.socket?.remoteAddress ||
    'unknown'
  );
};

/**
 * Extrai informações do User-Agent
 */
const getDeviceInfo = (req) => {
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  // Detecta tipo de dispositivo
  const isMobile = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  const isTablet = /tablet|ipad|playbook|silk/i.test(userAgent);
  const isDesktop = !isMobile && !isTablet;

  // Detecta sistema operacional
  let os = 'Unknown';
  if (/windows/i.test(userAgent)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(userAgent)) os = 'macOS';
  else if (/linux/i.test(userAgent)) os = 'Linux';
  else if (/android/i.test(userAgent)) os = 'Android';
  else if (/ios|iphone|ipad|ipod/i.test(userAgent)) os = 'iOS';

  // Detecta navegador
  let browser = 'Unknown';
  if (/chrome/i.test(userAgent) && !/edge|edg/i.test(userAgent)) browser = 'Chrome';
  else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) browser = 'Safari';
  else if (/firefox/i.test(userAgent)) browser = 'Firefox';
  else if (/edge|edg/i.test(userAgent)) browser = 'Edge';
  else if (/opera|opr/i.test(userAgent)) browser = 'Opera';

  return {
    userAgent,
    deviceType: isDesktop ? 'Desktop' : isTablet ? 'Tablet' : 'Mobile',
    os,
    browser,
    isMobile,
    isTablet,
    isDesktop,
  };
};

/**
 * Extrai localização do corpo da requisição (se fornecida pelo frontend)
 */
const getLocation = (req) => {
  const { latitude, longitude } = req.body;
  
  if (latitude !== undefined && longitude !== undefined) {
    // Valida coordenadas
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return {
        lat,
        lng,
        timestamp: new Date().toISOString(),
      };
    }
  }
  
  return null;
};

/**
 * Captura todos os metadados da requisição
 */
const captureRequestMetadata = (req) => {
  const ip = getClientIP(req);
  const device = getDeviceInfo(req);
  const location = getLocation(req);

  return {
    ip,
    device: `${device.deviceType} - ${device.browser} on ${device.os}`,
    deviceDetails: device,
    location,
    timestamp: new Date().toISOString(),
  };
};

module.exports = {
  getClientIP,
  getDeviceInfo,
  getLocation,
  captureRequestMetadata,
};
