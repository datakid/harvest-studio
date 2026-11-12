const KEY = 'hs:prefs';
const defaults = { theme: 'system', lang: 'en', mode: 'separate', target: 'v3', spread: 1, monoColor: '#f0475c', monoVary: true, paletteColors: ['#ffb347', '#ff7a59', '#f0475c', '#b4417a', '#6a3fa0'], paletteVary: true, faFallback: false, palettes: [], corners: 'balanced', colors: 'vivid', proxyUrl: '', tileSize: 80, tone: 'auto', railCollapsed: false, faithful: false };

export const loadPrefs = () => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
};

export const savePrefs = (prefs) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
};

export const loadToken = () => {
  try {
    return sessionStorage.getItem('hs:token') || '';
  } catch {
    return '';
  }
};

export const saveToken = (token) => {
  try {
    sessionStorage.setItem('hs:token', token);
  } catch {}
};
